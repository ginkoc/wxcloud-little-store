const cloud = require('wx-server-sdk')
const logger = require('./logger')
// 引入订单状态机
const { orderStateMachine, ORDER_STATUS } = require('./orderStateMachine')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})
const db = cloud.database()
const _ = db.command

// 引入统一配置
const cloudConfig = require('./config')


//  统一错误处理器 - 分层信息架构
const errorHandler = {
  //  微信支付错误的分层映射
  wxPayErrorMapping: {
    'sub_mch_id is not bound.': {
      userMessage: '退款遇到临时问题，系统正在重新处理',
      merchantMessage: '微信支付商户配置异常：子商户号未绑定',
      merchantGuidance: [
        '请登录微信支付商户平台检查子商户号配置',
        '确认子商户号已正确绑定到主商户号',
        '如需帮助请联系微信支付客服：400-900-9665',
        '或联系平台技术支持'
      ],
      actionRequired: true,
      severity: 'ERROR'
    },
    'NOTENOUGH': {
      userMessage: '退款遇到临时问题，系统正在重新处理',
      merchantMessage: '微信支付商户账户余额不足，无法完成退款',
      merchantGuidance: [
        '请立即登录微信支付商户平台充值',
        '建议保持账户余额充足以确保退款正常处理',
        '充值完成后，系统将自动重新处理退款',
        '如有疑问请联系微信支付客服'
      ],
      actionRequired: true,
      severity: 'WARNING'
    },
    'FREQUENCY_LIMITED': {
      userMessage: '系统繁忙，正在重新为您处理',
      merchantMessage: '微信支付接口调用频率受限',
      merchantGuidance: [
        '请稍等片刻，系统将自动重试',
        '如持续出现此问题，请检查接口调用频率',
        '建议优化退款处理流程，避免频繁调用'
      ],
      actionRequired: false,
      severity: 'INFO'
    },
    'SYSTEMERROR': {
      userMessage: '系统繁忙，正在重新为您处理',
      merchantMessage: '微信支付系统临时异常',
      merchantGuidance: [
        '这是微信支付系统的临时问题',
        '系统将自动重试，无需手动处理',
        '如问题持续请联系平台客服'
      ],
      actionRequired: false,
      severity: 'INFO'
    },
    'PARAM_ERROR': {
      userMessage: '退款遇到临时问题，系统正在重新处理',
      merchantMessage: '微信支付参数配置错误',
      merchantGuidance: [
        '请检查微信支付相关配置参数',
        '确认商户号、密钥等信息正确',
        '如需技术支持请联系平台开发团队'
      ],
      actionRequired: true,
      severity: 'ERROR'
    }
  },

  //  通用错误映射
  genericErrorMapping: {
    'network_error': {
      userMessage: '网络连接异常，正在重新处理',
      merchantMessage: '网络连接超时',
      merchantGuidance: ['系统将自动重试，无需手动处理'],
      actionRequired: false,
      severity: 'INFO'
    },
    'timeout': {
      userMessage: '处理超时，正在重新为您处理',
      merchantMessage: '退款处理超时',
      merchantGuidance: ['系统将自动重试，如问题持续请联系客服'],
      actionRequired: false,
      severity: 'WARNING'
    }
  },

  //  根据错误信息获取分层映射
  getErrorMapping(error) {
    const errorMessage = this.extractRawMessage(error);
    const errorCode = this.extractErrorCode(error);
    
    // 优先匹配微信支付错误
    for (const [key, mapping] of Object.entries(this.wxPayErrorMapping)) {
      if (errorMessage.includes(key) || errorCode === key) {
        return {
          ...mapping,
          originalError: errorMessage,
          originalCode: errorCode
        };
      }
    }
    
    // 匹配通用错误
    for (const [key, mapping] of Object.entries(this.genericErrorMapping)) {
      if (errorMessage.includes(key) || errorCode === key) {
        return {
          ...mapping,
          originalError: errorMessage,
          originalCode: errorCode
        };
      }
    }
    
    // 默认映射
    return {
      userMessage: '处理遇到临时问题，系统正在重新处理',
      merchantMessage: '订单处理异常',
      merchantGuidance: [
        '如问题持续出现，请联系平台客服',
        '提供订单号以便快速定位问题'
      ],
      actionRequired: false,
      severity: 'WARNING',
      originalError: errorMessage,
      originalCode: errorCode
    };
  },

  //  提取原始错误信息（不做友好化处理）
  extractRawMessage(error) {
    if (typeof error === 'string') return error;
    if (error?.errCodeDes || error?.err_code_des) return error.errCodeDes || error.err_code_des;
    if (error?.returnMsg) return error.returnMsg;
    if (error?.message) return error.message;
    if (error?.error) return error.error;
    return '未知错误';
  },

  // 提取错误信息供用户使用
  extractErrorMessage(error) {
    if (typeof error === 'string') return error;
    if (error?.message) return error.message;
    if (error?.errMsg) return error.errMsg;
    if (error?.error) return error.error;
    return '未知错误';
  },

  //  提取错误码
  extractErrorCode(error) {
    if (typeof error === 'string') return 'UNKNOWN';
    if (error?.errCode || error?.err_code) return error.errCode || error.err_code;
    if (error?.returnCode) return error.returnCode;
    if (error?.errorCode) return error.errorCode;
    return 'UNKNOWN';
  },

  // 处理 refund 云函数返回的错误
  handleRefundError(refundResult) {
    const errorMapping = this.getErrorMapping(refundResult);
    
    return {
      success: false,
      userMessage: errorMapping.userMessage,
      merchantMessage: errorMapping.merchantMessage,
      merchantGuidance: errorMapping.merchantGuidance,
      actionRequired: errorMapping.actionRequired,
      severity: errorMapping.severity,
      originalError: errorMapping.originalError,
      originalCode: errorMapping.originalCode,
      timestamp: Date.now()
    };
  },

  // 判断是否可重试（与 refund 云函数保持一致）
  isRetryableError(errorCode) {
    const retryableErrors = ['SYSTEMERROR', 'FREQUENCY_LIMITED', 'BIZERR_NEED_RETRY'];
    return retryableErrors.includes(errorCode);
  },

  // 处理微信支付错误 - 简化版
  handleWxPayError(error) {
    const mapping = this.getErrorMapping(error);
    return mapping.userMessage;
  },

  // 通用成功响应
  successResponse(data, message = '') {
    return {
      success: true,
      data,
      ...(message && { message }),
      timestamp: Date.now()
    };
  },

  //  增强版错误响应
  errorResponse(error, context = '') {
    const mapping = this.getErrorMapping(error);
    
    // 记录完整的技术日志
    console.error('订单错误详情:', {
      context,
      userMessage: mapping.userMessage,
      originalError: mapping.originalError,
      originalCode: mapping.originalCode,
      timestamp: new Date().toISOString()
    });
    
    return {
      success: false,
      error: mapping.userMessage, // 返回用户友好信息
      context: context,
      timestamp: Date.now()
    };
  },

  //  创建商家通知消息
  async createMerchantNotice(orderId, errorResult, operatorId) {
    try {
      const noticeData = {
        messageType: 'REFUND_ERROR',
        level: errorResult.severity,
        orderId: orderId,
        merchantId: operatorId, // 使用操作者ID作为商家ID
        title: this.generateNoticeTitle(errorResult),
        content: this.generateNoticeContent(orderId, errorResult),
        actionRequired: errorResult.actionRequired,
        suggestions: errorResult.merchantGuidance,
        relatedLinks: this.generateRelatedLinks(errorResult),
        status: 'UNREAD',
        isRead: false,
      };
      
      // 调用消息通知云函数
      await cloud.callFunction({
        name: 'notice',
        data: {
          type: 'createNotice',
          noticeData: noticeData,
          expireDays: 7
        }
      });
      
      console.log('商家通知消息创建成功:', orderId);
    } catch (error) {
      console.error('创建商家通知消息失败:', error);
    }
  },

  //  生成通知标题
  generateNoticeTitle(errorResult) {
    const titleMap = {
      'ERROR': '订单处理异常需要处理',
      'WARNING': '订单处理异常提醒', 
      'INFO': '订单处理状态更新'
    };
    return titleMap[errorResult.severity] || '订单处理通知';
  },

  //  生成通知内容
  generateNoticeContent(orderId, errorResult) {
    return `订单 ${orderId} 的退款处理遇到问题：${errorResult.merchantMessage}。请及时处理以确保客户退款顺利到账。`;
  },

  //  生成相关链接
  generateRelatedLinks(errorResult) {
    const baseLinks = [
      { text: '平台帮助中心', url: '/help/refund' },
      { text: '联系客服', url: '/contact' }
    ];
    
    // 根据错误类型添加特定链接
    if (errorResult.originalError.includes('sub_mch_id') || errorResult.originalError.includes('NOTENOUGH')) {
      baseLinks.unshift({ text: '微信支付商户平台', url: 'https://pay.weixin.qq.com' });
    }
    
    return baseLinks;
  },

  // 生成历史记录备注（用于退款失败时）
  generateHistoryRemark(errorResult, context = {}) {
    const { isAdminOperation = false } = context;
    const operatorType = isAdminOperation ? '管理员' : '用户';
    
    return `${operatorType}退款失败：${errorResult.userMessage}`;
  }
};

// 公共工具函数
const utils = {
  // 检查管理员权限
  async checkAdminPermission(wxContext) {
    try {
      const result = await cloud.callFunction({
        name: 'user',
        data: {
          type: 'checkAdmin',
          openid: wxContext.OPENID
        }
      })
      
      return result.result && result.result.success && result.result.data && result.result.data.isAdmin
    } catch (error) {
      console.error('检查管理员权限失败:', error)
      return false
    }
  },

  // 检查订单权限
  async checkOrderPermission(orderId, wxContext) {
    try {
      const orderInfo = await db.collection('orders').doc(orderId).get();
      
      if (!orderInfo.data) {
        return { success: false, error: '订单不存在' };
      }
      
      const order = orderInfo.data;
      if (order._openid !== wxContext.OPENID) {
        const isAdmin = await this.checkAdminPermission(wxContext);
        if (!isAdmin) {
          return { success: false, error: '无权限访问此订单' };
        }
      }
      
      return { success: true, data: order };
    } catch (error) {
      return { success: false, error: '查询订单失败' };
    }
  },


  /**
   * 使用状态机更新订单状态
   */
  async updateOrderStatusWithStateMachine(orderId, transitionName, operatorId, isAdminOperation, remark, reason) {
    try {
      const context = {
        operatorId,
        isAdminOperation,
        remark,
        reason
      };
      
      return await orderStateMachine.executeTransition(orderId, transitionName, context);
    } catch (error) {
      logger.error('使用状态机更新订单状态失败', {
        orderId,
        transitionName,
        error: error.message || String(error),
        stack: error.stack
      });
      
      return {
        success: false,
        error: `更新订单状态失败: ${this.extractErrorMessage(error)}`
      };
    }
  },

  //  更新订单状态（使用新的分层架构）
  /**
   * 
   * @param {*} orderId 订单ID
   * @param {*} newStatus 新状态
   * @param {*} operatorId 操作人ID
   * @param {*} remark 备注
   * @returns 
   */
  // 处理订单退款 
  async processOrderRefund(orderId, reason = '订单中止', operatorOpenId = null) {
    try {
      const refundResult = await cloud.callFunction({
        name: 'refund',
        data: {
          type: 'createRefund',
          orderId: orderId,
          refundReason: reason,
          isAdminOperation: true,
          operatorOpenId: operatorOpenId
        }
      });

      console.log(' order云函数：refund云函数调用结果', {
        success: refundResult.result?.success,
        hasData: !!refundResult.result?.data
      });

      // 如果 refund 云函数返回成功，说明退款已完成
      if (refundResult.result?.success) {
        return refundResult.result.data; // 返回退款数据
      } else {
        throw refundResult.result || new Error('refund云函数调用失败');
      }
    } catch (error) {
      console.error('order云函数：调用refund云函数失败', error);
      throw error;
    }
  },

  //  验证商品信息
  async validateAndGetProduct(productId) {
    try {
      const productInfo = await db.collection('products').doc(productId).get();
      if (!productInfo.data) {
        return {
          success: false,
          error: '商品不存在'
        };
      }
      
      if (!productInfo.data.isOnSale) {
        return {
          success: false,
          error: '商品已下架'
        };
      }
      
      return {
        success: true,
        data: productInfo.data
      };
    } catch (error) {
      return {
        success: false,
        error: '查询商品失败'
      };
    }
  },

  //  标准化订单商品项
  createOrderItem(product, quantity) {
    return {
      productId: product._id,
      productName: product.name,
      productPrice: product.price,
      imageURL: product.imageURL || '',
      quantity: quantity,
      subtotal: product.price * quantity
    };
  },

  //  创建统一的订单数据结构
  createOrderData(wxContext, items, orderInfo) {
    const totalPrice = items.reduce((sum, item) => sum + item.subtotal, 0);
    
    return {
      // orderInfo 放在最上面的原因是
      // orderInfo中自带前端传入的不完整的items信息，需要用传入的items覆盖orderInfo中的items
      ...orderInfo,
      _openid: wxContext.OPENID,
      items: items,
      totalFee: totalPrice,
      isPaid: false,
      status: ORDER_STATUS.PENDING_PAYMENT,
      createTime: db.serverDate(),
      updateTime: db.serverDate()
    };
  },

  //  生成支付描述
  generatePaymentDescription(items) {
    const storePrefix = cloudConfig.paymentPrefix;
    if (items.length === 1) {
      return `${storePrefix}-${items[0].productName}`;
    } else {
      return `${storePrefix}-${items[0].productName}等${items.length}件商品`;
    }
  },

  //  判断微信支付是否成功
  isPaymentSuccess(paymentRes) {
    return paymentRes.returnCode === 'SUCCESS' && paymentRes.resultCode === 'SUCCESS';
  },

  //  创建微信支付失败错误对象
  createPaymentFailureError(paymentRes) {
    return {
      returnCode: paymentRes.returnCode,
      returnMsg: paymentRes.returnMsg,
      errCode: paymentRes.errCode,
      errCodeDes: paymentRes.errCodeDes || paymentRes.err_code_des
    };
  },

  //  统一的微信支付调用方法
  async callWxPayment(orderId, totalFee, description) {
    return await cloud.cloudPay.unifiedOrder({
      body: description,
      outTradeNo: orderId,
      subMchId: cloudConfig.wechatPay.subMchId,
      totalFee: totalFee,
      spbillCreateIp: cloudConfig.wechatPay.spbillCreateIp,
      envId: cloudConfig.wechatPay.envId,
      functionName: cloudConfig.wechatPay.payCallbackFunction
    });
  },

  //  检查订单支付权限和状态
  async checkOrderForPayment(orderId, wxContext) {
    try {
      const orderInfo = await db.collection('orders').doc(orderId).get();
      
      if (!orderInfo.data) {
        return {
          success: false,
          error: '订单不存在'
        };
      }
      
      const order = orderInfo.data;
      
      // 检查订单所有权
      if (order._openid !== wxContext.OPENID) {
        return {
          success: false,
          error: '无权限操作此订单'
        };
      }
      
      // 检查订单状态
      if (order.isPaid) {
        return {
          success: false,
          error: '订单已支付'
        };
      }
      
      if (order.status !== ORDER_STATUS.PENDING_PAYMENT) {
        return {
          success: false,
          error: '订单状态异常，无法支付'
        };
      }
      
      return {
        success: true,
        data: order
      };
    } catch (error) {
      return {
        success: false,
        error: '查询订单失败'
      };
    }
  },

  //  使用统一错误处理器
  errorHandler: errorHandler,
  
  // 委托成功响应
  successResponse: function(data, message = '') {
    return this.errorHandler.successResponse(data, message);
  },
  
  // 委托错误响应
  errorResponse: function(error, context = '') {
    return this.errorHandler.errorResponse(error, context);
  },
  
  // 委托微信支付错误处理
  handleWxPayError: function(error) {
    return this.errorHandler.handleWxPayError(error);
  },

  /**
   * 处理日期的时区转换，确保查询时间与数据库存储格式匹配
   * 
   * @param {string} dateStr 日期字符串，格式为YYYY-MM-DD
   * @param {string} timeStr 时间字符串，如"00:00:00"或"23:59:59"
   * @param {number} timezoneOffset 时区偏移量（分钟），默认为当前系统时区
   * @returns {Date} 转换后的Date对象
   */
  createUtcDate(dateStr, timeStr = "00:00:00", timezoneOffset = null) {
    if (!dateStr) return null;
    
    console.log(`createUtcDate输入: dateStr=${dateStr}, timeStr=${timeStr}, timezoneOffset=${timezoneOffset}`);
    
    // 如果没有指定时区偏移，使用当前系统时区
    if (timezoneOffset === null) {
      // 获取当前系统的时区偏移（分钟）
      timezoneOffset = new Date().getTimezoneOffset();
    }
    
    // 创建本地日期时间字符串
    const dateTimeStr = `${dateStr}T${timeStr}`;
    console.log(`创建日期时间字符串: ${dateTimeStr}`);
    
    // 创建一个Date对象，此时它会被解释为本地时间
    const localDate = new Date(dateTimeStr);
    console.log(`本地Date对象: ${localDate.toISOString()}, 时间戳: ${localDate.getTime()}`);
    
    // 计算时区调整值
    // 注意: getTimezoneOffset()返回的是本地时间与UTC的差值（分钟），东区为负，西区为正
    // 例如，东八区为-480分钟(-8小时)，而函数输入的timezoneOffset也是这个值
    // 所以需要反转符号进行调整
    const adjustment = -timezoneOffset * 60 * 1000; // 转换为毫秒
    console.log(`时区调整值(毫秒): ${adjustment}`);
    
    // 调整时间戳
    const utcTimestamp = localDate.getTime() + adjustment;
    console.log(`调整后的时间戳: ${utcTimestamp}`);
    
    // 创建基于调整后时间戳的Date对象
    const utcDate = new Date(utcTimestamp);
    console.log(`最终UTC Date对象: ${utcDate.toISOString()}`);
    
    return utcDate;
  },
};

/**
 * 验证查询参数并处理日期格式
 * 
 * @param {Object} params 查询参数
 * @param {number} [params.timezoneOffset] 时区偏移量（分钟），如东八区为-480
 * @returns {Object} 验证结果
 */
function validateQueryParams(params) {
  const { 
    page = 1, 
    pageSize = 10,
    dateStart = '',
    dateEnd = '',
    searchType = '',
    searchQuery = '',
    status = '',
    timezoneOffset = -480 // 默认东八区，可由前端传入
  } = params;
  
  // 验证分页参数
  const MAX_PAGE_SIZE = 50; // 最大每页50条
  const MAX_PAGE = 1000; // 最大允许查询到第1000页
  
  const safePage = Math.max(1, parseInt(page));
  const safePageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(pageSize)));
  
  if (safePage > MAX_PAGE) {
    return {
      success: false,
      error: `分页查询超出限制，最大支持查询到第${MAX_PAGE}页`
    };
  }
  
  // 验证日期参数
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  let startDate = null;
  let endDate = null;
  
  if (dateStart) {
    if (!dateRegex.test(dateStart)) {
      return {
        success: false,
        error: '开始日期格式无效，请使用YYYY-MM-DD格式'
      };
    }
    
    try {
      // 使用时区转换函数处理日期
      startDate = utils.createUtcDate(dateStart, "00:00:00", timezoneOffset);
      
      if (isNaN(startDate.getTime())) {
        return {
          success: false,
          error: '开始日期无效'
        };
      }
    } catch (err) {
      console.error('解析开始日期出错:', err);
      return {
        success: false,
        error: '开始日期解析错误'
      };
    }
  }
  
  if (dateEnd) {
    if (!dateRegex.test(dateEnd)) {
      return {
        success: false,
        error: '结束日期格式无效，请使用YYYY-MM-DD格式'
      };
    }
    
    try {
      // 使用时区转换函数处理日期
      endDate = utils.createUtcDate(dateEnd, "23:59:59", timezoneOffset);
      
      if (isNaN(endDate.getTime())) {
        return {
          success: false,
          error: '结束日期无效'
        };
      }
    } catch (err) {
      console.error('解析结束日期出错:', err);
      return {
        success: false,
        error: '结束日期解析错误'
      };
    }
  }
  
  // 检查开始日期是否大于结束日期
  if (startDate && endDate && startDate > endDate) {
    return {
      success: false,
      error: '开始日期不能大于结束日期'
    };
  }
  
  // 验证searchType和searchQuery参数
  const validSearchTypes = ['orderId', 'contactName', 'contactPhone'];
  
  // 如果提供了searchQuery但没有提供searchType或提供了无效的searchType
  if (searchQuery && (!searchType || !validSearchTypes.includes(searchType))) {
    return {
      success: false,
      error: '请提供有效的搜索类型(orderId/contactName/contactPhone)'
    };
  }
  
  // 对不同searchType的searchQuery进行格式校验
  if (searchType && searchQuery) {
    const trimmedQuery = searchQuery.trim();
    
    // 搜索内容不能为空
    if (!trimmedQuery) {
      return {
        success: false,
        error: '搜索内容不能为空'
      };
    }
    
    // 针对不同搜索类型的特定验证
    switch (searchType) {
      case 'orderId':
        // 订单ID通常有长度限制和格式要求
        if (trimmedQuery.length < 4) {
          return {
            success: false,
            error: '订单ID长度不能小于4个字符'
          };
        }
        break;
        
      case 'contactPhone':
        // 手机号码格式验证（简单版）
        const phoneRegex = /^\d{5,11}$/;
        if (!phoneRegex.test(trimmedQuery)) {
          return {
            success: false,
            error: '请输入有效的电话号码'
          };
        }
        break;
    }
  }
  
  // 验证status参数
  if (status && !Object.values(ORDER_STATUS).includes(status)) {
    return {
      success: false,
      error: '无效的订单状态'
    };
  }
  
  return {
    success: true,
    data: {
      safePage,
      safePageSize,
      startDate,
      endDate,
      searchType,
      searchQuery: searchQuery ? searchQuery.trim() : '',
      status,
      timezoneOffset
    }
  };
}

// 优化版：带筛选条件和分页的订单查询（管理员专用）
async function getAllOrdersWithFilter(event, context) {
  const { 
    page = 1, 
    pageSize = 10, 
    searchType = '', 
    searchQuery = '', 
    dateStart = '', 
    dateEnd = '', 
    status = '',
    timezoneOffset = -480 // 默认东八区，前端可传入 
  } = event;
  
  const wxContext = cloud.getWXContext();
  
  try {
    // 性能监控 - 开始计时
    const startTime = Date.now();
    
    // 使用公共方法检查管理员权限
    const isAdmin = await utils.checkAdminPermission(wxContext);
    if (!isAdmin) {
      return utils.errorResponse('无权限操作');
    }
    
    // 使用参数校验函数验证参数
    const validationResult = validateQueryParams({
      page,
      pageSize,
      dateStart,
      dateEnd,
      searchType,
      searchQuery,
      status,
      timezoneOffset
    });
    
    if (!validationResult.success) {
      return utils.errorResponse(validationResult.error);
    }
    
    const { safePage, safePageSize, startDate, endDate, searchType: validatedSearchType, searchQuery: validatedSearchQuery, status: validatedStatus } = validationResult.data;
    
    // 构建查询条件
    let query = {};
    
    // 根据业务规则，待支付订单只有客户自己能看到
    if (validatedStatus && validatedStatus === ORDER_STATUS.PENDING_PAYMENT) {
      // 如果明确查询待支付订单，直接返回空结果
      return utils.successResponse({
        list: [],
        pagination: {
          current: safePage,
          pageSize: safePageSize,
          total: 0,
          totalPages: 0,
          maxPage: 1000 // MAX_PAGE
        },
        queryInfo: {
          hasFilters: true,
          searchSummary: '管理员无权查看待支付订单'
        }
      });
    } else if (!validatedStatus) {
      // 如果没有指定状态筛选，则排除待支付订单
      query.status = _.neq(ORDER_STATUS.PENDING_PAYMENT);
    } else {
      // 如果指定了其他状态，直接使用该状态
      query.status = validatedStatus;
    }
    
    // 添加日期筛选
    if (startDate || endDate) {
      // 使用与getOrderHistory相同的查询条件构建方式
      if (startDate && endDate) {
        // 同时有开始和结束日期
        query.createTime = _.and([_.gte(startDate), _.lte(endDate)]);
      } else if (startDate) {
        // 只有开始日期
        query.createTime = _.gte(startDate);
      } else if (endDate) {
        // 只有结束日期
        query.createTime = _.lte(endDate);
      }
    }
    
    // 优化搜索查询 - 使用精确匹配提升性能
    if (validatedSearchQuery && validatedSearchType) {
      const searchCondition = {};
      switch (validatedSearchType) {
        case 'orderId':
          // 订单ID精确匹配（订单ID是唯一标识符）
          searchCondition._id = validatedSearchQuery;
          break;
        case 'contactName':
          // 联系人姓名模糊匹配
          searchCondition.contactName = db.RegExp({
            regexp: validatedSearchQuery,
            options: 'i'
          });
          break;
        case 'contactPhone':
          // 电话号码精确匹配（电话号码应该是精确的）
          searchCondition.contactPhone = validatedSearchQuery;
          break;
      }
      
      // 将搜索条件合并到现有查询中
      if (Object.keys(searchCondition).length > 0) {
        if (Array.isArray(query)) {
          // 如果 query 已经是 _.and 数组，添加搜索条件
          query.push(searchCondition);
        } else if (Object.keys(query).length > 0) {
          // 如果 query 是对象，转换为 _.and 数组
          query = _.and([query, searchCondition]);
        } else {
          // 如果 query 为空，直接使用搜索条件
          Object.assign(query, searchCondition);
        }
      }
    }
    
    // 并行执行计数和数据查询（提升性能）
    const [countResult, dataResult] = await Promise.all([
      // 计数查询
      db.collection('orders').where(query).count(),
      // 数据查询 - 只获取必要字段
      db.collection('orders')
        .where(query)
        .orderBy('createTime', 'desc')
        .skip((safePage - 1) * safePageSize)
        .limit(safePageSize)
        .field({
          _id: true,
          createTime: true,
          status: true,
          contactName: true,
          contactPhone: true,
          isPaid: true,
          items: true,
          totalFee: true,
          _openid: true // 用于数据权限验证
        })
        .get()
    ]);
    
    const total = countResult.total;
    
    // 记录查询性能
    const queryTime = Date.now() - startTime;
    
    // 性能告警
    if (queryTime > 1000) {
      console.warn('⚠️ 管理员订单查询性能较差，建议检查索引配置');
    }
    
    return utils.successResponse({
      list: dataResult.data,
      pagination: {
        current: safePage,
        pageSize: safePageSize,
        total,
        totalPages: Math.ceil(total / safePageSize),
        maxPage: 1000 // MAX_PAGE
      },
      queryInfo: {
        hasFilters: !!(dateStart || dateEnd || validatedStatus || validatedSearchQuery),
        searchSummary: validatedSearchQuery && validatedSearchType ? `${validatedSearchType}: ${validatedSearchQuery}` : '',
        adminNote: '已自动排除待支付订单'
      }
    });
  } catch (err) {
    return utils.errorResponse(err, '查询订单');
  }
}

// 获取订单状态机配置
async function getOrderStateMachineConfig(event, context) {
  try {
    // 直接使用全局已导入的订单状态机
    
    // 防御性检查 - 确保orderStateMachine对象存在且包含必要属性
    if (!orderStateMachine) {
      console.error('orderStateMachine对象未定义');
      return {
        success: false,
        error: '订单状态机配置未初始化'
      };
    }
    
    // 安全获取属性，避免undefined错误
    const safeGetProperty = (obj, propName) => {
      return obj && obj[propName] !== undefined ? obj[propName] : {};
    };
    
    // 返回前端需要的配置信息 - 确保每个属性都有默认值
    return {
      success: true,
      data: {
        ORDER_STATUS: ORDER_STATUS || {},
        STATUS_MAPPING: safeGetProperty(orderStateMachine, 'STATUS_MAPPING'),
        STATUS_TRANSITIONS: safeGetProperty(orderStateMachine, 'STATUS_TRANSITIONS'),
        REFUND_REQUIRED_TRANSITIONS: safeGetProperty(orderStateMachine, 'REFUND_REQUIRED_TRANSITIONS'),
        FRIENDLY_MSG_WHEN_STATUS_CHANGE: safeGetProperty(orderStateMachine, 'FRIENDLY_MSG_WHEN_STATUS_CHANGE'),
        states: safeGetProperty(orderStateMachine, 'states')
      },
      updateTime: Date.now()
    };
  } catch (error) {
    console.error('获取订单状态机配置失败:', error);
    // 确保即使发生错误也返回有效的JSON对象
    return {
      success: false,
      error: error && typeof error.message === 'string' ? error.message : '获取订单状态机配置失败',
      errorDetail: error ? (error.stack || String(error)) : '未知错误'
    };
  }
}

// 云函数入口函数
exports.main = async (event, context) => {
  try {
    const { type } = event
    
    // 使用Map优化路由查找性能
    const handlers = {
      'createOrder': createOrder,
      'createOrderFromCart': createOrderFromCart,
      'createPayment': createPayment,
      'queryPayment': queryPayment,
      'updateOrderStatus': updateOrderStatus,
      'getOrderDetail': getOrderDetail,
      'getAllOrdersWithFilter': getAllOrdersWithFilter,
      'cancelOrder': cancelOrder,
      'getMyOrders': getOrders,
      'acceptOrder': acceptOrder,
      'startDelivery': startDelivery,
      'completeDelivery': completeDelivery,
      'confirmReceived': confirmReceived,
      'cancelOrderByAdmin': cancelOrderByAdmin,
      'autoConfirmOrders': autoConfirmOrders,
      'getOrderHistory': getOrderHistory,
      'updateOrderStatusBatchWithStateMachine': updateOrderStatusBatchWithStateMachine,
      'getOrderStateMachineConfig': getOrderStateMachineConfig
    };
  
    // 查找对应的处理方法
    const handler = handlers[type];
    if (handler) {
      return await handler(event, context);
    } else {
      return {
        success: false,
        error: '未知的操作类型: ' + type
      };
    }
  } catch (error) {
    // 捕获所有未处理的异常，确保云函数不会崩溃
    console.error('云函数执行发生未捕获异常:', error);
    return {
      success: false,
      error: '云函数执行异常',
      message: error ? (error.message || String(error)) : '未知错误',
      stack: error && error.stack ? error.stack : ''
    };
  }
};

// 创建订单（单个商品）
async function createOrder(event, context) {
  const wxContext = cloud.getWXContext();
  
  try {
    const { items, address, remark } = event;
    
    // 日志记录订单创建请求
    logger.debug('接收到订单创建请求', { 
      userId: wxContext.OPENID,
      itemCount: items?.length,
      addressId: address?._id
    });
    
    // 验证参数
    if (!items || !Array.isArray(items) || items.length === 0) {
      logger.warn('创建订单缺少商品项', { userId: wxContext.OPENID });
      return utils.errorResponse('请选择要购买的商品');
    }
    
    if (!address) {
      logger.warn('创建订单缺少收货地址', { userId: wxContext.OPENID });
      return utils.errorResponse('请选择收货地址');
    }
    
    // 验证商品信息
    const productCheck = await utils.validateAndGetProduct(items[0].productId);
    if (!productCheck.success) {
      return utils.errorResponse(productCheck.error);
    }
    
    const product = productCheck.data;
    
    // 检查库存
    if (product.stock < items[0].quantity) {
      return utils.errorResponse('商品库存不足');
    }
    
    // 创建标准化的订单商品项
    const orderItem = utils.createOrderItem(product, items[0].quantity);
    
    // 创建统一的订单数据
    const orderData = utils.createOrderData(wxContext, [orderItem], {
      address,
      remark
    });
    
    // 使用事务来确保订单创建和商品状态更新的一致性
    const transaction = await db.startTransaction();
    
    try {
      // 创建订单
      const result = await transaction.collection('orders').add({
        data: orderData
      });
      
      // 更新商品的hasOrders字段为true
      await transaction.collection('products')
        .where({
          _id: items[0].productId,
          hasOrders: false // 只更新尚未标记为已有订单的商品
        })
        .update({
          data: {
            hasOrders: true
          }
        });
      console.log(`已更新商品 ${items[0].productId} 的hasOrders字段为true`);
      
      // 提交事务
      await transaction.commit();
      
      // 记录订单创建成功
      logger.business('创建订单', '成功', {
        orderId: result._id,
        userId: wxContext.OPENID,
        items: items.map(item => ({
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          price: item.price
        })),
        totalAmount: orderData.totalAmount,
        status: orderData.status
      });
      
      return {
        success: true,
        data: {
          orderId: result._id,
          totalAmount: orderData.totalAmount
        }
      };
    } catch (txnError) {
      // 事务失败，回滚所有操作
      await transaction.rollback();
      console.error('订单创建事务失败:', txnError);
      logger.error('订单创建事务失败', {
        error: txnError.message || String(txnError),
        stack: txnError.stack
      });
      return utils.errorResponse('订单创建失败，请重试', '事务执行失败');
    }
  } catch (error) {
    logger.error('创建订单失败', {
      userId: wxContext.OPENID,
      error: error.message || String(error),
      stack: error.stack,
      eventData: event
    });
    
    return utils.errorResponse(error, '创建订单');
  }
}

// 从购物车创建订单（多个商品）
async function createOrderFromCart(event, context) {
  const { orderInfo } = event
  const wxContext = cloud.getWXContext()
  
  try {
    // 验证订单信息
    if (!orderInfo || !orderInfo.items || orderInfo.items.length === 0) {
      return utils.errorResponse('订单商品信息不能为空');
    }
    
    // 批量验证商品信息并创建标准化订单项
    const orderItems = [];
    const productIds = []; // 收集所有商品ID，用于后续更新hasOrders字段
    
    for (const item of orderInfo.items) {
      // 验证商品信息
      const productCheck = await utils.validateAndGetProduct(item.productId);
      console.log("validateAndGetProduct方法返回的productCheck信息", productCheck);

      if (!productCheck.success) {
        return utils.errorResponse(`商品"${item.productName || item.productId}"${productCheck.error}`);
      }
      
      const product = productCheck.data;
      
      // 检查库存
      if (product.stock < item.quantity) {
        return utils.errorResponse(`商品"${product.name}"库存不足`);
      }
      
      // 创建标准化订单项
      const orderItem = utils.createOrderItem(product, item.quantity);
      orderItems.push(orderItem);
      
      // 收集商品ID
      productIds.push(item.productId);
    }
    
    // 创建统一的订单数据
    const orderData = utils.createOrderData(wxContext, orderItems, orderInfo);
    console.log("createOrderData方法返回的orderData信息", orderData);
    
    // 使用事务来确保订单创建和商品状态更新的一致性
    const transaction = await db.startTransaction();
    
    try {
      // 创建订单
      const result = await transaction.collection('orders').add({
        data: orderData
      });
      
      // 批量更新所有相关商品的hasOrders字段为true
      if (productIds.length > 0) {
        await transaction.collection('products')
          .where({
            _id: db.command.in(productIds),
            hasOrders: false // 只更新尚未标记为已有订单的商品
          })
          .update({
            data: {
              hasOrders: true
            }
          });
        console.log(`已批量更新${productIds.length}个商品的hasOrders字段为true`);
      }
      
      // 提交事务
      await transaction.commit();
      
      return utils.successResponse({
        orderId: result._id,
        totalFee: orderData.totalFee
      });
    } catch (txnError) {
      // 事务失败，回滚所有操作
      await transaction.rollback();
      console.error('订单创建事务失败:', txnError);
      logger.error('订单创建事务失败', {
        error: txnError.message || String(txnError),
        stack: txnError.stack
      });
      return utils.errorResponse('订单创建失败，请重试', '事务执行失败');
    }
  } catch (err) {
    return utils.errorResponse(err, '从购物车创建订单');
  }
}

// 发起微信支付
async function createPayment(event, context) {
  const { orderId } = event
  const wxContext = cloud.getWXContext()
  
  try {
    //  使用公共方法检查订单支付权限和状态
    const orderCheck = await utils.checkOrderForPayment(orderId, wxContext);
    if (!orderCheck.success) {
      return utils.errorResponse(orderCheck.error);
    }
    
    const order = orderCheck.data;
    
    //  使用公共方法生成支付描述
    const paymentDescription = utils.generatePaymentDescription(order.items);
    
    console.log('开始支付处理:', {
      orderId,
      totalFee: order.totalFee,
      paymentDescription
    });
    
    try {
      //  使用公共方法调用微信支付
      const paymentRes = await utils.callWxPayment(orderId, order.totalFee, paymentDescription);
      console.log('支付请求响应:', paymentRes);
      
      // 使用公共方法验证支付结果
      if (utils.isPaymentSuccess(paymentRes)) {
        console.log('支付请求发起成功');
        return utils.successResponse({
          payment: paymentRes.payment
        });
      } else {
        //  支付请求失败，解析错误信息
        const failureError = utils.createPaymentFailureError(paymentRes);
        console.log('微信支付发起请求失败:', failureError);
        
        const friendlyMessage = utils.handleWxPayError(failureError);
        return utils.errorResponse(friendlyMessage, '发起支付失败');
      }
    } catch (paymentError) {
      console.error('支付调用异常:', paymentError);
      const friendlyMessage = utils.handleWxPayError(paymentError);
      return utils.errorResponse(friendlyMessage, '发起支付异常');
    }
  } catch (err) {
    console.error('支付处理异常:', err);
    return utils.errorResponse('支付处理失败，请稍后重试', '支付处理异常');
  }
}

// 查询支付状态
async function queryPayment(event, context) {
  const { orderId } = event
  const wxContext = cloud.getWXContext()
  
  try {
    //  使用公共方法检查订单权限（查询支付状态不需要检查未支付状态）
    const permissionCheck = await utils.checkOrderPermission(orderId, wxContext);
    if (!permissionCheck.success) {
      return utils.errorResponse(permissionCheck.error);
    }
    
    const order = permissionCheck.data;
    
    return utils.successResponse({
      isPaid: order.isPaid,
      status: order.status
    });
  } catch (err) {
    return utils.errorResponse(err, '查询支付状态');
  }
}

// 获取订单详情
async function getOrderDetail(event, context) {
  const { orderId, operatorId } = event
  const wxContext = cloud.getWXContext()
  
  //  如果有传递 operatorId，说明是云函数间调用，使用传递的操作者身份
  const effectiveOpenId = operatorId || wxContext.OPENID;
  
  try {
    // 参数验证
    if (!orderId) {
      console.error('getOrderDetail: orderId参数为空');
      return utils.errorResponse('订单ID不能为空', 'validation');
    }
    
    // 查询订单信息
    const orderInfo = await db.collection('orders').doc(orderId).get();
    
    if (!orderInfo.data) {
      console.error('getOrderDetail: 订单不存在, orderId:', orderId);
      return utils.errorResponse('订单不存在', 'order_check');
    }
    
    //  简化的权限验证：先检查订单所有者，再检查管理员权限
    let hasPermission = false;
    
    // 1. 检查是否为订单所有者
    const isOwner = orderInfo.data._openid === effectiveOpenId;
    
    if (isOwner) {
      hasPermission = true;
    } else {
      // 2. 不是订单所有者，自动检查管理员权限
      const checkOpenId = operatorId || wxContext.OPENID;
      
      const isAdmin = await utils.checkAdminPermission({ OPENID: checkOpenId });
      
      if (isAdmin) {
        hasPermission = true;
      }
    }
    
    if (!hasPermission) {
      return utils.errorResponse('无权限查看此订单', 'permission');
    }
    
    // 使用公共方法处理日期格式并返回结果
    const result = {
      // 基础信息
      _id: orderInfo.data._id,
      _openid: orderInfo.data._openid, //  添加 openid 用于权限验证
      status: orderInfo.data.status,
      isPaid: orderInfo.data.isPaid,
      
      // 商品和金额信息
      items: orderInfo.data.items,
      totalFee: orderInfo.data.totalFee,
      
      // 配送信息
      address: orderInfo.data.address,
      contactName: orderInfo.data.contactName,
      contactPhone: orderInfo.data.contactPhone,
      remark: orderInfo.data.remark,
      
      // 时间字段
      createTime: orderInfo.data.createTime,
      updateTime: orderInfo.data.updateTime,
      payTime: orderInfo.data.payTime ? orderInfo.data.payTime : '',
      acceptTime: orderInfo.data.acceptTime ? orderInfo.data.acceptTime : '',
      deliverTime: orderInfo.data.deliverTime ? orderInfo.data.deliverTime : '',
      deliveredTime: orderInfo.data.deliveredTime ? orderInfo.data.deliveredTime : '',
      refundingTime: orderInfo.data.refundingTime ? orderInfo.data.refundingTime : '',
      completeTime: orderInfo.data.completeTime ? orderInfo.data.completeTime : '',
      cancelTime: orderInfo.data.cancelTime ? orderInfo.data.cancelTime : '',
      
      // 中止信息（仅在已中止时显示）
      ...(orderInfo.data.status === ORDER_STATUS.CANCELLED && {
        cancelReason: orderInfo.data.cancelReason,
        cancelOperator: orderInfo.data.cancelOperator
      })
    };
    
    return utils.successResponse(result);
  } catch (err) {
    console.error('getOrderDetail执行异常:', err);
    return utils.errorResponse(err, 'order_check');
  }
}

// 取消订单
async function cancelOrder(event, context) {
  const { orderId, reason = '用户取消订单' } = event;
  const wxContext = cloud.getWXContext();
  
  try {
    // 使用公共方法检查订单权限
    const permissionCheck = await utils.checkOrderPermission(orderId, wxContext);
    if (!permissionCheck.success) {
      return utils.errorResponse(permissionCheck.error);
    }
    
    // 使用状态机执行转换
    const result = await utils.updateOrderStatusWithStateMachine(
      orderId,
      'cancelOrder',
      wxContext.OPENID,
      false,
      '用户取消订单',
      reason
    );
    
    if (!result.success) {
      return utils.errorResponse(result.error);
    }
    
    return utils.successResponse(null, '订单已取消');
  } catch (err) {
    return utils.errorResponse(err, '取消订单');
  }
}

// 更新订单状态
async function updateOrderStatus(event, context) {
  const { orderId, status, reason = '管理员手动更新状态', transitionName } = event
  const wxContext = cloud.getWXContext()
  
  try {
    // 使用公共方法检查管理员权限
    const isAdmin = await utils.checkAdminPermission(wxContext);
    if (!isAdmin) {
      return utils.errorResponse('无权限操作');
    }

    // 先获取当前订单信息
    const orderInfo = await db.collection('orders').doc(orderId).get();
    if (!orderInfo.data) {
      return utils.errorResponse('订单不存在');
    }
    
    // 确定使用哪个状态转换名称
    let actualTransitionName = transitionName;
    
    // 如果没有提供转换名称，但提供了目标状态，则根据状态映射转换名称
    if (!actualTransitionName && status) {
      // 从当前状态到目标状态的映射
      const currentStatus = orderInfo.data.status;
      const statusToTransitionMap = {
        // 映射当前状态到目标状态的转换名称
        'UNPAID': {
          'CANCELLED': 'cancelUnpaidOrder'
        },
        'PAID': {
          'ACCEPTED': 'acceptOrder',
          'CANCELLED': 'cancelOrderByAdmin',
          'REFUNDING': 'requestRefund'
        },
        'ACCEPTED': {
          'DELIVERING': 'startDelivery',
          'CANCELLED': 'cancelOrderByAdmin',
          'REFUNDING': 'requestRefund'
        },
        'DELIVERING': {
          'DELIVERED': 'completeDelivery',
          'CANCELLED': 'cancelOrderByAdmin',
          'REFUNDING': 'requestRefund'
        },
        'DELIVERED': {
          'COMPLETED': 'confirmReceived',
          'REFUNDING': 'requestRefund'
        }
      };
      
      // 查找对应的转换名称
      actualTransitionName = statusToTransitionMap[currentStatus]?.[status];
      
      // 如果没有找到合适的转换，返回错误
      if (!actualTransitionName) {
        return utils.errorResponse(`不支持从 ${currentStatus} 到 ${status} 的状态转换`);
      }
    }
    
    if (!actualTransitionName) {
      return utils.errorResponse('缺少有效的状态转换名称');
    }
    
    // 使用状态机执行转换
    const result = await utils.updateOrderStatusWithStateMachine(
      orderId,
      actualTransitionName,
      wxContext.OPENID,
      true,
      `管理员手动更新状态: ${reason || '无原因'}`,
      reason
    );
    
    return utils.successResponse(result.data, result.message);
  } catch (err) {
    return utils.errorResponse(err, '更新订单状态');
  }
}

// 获取用户订单列表（支持分页）
async function getOrders(event, context) {
  const { 
    page = 1, 
    pageSize = 10,
    status = '', // 可选状态筛选
    timezoneOffset = -480 // 默认东八区，前端可传入
  } = event;
  
  const wxContext = cloud.getWXContext();
  
  try {
    // 性能监控 - 开始计时
    const startTime = Date.now();
    
    // 使用参数校验函数验证参数
    const validationResult = validateQueryParams({
      page,
      pageSize,
      status,
      timezoneOffset
    });
    
    if (!validationResult.success) {
      return utils.errorResponse(validationResult.error);
    }
    
    const { safePage, safePageSize, status: validatedStatus } = validationResult.data;
    
    // 构建查询条件
    const query = {
      _openid: wxContext.OPENID
    };
    
    // 可选的状态筛选
    if (validatedStatus) {
      query.status = validatedStatus;
    }
    
    // 并行执行计数和数据查询
    const [countResult, dataResult] = await Promise.all([
      db.collection('orders').where(query).count(),
      db.collection('orders')
        .where(query)
        .orderBy('createTime', 'desc')
        .skip((safePage - 1) * safePageSize)
        .limit(safePageSize)
        .field({
          _id: true,
          createTime: true,
          updateTime: true,
          status: true,
          isPaid: true,
          items: true,
          totalFee: true,
          address: true,
          contactName: true,
          contactPhone: true,
          remark: true
        })
        .get()
    ]);
    
    const total = countResult.total;
    
    // 记录查询性能
    const queryTime = Date.now() - startTime;
    
    // 性能告警
    if (queryTime > 1000) {
      console.warn('⚠️ 用户订单列表查询性能较差，建议检查索引配置');
    }
    
    return utils.successResponse({
      list: dataResult.data,
      pagination: {
        current: safePage,
        pageSize: safePageSize,
        total,
        totalPages: Math.ceil(total / safePageSize)
      }
    });
  } catch (err) {
    console.error('获取订单列表失败:', err);
    return utils.errorResponse(err, '获取订单列表');
  }
}

//  管理员接单
async function acceptOrder(event, context) {
  const { orderId, remark = '' } = event;
  const wxContext = cloud.getWXContext();
  
  try {
    // 检查管理员权限
    const isAdmin = await utils.checkAdminPermission(wxContext);
    if (!isAdmin) {
      return utils.errorResponse('无权限操作');
    }
    
    // 使用状态机执行转换
    const result = await utils.updateOrderStatusWithStateMachine(
      orderId,
      'acceptOrder',
      wxContext.OPENID,
      true,
      remark || '管理员已接单'
    );
    
    if (!result.success) {
      return utils.errorResponse(result.error);
    }
    
    return utils.successResponse(null, '接单成功');
  } catch (err) {
    return utils.errorResponse(err, '接单操作');
  }
}

//  管理员开始配送
async function startDelivery(event, context) {
  const { orderId, remark = '' } = event;
  const wxContext = cloud.getWXContext();
  
  try {
    // 检查管理员权限
    const isAdmin = await utils.checkAdminPermission(wxContext);
    if (!isAdmin) {
      return utils.errorResponse('无权限操作');
    }
    
    // 使用状态机执行转换
    const result = await utils.updateOrderStatusWithStateMachine(
      orderId,
      'startDelivery',
      wxContext.OPENID,
      true,
      remark || '管理员开始配送'
    );
    
    if (!result.success) {
      return utils.errorResponse(result.error);
    }
    
    return utils.successResponse(null, '开始配送');
  } catch (err) {
    return utils.errorResponse(err, '开始配送操作');
  }
}

//  管理员完成配送
async function completeDelivery(event, context) {
  const { orderId, remark = '' } = event;
  const wxContext = cloud.getWXContext();
  
  try {
    // 检查管理员权限
    const isAdmin = await utils.checkAdminPermission(wxContext);
    if (!isAdmin) {
      return utils.errorResponse('无权限操作');
    }
    
    // 使用状态机执行转换
    const result = await utils.updateOrderStatusWithStateMachine(
      orderId,
      'completeDelivery',
      wxContext.OPENID,
      true,
      remark || '管理员已完成配送，等待用户确认收货'
    );
    
    if (!result.success) {
      return utils.errorResponse(result.error);
    }
    
    return utils.successResponse(null, '配送完成，等待用户确认收货');
  } catch (err) {
    return utils.errorResponse(err, '完成配送操作');
  }
}

//  用户确认收货
async function confirmReceived(event, context) {
  const { orderId, remark = '' } = event;
  const wxContext = cloud.getWXContext();
  
  try {
    // 获取订单信息并检查权限
    const orderInfo = await db.collection('orders').doc(orderId).get();
    if (!orderInfo.data) {
      return utils.errorResponse('订单不存在');
    }
    
    // 检查订单所有权
    if (orderInfo.data._openid !== wxContext.OPENID) {
      return utils.errorResponse('无权限操作此订单');
    }
    
    // 使用状态机执行转换
    const result = await utils.updateOrderStatusWithStateMachine(
      orderId,
      'confirmReceived',
      wxContext.OPENID,
      false,
      remark || '用户已确认收货'
    );
    
    if (!result.success) {
      return utils.errorResponse(result.error);
    }
    
    return utils.successResponse(null, '确认收货成功，订单已完成');
  } catch (err) {
    return utils.errorResponse(err, '确认收货操作');
  }
}

//  管理员中止订单（带自动退款）
async function cancelOrderByAdmin(event, context) {
  const { orderId, reason = '管理员取消订单' } = event;
  const wxContext = cloud.getWXContext();
  
  try {
    // 检查管理员权限
    const isAdmin = await utils.checkAdminPermission(wxContext);
    if (!isAdmin) {
      return utils.errorResponse('无权限操作');
    }
    
    // 先获取当前订单信息
    const orderInfo = await db.collection('orders').doc(orderId).get();
    if (!orderInfo.data) {
      return utils.errorResponse('订单不存在');
    }
    
    const currentStatus = orderInfo.data.status;
    
    // 判断是否需要退款
    const needsRefund = await orderStateMachine.needsRefund(currentStatus, 'refunding');
    
    if (needsRefund) {
      // 先将订单状态设置为退款中
      const refundingResult = await utils.updateOrderStatusWithStateMachine(
        orderId,
        'refundOrder',
        wxContext.OPENID,
        true,
        `管理员执行退款操作：${reason}`,
        reason
      );
      
      if (!refundingResult.success) {
        return utils.errorResponse(`设置订单状态为退款中失败：${refundingResult.error}`);
      }
      
      // 第一阶段：返回响应，告知前端退款申请已提交
      const response = utils.successResponse(null, '退款申请已提交，处理中');
      
      // 第二阶段：异步处理退款，不阻塞响应
      const refundPromise = utils.processOrderRefund(orderId, reason, wxContext.OPENID)
        .then(refundData => {
          // 退款成功的状态更新由refundCallback云函数处理
          logger.info('退款请求已提交，等待微信支付回调', {
            orderId,
            operatorId: wxContext.OPENID,
            refundId: refundData.refundId || ''
          });
        })
        .catch(async refundError => {
          logger.error('退款请求失败，执行错误处理', {
            orderId,
            error: refundError.message || String(refundError)
          });
          
          // 退款失败处理
          const errorResponse = errorHandler.handleRefundError(refundError);
          
          // 异步创建商户通知
          errorHandler.createMerchantNotice(orderId, errorResponse, wxContext.OPENID)
            .then(() => {
              logger.info('退款失败通知已创建', { orderId });
            })
            .catch(noticeError => {
              logger.error('创建退款失败通知失败', {
                orderId,
                error: noticeError.message || String(noticeError)
              });
            });
          
          // 回滚订单状态
          await utils.updateOrderStatusWithStateMachine(
            orderId,
            'cancelRefund',
            wxContext.OPENID,
            true,
            `退款失败，回滚状态：${errorResponse.userMessage}`,
            errorResponse.userMessage
          ).then(rollbackResult => {
            logger.info('订单状态已回滚', {
              orderId,
              success: rollbackResult.success
            });
          }).catch(rollbackError => {
            logger.error('订单状态回滚失败', {
              orderId,
              error: rollbackError.message || String(rollbackError)
            });
          });
        });
      
      // 返回先前准备好的响应，不等待异步操作
      return response;
    } else {
      // 不需要退款，直接取消
      const result = await utils.updateOrderStatusWithStateMachine(
        orderId,
        'cancelOrderByAdmin',
        wxContext.OPENID,
        true,
        `管理员取消订单：${reason}`,
        reason
      );
      
      if (!result.success) {
        return utils.errorResponse(result.error);
      }
      
      return utils.successResponse(null, '订单已取消');
    }
  } catch (err) {
    return utils.errorResponse(err, '管理员取消订单');
  }
}

/**
 * 使用状态机批量更新订单状态
 * @param {Array<string>} orderIds - 订单ID数组
 * @param {string} transitionName - 转换名称
 * @param {object} options - 附加选项 {operatorId, isAdminOperation, reason, remark}
 * @returns {Promise<Object>}
 */
async function updateOrderStatusBatchWithStateMachine(orderIds, transitionName, options = {}) {
  if (!orderIds || orderIds.length === 0) {
    return {
      success: false,
      error: '订单ID列表为空'
    };
  }

  try {
    // 直接使用orderStateMachine的批量处理方法
    return await orderStateMachine.executeBatchTransition(orderIds, transitionName, {
      operatorId: options.operatorId || 'system',
      isAdminOperation: !!options.isAdminOperation,
      reason: options.reason || '',
      remark: options.remark || ''
    });
  } catch (error) {
    logger.error('批量更新订单状态失败', { error: error.message || String(error) });
    return {
      success: false,
      error: '批量更新订单状态失败: ' + (error.message || String(error))
    };
  }
}

/**
 * 批量更新订单状态
 * @param {Array} orderIds - 订单ID数组
 * @param {String} newStatus - 新状态
 * @param {String} operatorId - 操作人ID
 * @param {String} remark - 备注
 * @returns {Object} 更新结果
 */
//  自动确认超时订单（定时任务调用）- 游标分页版
async function autoConfirmOrders(event, context) {
  try {
    console.log('开始执行自动确认订单任务，参数:', event);
    
    // 1. 从事件中获取游标信息
    const { cursor } = event || {};
    
    // 2. 初始化处理计数器和状态变量
    let processedTotal = cursor?.processedTotal || 0;
    let successCount = cursor?.successCount || 0;
    let failureCount = cursor?.failureCount || 0;
    const batchSize = 100; // 每批处理数量
    
    // 3. 计算7天前的时间点
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    // 4. 构建查询条件
    const queryCondition = {
      status: ORDER_STATUS.DELIVERED,
      deliveredTime: _.lt(sevenDaysAgo)
    };
    
    // 5. 如果有游标，添加ID范围条件（使用ID排序保持稳定性）
    let query = db.collection('orders').where(queryCondition);
    
    if (cursor?.lastId) {
      // 使用上次处理的最后ID作为起点，确保不重复处理
      query = query.where({
        _id: _.gt(cursor.lastId)
      });
    }
    
    // 6. 查询本批次要处理的订单
    const ordersResult = await query
      .orderBy('_id', 'asc') // 按ID升序排列，确保游标稳定性
      .limit(batchSize)
      .get();
    
    const orders = ordersResult.data;
    console.log(`查询到${orders.length}个待处理订单`);
    
    // 7. 如果没有更多订单，返回完成状态
    if (orders.length === 0) {
      const summary = {
        completed: true,
        totalProcessed: processedTotal,
        successCount: successCount,
        failureCount: failureCount
      };
      console.log('自动确认订单任务完成:', summary);
      return utils.successResponse(summary, 
        `自动确认完成，共处理${processedTotal}个订单，成功${successCount}个，失败${failureCount}个`);
    }
    
    // 8. 记录本批次的最后一个ID，用于下次查询
    const lastId = orders[orders.length - 1]._id;
    
    // 9. 处理本批次订单
    let batchSuccess = 0;
    let batchFailure = 0;
    
    // 10. 使用状态机批量处理方法
    const orderIds = orders.map(order => order._id);
    const batchResult = await updateOrderStatusBatchWithStateMachine(
      orderIds, 
      'confirmReceived', // 使用状态机中的转换名称
      {
        operatorId: 'system',
        isAdminOperation: true,
        remark: '超过7天自动确认收货'
      }
    );
    
    if (batchResult.success) {
      batchSuccess = batchResult.data.updated;
      batchFailure = orderIds.length - batchResult.data.updated;
    } else {
      batchFailure = orderIds.length;
      console.error('批量处理订单失败:', batchResult.error);
    }
    
    // 11. 更新统计数据
    processedTotal += orders.length;
    successCount += batchSuccess;
    failureCount += batchFailure;
    
    console.log(`本批次处理结果: 成功=${batchSuccess}, 失败=${batchFailure}, 总处理=${processedTotal}`);
    
    // 12. 检查是否还有更多数据需要处理
    if (orders.length === batchSize) {
      // 13. 更新游标并准备下一批次处理
      const newCursor = {
        lastId: lastId,
        processedTotal: processedTotal,
        successCount: successCount,
        failureCount: failureCount,
        timestamp: Date.now()
      };
      
      // 14. 根据执行环境决定如何继续处理
      try {
        // 如果支持递归调用且剩余时间足够，直接处理下一批
        if (context && context.getRemainingTimeInMillis && typeof context.getRemainingTimeInMillis === 'function') {
          const remainingTime = context.getRemainingTimeInMillis();
          // 如果剩余执行时间充足（预留20秒），继续处理
          if (remainingTime > 20000) {
            console.log(`剩余执行时间充足(${remainingTime}ms)，继续处理下一批`);
            
            // 递归调用自身，处理下一批
            const nextBatchEvent = { 
              ...event,
              cursor: newCursor 
            };
            
            return await autoConfirmOrders(nextBatchEvent, context);
          }
        }
        
        // 如果不支持递归或时间不足，通过触发新的云函数调用继续处理
        console.log('触发新函数继续处理后续订单');
        
        await cloud.callFunction({
          name: 'order',
          data: {
            type: 'autoConfirmOrders',
            cursor: newCursor
          }
        });
        
        return utils.successResponse({
          completed: false,
          inProgress: true,
          processedSoFar: processedTotal,
          successCount: successCount,
          failureCount: failureCount,
          cursor: newCursor
        }, `自动确认进行中，已处理${processedTotal}个订单，将继续处理`);
      } catch (continueError) {
        console.error('触发下一批次处理失败:', continueError);
        
        // 尽管触发失败，仍返回当前批次的处理结果
        return utils.successResponse({
          completed: false,
          inProgress: false,
          processedSoFar: processedTotal,
          successCount: successCount,
          failureCount: failureCount,
          cursor: newCursor,
          continueError: continueError.message
        }, `已处理${processedTotal}个订单，但触发继续处理失败`);
      }
    }
    
    // 15. 全部订单处理完成
    return utils.successResponse({
      completed: true,
      totalProcessed: processedTotal,
      successCount: successCount,
      failureCount: failureCount
    }, `自动确认全部完成，共处理${processedTotal}个订单，成功${successCount}个，失败${failureCount}个`);
    
  } catch (err) {
    console.error('自动确认订单执行异常:', err);
    return utils.errorResponse(err, '自动确认订单');
  }
}

//  获取订单状态历史
async function getOrderHistory(event, context) {
  const { 
    orderId, 
    dateStart = '', 
    dateEnd = '',
    page = 1, 
    pageSize = 20,
    timezoneOffset = -480 // 默认东八区，前端可传入
  } = event;
  const wxContext = cloud.getWXContext();
  
  try {
    // 验证参数
    if (!orderId) {
      return utils.errorResponse('订单ID不能为空');
    }
    
    // 检查权限：订单所有者或管理员
    const permissionCheck = await utils.checkOrderPermission(orderId, wxContext);
    if (!permissionCheck.success) {
      return utils.errorResponse('无权限查看此订单历史');
    }
    
    // 使用参数校验函数验证分页参数
    const validationResult = validateQueryParams({
      page,
      pageSize,
      dateStart,
      dateEnd,
      timezoneOffset
    });
    
    if (!validationResult.success) {
      return utils.errorResponse(validationResult.error);
    }
    
    const { safePage, safePageSize, startDate, endDate } = validationResult.data;
    
    // 构建查询条件
    let query = { orderId: orderId };
      
    // 添加时间范围过滤
    if (startDate || endDate) {
      if (startDate && endDate) {
        // 同时有开始和结束日期
        query.createTime = _.and([_.gte(startDate), _.lte(endDate)]);
      } else if (startDate) {
        // 只有开始日期
        query.createTime = _.gte(startDate);
      } else if (endDate) {
        // 只有结束日期
        query.createTime = _.lte(endDate);
      }
    }
    
    // 执行查询
    const result = await db.collection('order_history')
      .where(query)
      .orderBy('createTime', 'desc')
      .skip((safePage - 1) * safePageSize)
      .limit(safePageSize)
      .get();
    
    // 如果查询结果为空，则返回空数组
    if (!result || !result.data || result.data.length === 0) {
      return utils.successResponse({
        orderId: orderId,
        history: [],
        pagination: {
          page: safePage,
          pageSize: safePageSize, 
          total: 0,
          totalPages: 0
        }
      });
    }

    //  查询总记录数，用于前端分页
    const countResult = await db.collection('order_history')
      .where({ orderId: orderId })
      .count();
    
    return utils.successResponse({
      orderId: orderId,
      history: result.data,
      pagination: {
        page: safePage,
        pageSize: safePageSize,
        total: countResult.total || 0,
        totalPages: Math.ceil((countResult.total || 0) / safePageSize)
      }
    });
    
  } catch (err) {
    console.error('获取订单历史失败:', err);
    return utils.errorResponse(err, '获取订单历史失败');
  }
}