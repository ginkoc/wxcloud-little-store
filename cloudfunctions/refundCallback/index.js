// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 退款状态常量
const REFUND_STATUS = {
  PROCESSING: 'processing',    // 退款中
  FAILED: 'failed',            // 退款失败
  SUCCESS: 'success'           // 退款成功
};

// 🛠️ 增强版公共工具函数
const utils = {
  // 微信支付回调统一响应格式 (符合微信支付规范格式)
  callbackResponse(success) {
    return {
      errcode: success ? 0 : 1,
      errmsg: success ? "OK" : "处理失败",
      returnCode: success ? 'SUCCESS' : 'FAIL'
    };
  },

  isCalledSuccess(result_code, return_code) {
    return return_code === 'SUCCESS'&& result_code === 'SUCCESS';
  },

  // 增强版幂等性检查
  async checkRefundProcessed(refundInfo) {
    // 先检查退款记录状态
    if (refundInfo.status === REFUND_STATUS.SUCCESS || 
        refundInfo.status === REFUND_STATUS.FAILED) {
      return { processed: true };
    }
    
    // 再检查订单状态(如果订单已取消但退款记录未成功，说明状态不一致)
    try {
      const orderRes = await db.collection('orders').doc(refundInfo.orderId).get();
      if (orderRes.data && orderRes.data.status === 'cancelled') {
        return { processed: true, dataInconsistent: true };
      }
    } catch (err) {
      console.error('检查订单状态出错:', err);
    }
    
    return { processed: false };
  },

  // 统一的错误日志记录(增强版)
  logError(error, context = '', data = {}) {
    console.error(`${context}:`, error, JSON.stringify(data));
    
    // 记录错误到数据库
    db.collection('system_errors').add({
      data: {
        source: 'refundCallback',
        context,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : null,
        data,
        timestamp: db.serverDate()
      }
    }).catch(dbError => {
      console.error('记录错误到数据库失败:', dbError);
    });
  },
  
  // 新增：创建恢复任务
  async createRecoveryTask(refundId, orderId, requestId, reason = '事务处理失败') {
    try {
      await db.collection('system_errors').add({
        data: {
          source: 'refundCallback',
          context: 'recovery_needed',
          errorMessage: `${reason}，需恢复`,
          data: {
            refundId,
            orderId,
            requestId,
            createdAt: db.serverDate()
          },
          needRecovery: true, // 标记需要恢复
          priority: 1, // 优先级，1为普通，2为高
          timestamp: db.serverDate()
        }
      });
      console.log(`已创建恢复任务: ${refundId}`);
      return true;
    } catch (err) {
      console.error('创建恢复任务失败:', err);
      return false;
    }
  },
  
  // 新增：重试处理机制
  async retryTransaction(func, maxRetries = 3) {
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await func();
      } catch (err) {
        lastError = err;
        console.error(`事务处理失败，第${attempt}次重试:`, err);
        
        // 短暂延迟后重试
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 300 * attempt));
        }
      }
    }
    
    throw lastError; // 所有重试都失败后抛出最后一个错误
  }
};

// 云函数入口函数
exports.main = async (event, context) => {
  // 生成唯一请求ID方便追踪
  const requestId = Date.now().toString(36) + Math.random().toString(36).substring(2);
  console.log(`[${requestId}] 收到退款回调:`, event);
  
  try {
    // 解析退款回调的数据
    const { return_code, result_code, refund_status, out_refund_no } = event;

    // 记录关键退款参数
    console.log('退款回调关键参数:', { 
      out_refund_no, 
      result_code, 
      return_code,
      refund_status,
      requestId 
    });
    
    // 必要的参数检查
    if (!out_refund_no) {
      utils.logError('退款单号缺失', '参数验证', { requestId, event });
      return utils.callbackResponse(true); // 返回成功避免微信重试
    }
    
    // 查询退款记录
    const refundRecord = await db.collection('refunds')
      .where({ refundId: out_refund_no })
      .get();

    if (!refundRecord.data || refundRecord.data.length === 0) {
      utils.logError('退款记录未找到', '查询记录', { requestId, event });
      // 虽然退款记录未找到，但仍返回成功，防止微信重试机制
      return utils.callbackResponse(true);
    }

    const refundInfo = refundRecord.data[0];
    
    // 增强版幂等性检查
    const processedCheck = await utils.checkRefundProcessed(refundInfo);
    if (processedCheck.processed) {
      console.log(`[${requestId}] 退款已处理，跳过:`, refundInfo._id);
      if (processedCheck.dataInconsistent) {
        // 记录数据不一致情况，但不重复处理
        await utils.logError('退款数据不一致', '幂等性检查', { 
          requestId, 
          refundId: out_refund_no,
          orderId: refundInfo.orderId
        });
        
        // 创建低优先级恢复任务修复不一致状态
        await utils.createRecoveryTask(
          out_refund_no, 
          refundInfo.orderId, 
          requestId, 
          '数据状态不一致'
        );
      }
      return utils.callbackResponse(true);
    }
    
    // 只有返回成功时才处理
    if (!utils.isCalledSuccess(result_code, return_code)) {
      utils.logError({ return_code, result_code }, '回调返回失败', { requestId });
      return utils.callbackResponse(true); 
    }
    
    // 退款成功后，需要分别更改订单表、订单历史状态表以及退款记录表
    const fromStatus = 'refunding';
    const toStatus = 'cancelled';

    // 更新订单状态
    const orderUpdateData = {
      status: toStatus,
      refundId: refundInfo._id,
      cancelTime: db.serverDate(),
      updateTime: db.serverDate()
    };

    // 添加历史状态信息
    const historyData = {
      orderId: refundInfo.orderId,
      fromStatus: fromStatus,
      toStatus: toStatus,
      operator: '系统',
      operatorId: 'system',
      statusText: '已中止',
      remark: `退款成功 [退款单号:${refundInfo.refundId}]`,
      userFriendlyMessage: '退款成功',
      operationResult: 1,
      requestId, // 记录请求ID方便追踪
      createTime: db.serverDate() 
    };

    const refundUpdateData = {
      status: REFUND_STATUS.SUCCESS,
      refundResponse: event,
      completeTime: db.serverDate(), // 添加完成时间字段
      updateTime: db.serverDate()
    };

    // 使用重试机制处理事务
    try {
      await utils.retryTransaction(async () => {
        // 开启事务
        const transaction = await db.startTransaction();
        
        try {
          await transaction.collection('orders').doc(refundInfo.orderId).update({
            data: orderUpdateData
          });

          await transaction.collection('order_history').add({data: historyData});

          await transaction.collection('refunds').doc(refundInfo._id).update({
            data: refundUpdateData
          });

          // 提交事务
          await transaction.commit();
          return true;
        } catch (txError) {
          // 事务错误处理
          await transaction.rollback();
          throw txError; // 抛出错误以便重试
        }
      });
      
      console.log(`[${requestId}] 退款成功处理完成:`, {
        orderId: refundInfo.orderId,
        refundId: refundInfo.refundId,
        状态变更: `${fromStatus} -> ${toStatus}`
      });
      
      return utils.callbackResponse(true);
    } catch (txError) {
      // 所有重试都失败后的处理
      utils.logError(txError, '退款回调事务处理失败（重试耗尽）', { requestId });
      
      // 创建高优先级恢复任务
      await utils.createRecoveryTask(
        out_refund_no, 
        refundInfo.orderId, 
        requestId, 
        '事务处理失败（重试耗尽）'
      );
      
      return utils.callbackResponse(true); // 仍返回成功给微信支付
    }
  } catch (error) {
    utils.logError(error, '退款回调处理异常', { requestId, event });
    
    // 如果有退款ID，创建恢复任务
    if (event && event.out_refund_no) {
      await utils.createRecoveryTask(
        event.out_refund_no, 
        null, // 此处可能无法获取orderId
        requestId, 
        '回调处理异常'
      );
    }
    
    return utils.callbackResponse(true); // 返回成功避免微信重试
  }
}; 