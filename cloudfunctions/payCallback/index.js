// 云函数入口文件
const cloud = require('wx-server-sdk')
const logger = require('./logger')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 🛠️ 公共工具函数
const utils = {
  // 微信支付回调统一响应格式 (符合微信支付规范格式)
  callbackResponse(success) {
    return {
      errcode: success ? 0 : 1,
      errmsg: success ? "OK" : "处理异常",
      returnCode: success ? 'SUCCESS' : 'FAIL'
    };
  },

  isCalledSuccess(result_code, return_code) {
    return return_code === 'SUCCESS'&& result_code === 'SUCCESS';
  },

  // 统一的错误日志记录
  logError(error, context = '') {
    logger.error(context, { error });
  }
};

// 云函数入口函数
exports.main = async (event, context) => {
  logger.info('收到支付回调', { event });
  const wxContext = cloud.getWXContext();
  
  try {
    // 解析支付回调的数据 (微信云函数支付回调参数名使用下划线格式)
    const { transaction_id, out_trade_no, result_code, return_code, total_fee } = event;
    
    // 记录关键支付参数
    logger.payment('收到回调', { 
      transaction_id, 
      out_trade_no, 
      result_code, 
      return_code,
      total_fee,
      environment: wxContext.ENVIRONMENT_ID 
    });

    // 参数完整性检查
    if (!transaction_id || !out_trade_no) {
      logger.error('支付回调缺少必要参数', { event });
      return utils.callbackResponse(false);
    }

    // 只有返回成功并且业务结果为成功时处理订单
    if (!utils.isCalledSuccess(result_code, return_code)) {
      logger.error('支付结果不成功', { return_code, result_code, out_trade_no, transaction_id });
      return utils.callbackResponse(false);
    }

    const orderInfo = await db.collection('orders').doc(out_trade_no).get();
    if (!orderInfo.data) {
      logger.error('支付回调对应订单不存在', { out_trade_no, transaction_id });
      return utils.callbackResponse(false);
    }
    
    // 检查订单是否已支付
    if (orderInfo.data.isPaid && orderInfo.data.paymentId) {
      logger.info('订单已处理过支付，忽略重复通知', { 
        orderNo: out_trade_no, 
        existingPaymentId: orderInfo.data.paymentId,
        newPaymentId: transaction_id 
      });
      return utils.callbackResponse(true);
    }
    
    const fromStatus = 'pending_payment';
    const toStatus = 'paid';

    // 更新订单状态
    const orderUpdateData = {
      status: toStatus,
      paymentId: transaction_id,
      isPaid: true,
      payTime: db.serverDate(),
      updateTime: db.serverDate()
    };

    // 添加历史状态信息
    const historyData = {
      orderId: out_trade_no,
      fromStatus: fromStatus,
      toStatus: toStatus,
      operator: '系统',
      operatorId: 'system',
      statusText: '已支付',
      remark: `支付成功 [交易ID:${transaction_id}]`,
      userFriendlyMessage: '支付成功',
      operationResult: 1,
      createTime: db.serverDate() 
    };

    // 开启事务
    const transaction = await db.startTransaction();
    try {
      await transaction.collection('orders').doc(out_trade_no).update({
        data: orderUpdateData
      });
      await transaction.collection('order_history').add({data: historyData});

      // 提交事务
      await transaction.commit();
      
      logger.payment('支付成功处理', {
        订单号: out_trade_no,
        交易号: transaction_id,
        状态变更: `${fromStatus} -> ${toStatus}`
      });
      
      return utils.callbackResponse(true);
    } catch (txError) {
      // 事务错误处理
      logger.error('支付回调事务处理失败', {
        error: txError.message || String(txError),
        stack: txError.stack,
        orderData: {
          orderId: out_trade_no,
          transactionId: transaction_id,
          totalFee: total_fee
        }
      });
      await transaction.rollback();
      return utils.callbackResponse(false);
    }
  } catch (error) {
    logger.error('支付回调处理异常', {
      error: error.message || String(error),
      stack: error.stack,
      event
    });
    return utils.callbackResponse(false);
  }
} 