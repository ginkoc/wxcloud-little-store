// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

// 退款状态常量
const REFUND_STATUS = {
  PROCESSING: 'processing',    // 退款中
  FAILED: 'failed',            // 退款失败
  SUCCESS: 'success'           // 退款成功
};

// 公共工具函数（精简版）
const utils = {

  // 🔧 生成退款单号
  generateRefundId() {
    return `refund_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  },

  // 🔧 生成随机字符串
  generateNonceStr(length = 15) {
    return Math.random().toString(36).substring(2, length);
  },

  //  检查退款是否成功
  isRefundSuccess(refundRes) {
    return refundRes && refundRes.returnCode === 'SUCCESS' && refundRes.resultCode === 'SUCCESS';
  },

  //  创建退款记录
  async createNewRefundRecord(operatorOpenId, orderId, refundId, totalFee, refundFee, refundReason) {
    const refundData = {
      operatorOpenId: operatorOpenId,
      orderId: orderId,
      refundId: refundId,
      totalFee: totalFee,
      refundFee: refundFee,
      refundReason: refundReason,
      status: REFUND_STATUS.PROCESSING,
      createTime: db.serverDate(),
      updateTime: db.serverDate()
    };
    
    return await db.collection('refunds').add({
      data: refundData
    });
  },

  //  微信支付退款调用的通用方法
  async callWxRefund(orderId, refundId, totalFee, refundFee, refundReason) {
    return await cloud.cloudPay.refund({
      sub_mch_id: cloudConfig.sub_mch_id,
      nonce_str: this.generateNonceStr(),
      out_trade_no: orderId,
      out_refund_no: refundId,
      total_fee: totalFee,
      refund_fee: refundFee,
      refund_desc: refundReason,
      envId: cloudConfig.envId,
      functionName: cloudConfig.refundCallbackFunction
    });
  },

  //  微信支付退款查询的通用方法  
  async callWxRefundQuery(refundId) {
    return await cloud.cloudPay.queryRefund({
      sub_mch_id: cloudConfig.sub_mch_id,
      nonce_str: this.generateNonceStr(),
      out_refund_no: refundId
    });
  },

  //  查询退款记录的通用方法
  async queryRefundRecord(orderId, refundId) {
    let query;
    if (refundId) {
      query = { refundId: refundId };
    } else if (orderId) {
      query = { orderId: orderId };
    } else {
      throw new Error('缺少退款单号或订单号');
    }
    
    const refundInfo = await db.collection('refunds').where(query).get();
    
    if (refundInfo.data.length === 0) {
      throw new Error('未找到退款记录');
    }
    
    return refundInfo.data[0]; // 返回最新的退款记录
  },

  //  更新退款状态
  async updateRefundStatus(refundId, status, refundResponse = null) {
    const updateData = {
      status: status,
      refundResponse: refundResponse,
      updateTime: db.serverDate()
    };
    
    // 更新退款记录
    await db.collection('refunds').where({ refundId }).update({
      data: updateData
    });
  },

  //  提取错误信息 - 保持技术细节版
  extractErrorMessage(error) {
    if (typeof error === 'string') return error;
    if (error?.errCodeDes || error?.err_code_des) return error.errCodeDes || error.err_code_des;
    if (error?.returnMsg) return error.returnMsg;
    if (error?.message) return error.message;
    return '退款处理失败';
  },

  //  提取错误码
  extractErrorCode(error) {
    if (typeof error === 'string') return 'UNKNOWN';
    if (error?.errCode || error?.err_code) return error.errCode || error.err_code;
    if (error?.returnCode) return error.returnCode;
    return 'UNKNOWN';
  },

  //  简化的成功响应
  successResponse(data) {
    return {
      success: true,
      data,
      timestamp: Date.now()
    };
  },

  //  简化的错误响应 - 技术细节版
  errorResponse(error, context = '') {
    const errorMessage = this.extractErrorMessage(error);
    const errorCode = this.extractErrorCode(error);
    
    return {
      success: false,
      error: errorMessage,
      errorCode: errorCode,
      context: context,
      timestamp: Date.now()
    };
  }
};

//  引入统一配置
const cloudConfig = require('./config')

// 云函数入口函数
exports.main = async (event, context) => {
  const { type } = event
  const wxContext = cloud.getWXContext()
  
  // 使用Map优化路由查找性能
  const handlers = {
    'createRefund': createRefund,
    'queryRefund': queryRefund
  };
  
  const handler = handlers[type];
  if (handler) {
    return await handler(event, wxContext);
  }
  
  return utils.errorResponse('未知操作类型');
}

/**
 * refund 云函数职责：微信支付调用 + 标准响应格式
 */
async function createRefund(event, wxContext) {
  const { 
    orderId, 
    refundFee, 
    refundReason, 
    operatorOpenId = null
  } = event;
  
  try {
    // 先获取当前订单信息
    const order = await db.collection('orders').doc(orderId).get();
    if (!order.data) {
      return utils.errorResponse('订单不存在');
    }

    // 订单退款金额检查放在refund函数中处理是合理的，因为refund函数是微信支付退款调用
    const totalFee = order.totalFee;
    const actualRefundFee = refundFee || totalFee;
    
    if (actualRefundFee > totalFee) {
      console.error('退款金额超过订单金额');
      return utils.errorResponse('退款金额不能超过订单金额', 'validation');
    }
    
    // 生成退款单号
    const refundId = utils.generateRefundId();
    // 开始退款，创建状态为'退款中'的退款记录
    await utils.createNewRefundRecord(
      operatorOpenId, 
      orderId, 
      refundId, 
      totalFee, 
      actualRefundFee, 
      refundReason
    );

    try {
      // 调用微信支付退款接口发起退款
      const refundRes = await utils.callWxRefund(orderId, refundId, totalFee, refundFee, refundReason);
      
      // 检查是否成功
      if (!utils.isRefundSuccess(refundRes)) {
        console.error('发起退款失败，返回退款数据:', refundRes);
        // 发起退款失败后，更新退款记录状态为'退款失败'并且返回退款失败信息
        await utils.updateRefundStatus(orderId, refundId, REFUND_STATUS.FAILED, refundRes);
        return utils.errorResponse(refundRes, 'wx_refund_failed');
      }

      // 退款成功对于数据库的处理放在refundCallback云函数中处理，这里只做日志记录
      console.log('发起退款成功, 返回退款数据：', refundRes);
      return utils.successResponse({
        refundId,
        refundFee: actualRefundFee,
        refundReason: refundReason,
        refundResponse: refundRes
      });
    } catch (error) {
      console.error('退款错误详情:', error);
      
      return utils.errorResponse(retryResult.error, 'wx_refund_failed');
    }
  } catch (error) {
    console.error('🔧 refund云函数：退款处理失败', error);
    return utils.errorResponse(error, 'refund_function');
  }
}

/**
 * 查询退款状态
 */
async function queryRefund(event, wxContext) {
  const { orderId, refundId } = event
  
  try {
    // 🔧 使用公共方法查询退款记录
    const latestRefund = await utils.queryRefundRecord(orderId, refundId);
    
    return utils.successResponse(latestRefund);
  } catch (err) {
    return utils.errorResponse(err, 'query_refund');
  }
} 