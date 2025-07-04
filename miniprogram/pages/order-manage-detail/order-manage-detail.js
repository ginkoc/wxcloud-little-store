// 引入基础页面类
const basePage = require('../../utils/basePage');
//  引入订单工具类
const { ORDER_STATUS, OrderUtils } = require('../../utils/orderUtils');
//  引入订单状态历史处理工具类
const OrderHistoryUtils = require('../../utils/orderHistoryUtils');
//  引入价格工具类
const PriceUtils = require('../../utils/priceUtils');

// 页面配置对象
const pageConfig = {
  data: {
    orderId: '',
    orderInfo: null,
    loading: true,
    dataChanged: false, // 标记数据是否有变更
    showStatusHistory: false,  // 默认展开状态历史
    loadingHistory: false,
    historyLoaded: false,
    historyPage: 1,
    historyPageSize: 4,
    hasMoreHistory: false,
    isLoadingMore: false,
    showRefundDetails: false,
    refundDetails: null,
    
    // 模板中仍在使用的字段
    statusHistoryList: [], // 状态历史列表
  },

  onLoad: function(options) {
    const { orderId } = options;
    if (!orderId) {
      this.$showError('缺少订单ID');
      setTimeout(() => {
        wx.navigateBack();
      }, 1000);
      return;
    }

    // 🔒 首先检查管理员权限
    this.checkAdminPermission().then(() => {
      // 权限验证通过后加载订单详情
      this.setData({ orderId });
      setTimeout(() => {
        this.loadOrderDetail(orderId);
      }, 100);
    }).catch(() => {
      // 权限不足，返回上级页面
      this.$showError('权限不足，无法访问管理页面');
      setTimeout(() => {
        wx.navigateBack({
          fail: () => {
            wx.redirectTo({
              url: '/pages/index/index'
            });
          }
        });
      }, 1500);
    });
  },
  
  onUnload: function() {
    // 页面特定的清理逻辑
    if (this.data.dataChanged) {
      const pages = getCurrentPages();
      if (pages.length > 1) {
        const prevPage = pages[pages.length - 2];
        if (prevPage && prevPage.data) {
          prevPage.setData({
            needRefresh: true
          });
        }
      }
    }
  },

  // 页面初次渲染完成后加载数据
  onReady: function() {
    // 如果onLoad中没有开始加载数据，这里作为备用
    if (this.data.orderId && this.data.loading && !this.data.orderInfo) {
      this.loadOrderDetail(this.data.orderId);
    }
  },

  // 🔧 统一：加载订单详情（安全金额处理 + 完整时间格式化 + 管理员性能监控）
  loadOrderDetail: function(orderId) {
    console.log(`开始加载订单详情: ${orderId}`);
    
    this.setData({
      loading: true,
      orderId: orderId
    });
    
    const startTime = Date.now();
    
    this.$callCloudFunction('order', {
      type: 'getOrderDetail',
      orderId: orderId
    }, {
      loadingText: '加载订单详情...',
      errorTitle: '获取订单详情失败',
      pageName: '订单管理详情',
      showLoading: false // 不显示系统loading，使用页面自己的loading状态
    }).then(result => {
      const loadTime = Date.now() - startTime;
      console.log(`订单详情加载成功，耗时: ${loadTime}ms`, result.data);
      
      //  处理订单状态显示转换
      const orderInfo = result.data;
      try {
        orderInfo.statusText = OrderUtils.getStatusText(orderInfo.status);
        orderInfo.statusColor = OrderUtils.getStatusColor(orderInfo.status);
        
        // 🔧 统一：安全的金额处理（与order-detail一致的容错机制）
        let finalTotalFee = 0;
        let formattedTotalPrice = '0.00';
        
        if (orderInfo.totalFee && Number.isInteger(parseInt(orderInfo.totalFee))) {
          // 数据完整，直接使用totalFee字段（分单位）
          finalTotalFee = parseInt(orderInfo.totalFee);
          formattedTotalPrice = (finalTotalFee / 100).toFixed(2);
        } else if (orderInfo.items && Array.isArray(orderInfo.items)) {
          // 🔧 容错：totalFee缺失时，从商品列表重新计算
          console.warn('订单totalFee字段异常，从商品列表重新计算:', orderInfo._id);
          finalTotalFee = PriceUtils.calculateTotal(orderInfo.items);
          formattedTotalPrice = PriceUtils.centToYuan(finalTotalFee);
        } else {
          // 🔧 兜底：数据完全异常时的处理
          console.error('订单缺少totalFee字段和有效商品列表:', orderInfo._id);
          finalTotalFee = 0;
          formattedTotalPrice = '0.00';
        }
        
        // 设置处理后的金额
        orderInfo.totalFee = finalTotalFee;
        orderInfo.formattedTotalPrice = formattedTotalPrice;
        
        //  为订单商品项添加格式化价格显示
        if (orderInfo.items && Array.isArray(orderInfo.items)) {
          orderInfo.items = orderInfo.items.map(item => ({
            ...item,
            formattedProductPrice: PriceUtils.centToYuan(item.productPrice),
            formattedSubtotal: PriceUtils.centToYuan(item.subtotal || (item.productPrice * item.quantity))
          }));
        }

        // 🔧 统一：格式化所有时间字段（保持与order-detail一致）
        const timeFields = {
          createTime: orderInfo.createTime,
          updateTime: orderInfo.updateTime,
          payTime: orderInfo.payTime,
          acceptTime: orderInfo.acceptTime,
          deliverTime: orderInfo.deliverTime, 
          deliveredTime: orderInfo.deliveredTime,
          completeTime: orderInfo.completeTime,
          cancelTime: orderInfo.cancelTime,
          refundingTime: orderInfo.refundingTime
        };
        
        // 格式化存在的时间字段
        Object.keys(timeFields).forEach(field => {
          if (timeFields[field]) {
            orderInfo[field] = this.$formatTime(timeFields[field]);
          }
        });
      } catch (error) {
        console.error('转换订单状态显示失败:', error);
        orderInfo.statusText = orderInfo.status || '未知状态';
        orderInfo.statusColor = '#999999';
        orderInfo.displayPrice = '0.00'; // 用户友好显示
      }
      
      this.setData({
        orderInfo: orderInfo,
        loading: false
      });
      
      // 加载订单历史记录
      if (this.data.showStatusHistory) {
        console.log('自动加载订单历史记录');
        this.loadStatusHistory();
      }
    }).catch(err => {
      const loadTime = Date.now() - startTime;
      console.error(`订单详情加载失败，耗时: ${loadTime}ms`, err);
      
      this.setData({
        loading: false
      });
      
      // 提供更友好的错误提示
      let errorMessage = '获取订单详情失败';
      if (err && err.message) {
        if (err.message.includes('权限')) {
          errorMessage = '您没有权限查看此订单';
        } else if (err.message.includes('不存在')) {
          errorMessage = '订单不存在或已被删除';
        } else if (err.message.includes('网络')) {
          errorMessage = '网络连接失败，请检查网络后重试';
        }
      }
      
      this.$showError(errorMessage);
      
      // 如果是关键错误，延迟返回上一页
      setTimeout(() => {
        wx.navigateBack({
          fail: () => {
            wx.redirectTo({
              url: '/pages/order-manage/order-manage'
            });
          }
        });
      }, 2000);
    });
  },

  //  管理员接单
  acceptOrder: function() {
    OrderUtils.handleAcceptOrder(
      this.data.orderInfo,
      this.$callCloudFunction.bind(this),
      this.$showToast.bind(this),
      this.$showConfirm.bind(this),
      this.$showSuccess.bind(this),
      () => {
        // 成功回调：设置数据变更标记并刷新订单详情
        this.setData({
          dataChanged: true
        });
        this.loadOrderDetail(this.data.orderInfo._id);
      }
    );
  },

  //  管理员开始配送
  startDelivery: function() {
    const orderInfo = this.data.orderInfo;
    if (!orderInfo) {
      this.$showToast('订单信息无效');
      return;
    }

    if (orderInfo.status !== ORDER_STATUS.ACCEPTED) {
      this.$showToast('订单状态不正确，无法开始配送');
      return;
    }

    this.$showConfirm('开始配送', '确定要开始配送这个订单吗？', () => {
      this.$callCloudFunction('order', {
        type: 'startDelivery',
        orderId: orderInfo._id
      }, {
        loadingText: '处理中...',
        errorTitle: '开始配送失败',
        pageName: '订单详情'
      }).then(result => {
        this.$showSuccess('开始配送');
        // 更新数据变更标记并刷新订单详情
        this.setData({
          dataChanged: true
        });
        this.loadOrderDetail(orderInfo._id);
      }).catch(err => {
        console.error('开始配送失败:', err);
      });
    });
  },

  //  管理员完成配送
  completeDelivery: function() {
    const orderInfo = this.data.orderInfo;
    if (!orderInfo) {
      this.$showToast('订单信息无效');
      return;
    }

    if (orderInfo.status !== ORDER_STATUS.DELIVERING) {
      this.$showToast('订单状态不正确，无法完成配送');
      return;
    }

    this.$showConfirm('完成配送', '确定已完成配送吗？完成后等待用户确认收货。', () => {
      this.$callCloudFunction('order', {
        type: 'completeDelivery',
        orderId: orderInfo._id
      }, {
        loadingText: '处理中...',
        errorTitle: '完成配送失败',
        pageName: '订单详情'
      }).then(result => {
        this.$showSuccess('配送完成');
        // 更新数据变更标记并刷新订单详情
        this.setData({
          dataChanged: true
        });
        this.loadOrderDetail(orderInfo._id);
      }).catch(err => {
        console.error('完成配送失败:', err);
      });
    });
  },

  //  管理员中止订单（优化版）
  cancelOrderByAdmin: function() {
    const orderInfo = this.data.orderInfo;
    if (!orderInfo) {
      this.$showToast('订单信息无效');
      return;
    }

    // 🔧 参考淘宝、美团的做法：先检查订单状态再操作
    if (orderInfo.status === ORDER_STATUS.CANCELLED) {
      this.$showToast('订单已中止');
      return;
    }

    if (orderInfo.status === ORDER_STATUS.COMPLETED) {
      this.$showToast('订单已完成，无法中止');
      return;
    }

    if (orderInfo.status === ORDER_STATUS.PENDING_PAYMENT) {
      this.$showToast('待支付订单无法中止，请等待支付超时自动取消');
      return;
    }

    //  多步骤确认流程，参考主流平台
    wx.showModal({
      title: '中止订单',
      content: '请输入中止原因（必填）',
      editable: true,
      placeholderText: '请详细说明中止原因...',
      confirmText: '确认中止',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          const reason = res.content.trim();
          
          // 🔧 验证输入
          if (!reason || reason.length < 3) {
            this.$showToast('请输入至少3个字符的中止原因');
            return;
          }

          //  最终确认，显示可能的后果
          const needsRefund = [ORDER_STATUS.PAID, ORDER_STATUS.ACCEPTED, ORDER_STATUS.DELIVERING, ORDER_STATUS.DELIVERED].includes(orderInfo.status);
          const confirmMessage = needsRefund 
            ? `确定要中止此订单吗？\n\n将会执行以下操作：\n• 中止订单处理\n• 自动发起退款\n• 通知用户\n\n中止原因：${reason}`
            : `确定要中止此订单吗？\n\n中止原因：${reason}`;
          
          this.$showConfirm('最终确认', confirmMessage, () => {
            this.executeCancelOrder(orderInfo._id, reason);
          });
        }
      }
    });
  },

  //  执行中止订单（分离业务逻辑）
  executeCancelOrder: function(orderId, reason) {
    // 🔧 显示详细的进度提示
    let loadingTitle = '正在中止订单...';
    const needsRefund = [ORDER_STATUS.PAID, ORDER_STATUS.ACCEPTED, ORDER_STATUS.DELIVERING, ORDER_STATUS.DELIVERED].includes(this.data.orderInfo.status);
    
    if (needsRefund) {
      loadingTitle = '正在处理退款...';
    }

    //  使用可中断的loading，参考微信支付的做法
    wx.showLoading({
      title: loadingTitle,
      mask: true
    });

    //  设置超时处理
    const timeoutId = setTimeout(() => {
      wx.hideLoading();
      //  创建超时错误对象，包含详细信息
      const timeoutError = {
        errCode: -504003,
        message: 'cloud.callFunction:fail Error: errCode: -504003 | errMsg: Invoking task timed out after 25 seconds',
        errMsg: 'Invoking task timed out after 25 seconds',
        callId: Date.now() + '-timeout',
        trace: '前端设置的25秒超时保护'
      };
      this.handleCancelOrderError(timeoutError, orderId, reason);
    }, 25000); // 25秒超时，比云函数30秒略短

    //  调用云函数，增强错误处理
    this.$callCloudFunction('order', {
      type: 'cancelOrderByAdmin',
      orderId: orderId,
      reason: reason
    }, {
      showLoading: false, // 使用自定义loading
      showErrorToast: false, // 使用自定义错误处理
      pageName: '订单详情'
    }).then(result => {
      clearTimeout(timeoutId);
      wx.hideLoading();
      
      //  成功处理
      this.handleCancelOrderSuccess(result.message || '订单已成功中止');
      
    }).catch(err => {
      clearTimeout(timeoutId);
      wx.hideLoading();
      
      //  错误分类处理，保留完整错误信息
      this.handleCancelOrderError(err, orderId, reason);
    });
  },

  //  处理中止订单成功（增强版）
  handleCancelOrderSuccess: function(message) {
    // 🔧 判断是否为异步退款操作
    const isAsyncRefund = message.includes('退款正在处理中');
    
    if (isAsyncRefund) {
      //  异步退款的特殊处理，参考支付宝的做法
      wx.showModal({
        title: '订单已中止',
        content: `${message}\n\n退款预计1-3分钟内完成，您可以：\n• 点击"查看进度"实时跟踪\n• 稍后刷新页面查看结果`,
        confirmText: '查看进度',
        cancelText: '稍后查看',
        success: (res) => {
          this.setData({ dataChanged: true });
          
          if (res.confirm) {
            // 用户选择查看进度，启动轮询
            this.startRefundStatusPolling();
          } else {
            // 用户选择稍后查看，只刷新一次
            this.loadOrderDetail(this.data.orderId);
          }
        }
      });
    } else {
      // 🔧 普通操作的成功提示
      wx.showModal({
        title: '操作成功',
        content: message + '\n\n页面将自动刷新',
        showCancel: false,
        confirmText: '知道了',
        success: () => {
          this.setData({ dataChanged: true });
          this.loadOrderDetail(this.data.orderId);
        }
      });
    }
  },

  //  启动退款状态轮询（参考微信支付的轮询机制）
  startRefundStatusPolling: function() {
    // 显示轮询状态
    wx.showLoading({
      title: '正在查询退款状态...',
      mask: true
    });

    let pollCount = 0;
    const maxPollCount = 12; // 最多轮询12次（约3分钟）
    const pollInterval = 15000; // 每15秒轮询一次

    const pollRefundStatus = () => {
      pollCount++;
      
      // 查询最新的订单状态
      this.$callCloudFunction('order', {
        type: 'getOrderDetail',
        orderId: this.data.orderId
      }, {
        showLoading: false,
        showErrorToast: false,
        pageName: '退款状态轮询'
      }).then(result => {
        const orderInfo = result.data;
        const currentStatus = orderInfo.status;
        
        console.log(`退款轮询第${pollCount}次，当前状态: ${currentStatus}`);
        
        // 🔧 检查退款是否完成
        if (currentStatus === ORDER_STATUS.CANCELLED) {
          // 退款成功完成
          wx.hideLoading();
          this.showRefundCompletionResult(true, '退款已完成，订单已中止');
          return;
        }
        
        // 🔧 检查是否回滚到原状态（退款失败）
        if (currentStatus !== ORDER_STATUS.REFUNDING) {
          // 可能是退款失败回滚了
          wx.hideLoading();
          this.showRefundCompletionResult(false, '退款处理遇到问题，请查看订单状态或联系客服');
          return;
        }
        
        // 🔧 继续轮询或超时
        if (pollCount < maxPollCount) {
          //  简化loading提示，不显示进度
          wx.showLoading({
            title: '退款处理中，请稍候...',
            mask: true
          });
          
          setTimeout(pollRefundStatus, pollInterval);
        } else {
          // 轮询超时
          wx.hideLoading();
          this.showRefundTimeoutResult();
        }
      }).catch(err => {
        console.error('轮询退款状态失败:', err);
        
        if (pollCount < maxPollCount) {
          // 网络错误，继续重试
          setTimeout(pollRefundStatus, pollInterval);
        } else {
          wx.hideLoading();
          this.showRefundTimeoutResult();
        }
      });
    };

    // 立即开始第一次轮询
    pollRefundStatus();
  },

  //  显示退款完成结果
  showRefundCompletionResult: function(success, message) {
    const title = success ? '退款成功' : '退款异常';
    const icon = success ? 'success' : 'none';
    
    wx.showModal({
      title: title,
      content: `${message}\n\n页面将自动刷新显示最新状态`,
      showCancel: false,
      confirmText: '知道了',
      success: () => {
        // 刷新订单详情
        this.loadOrderDetail(this.data.orderId);
      }
    });
  },

  //  显示退款超时结果
  showRefundTimeoutResult: function() {
    wx.showModal({
      title: '退款处理中',
      content: '退款正在后台处理，可能需要更多时间。\n\n您可以：\n• 稍后手动刷新页面查看\n• 在状态历史中跟踪进度\n• 联系客服了解详情',
      confirmText: '手动刷新',
      cancelText: '稍后查看',
      success: (res) => {
        if (res.confirm) {
          this.loadOrderDetail(this.data.orderId);
        }
      }
    });
  },

  //  错误信息转换层 - 将技术错误转换为用户友好信息
  translateErrorToUserFriendly: function(error) {
    if (!error) return '操作失败，请稍后重试';
    
    const errorMsg = error.message || error.errMsg || error.toString();
    const errorCode = error.errCode || error.errorCode;
    
    // 🔧 微信支付相关错误转换
    if (errorCode) {
      switch (errorCode) {
        case -504003:
          return '处理时间较长，请稍后刷新查看结果';
        case 'NOTENOUGH':
          return '商户账户余额不足，请联系商家处理';
        case 'SYSTEMERROR':
          return '微信支付系统繁忙，请稍后重试';
        case 'ACCOUNT_ERROR':
          return '商户账户配置异常，请联系技术支持';
        case 'INVALID_REQUEST':
          return '请求信息有误，请检查后重试';
        case 'FREQUENCY_LIMITED':
          return '操作过于频繁，请稍后重试';
        case 'ORDERPAID':
          return '订单已支付，无法重复操作';
        case 'OUT_TRADE_NO_USED':
          return '订单号已被使用';
        case 'ORDERNOTEXIST':
          return '原订单不存在，请确认订单信息';
        case 'USER_ACCOUNT_ABNORMAL':
          return '用户账户异常，请联系客服';
        case 'NOT_ENOUGH':
          return '退款金额超出可退金额';
        default:
          // 其他错误代码，尝试从错误信息中提取
          break;
      }
    }
    
    // 🔧 根据错误信息内容转换
    if (errorMsg.includes('timeout') || errorMsg.includes('TIME_LIMIT_EXCEEDED')) {
      return '处理超时，操作可能仍在后台进行，请稍后刷新查看';
    }
    
    if (errorMsg.includes('网络') || errorMsg.includes('network')) {
      return '网络连接不稳定，请检查网络后重试';
    }
    
    if (errorMsg.includes('权限') || errorMsg.includes('unauthorized') || errorMsg.includes('permission')) {
      return '操作权限不足，请确认您的身份';
    }
    
    if (errorMsg.includes('状态') || errorMsg.includes('status')) {
      return '订单状态已发生变化，请刷新页面查看最新状态';
    }
    
    if (errorMsg.includes('余额') || errorMsg.includes('balance')) {
      return '账户余额不足，请联系商家充值';
    }
    
    if (errorMsg.includes('频率') || errorMsg.includes('frequency')) {
      return '操作过于频繁，请稍后再试';
    }
    
    if (errorMsg.includes('签名') || errorMsg.includes('sign')) {
      return '系统配置异常，请联系技术支持';
    }
    
    if (errorMsg.includes('证书') || errorMsg.includes('certificate')) {
      return '系统证书异常，请联系技术支持';
    }
    
    if (errorMsg.includes('参数') || errorMsg.includes('parameter')) {
      return '请求参数有误，请重新操作';
    }
    
    // 🔧 默认友好提示
    return '操作失败，请稍后重试或联系客服协助';
  },

  //  处理中止订单错误（简化版 - 只显示用户友好信息）
  handleCancelOrderError: function(error, orderId, reason) {
    console.error('中止订单失败:', error);
    
    //  使用用户友好的错误转换
    const userFriendlyMessage = this.translateErrorToUserFriendly(error);
    
    // 🔧 确定错误标题和重试建议
    let errorTitle = '操作失败';
    let showRetry = false;
    let showContactService = false;

    if (error && error.message) {
      const errorMsg = error.message;
      const errorCode = error.errCode || error.errorCode;
      
      //  根据错误类型设置标题和操作选项
      if (errorCode === -504003 || errorMsg.includes('timeout')) {
        errorTitle = '处理时间较长';
        showRetry = true;
      }
      else if (errorCode === 'NOTENOUGH' || errorMsg.includes('余额')) {
        errorTitle = '账户余额不足';
        showContactService = true;
      }
      else if (errorCode === 'SYSTEMERROR') {
        errorTitle = '系统繁忙';
        showRetry = true;
      }
      else if (errorMsg.includes('权限')) {
        errorTitle = '权限不足';
        showContactService = true;
      }
      else if (errorMsg.includes('状态')) {
        errorTitle = '订单状态异常';
        showRetry = false;
      }
      else if (errorMsg.includes('网络')) {
        errorTitle = '网络连接问题';
        showRetry = true;
      }
      else {
        //  其他未知错误，简化处理
        errorTitle = '处理失败';
        showRetry = true;
        showContactService = true;
      }
    } else {
      errorTitle = '未知错误';
      showContactService = true;
    }

    //  显示简化的用户友好错误对话框
    this.showSimplifiedError(errorTitle, userFriendlyMessage, orderId, reason, showRetry, showContactService);
  },

  //  显示简化的用户友好错误对话框
  showSimplifiedError: function(title, message, orderId, reason, showRetry = false, showContactService = false) {
    // 🔧 构建用户友好的对话框内容
    let content = message;
    
    if (showContactService) {
      content += '\n\n如需帮助请联系客服：400-XXX-XXXX';
    }

    //  显示简化的错误对话框
    wx.showModal({
      title: title,
      content: content,
      confirmText: showRetry ? '重试' : '知道了',
      cancelText: showRetry ? '稍后处理' : '',
      showCancel: showRetry,
      success: (res) => {
        if (res.confirm && showRetry) {
          // 用户选择重试
          setTimeout(() => {
            this.executeCancelOrder(orderId, reason);
          }, 1000);
        } else {
          // 刷新页面状态
          this.loadOrderDetail(this.data.orderId);
        }
      }
    });
  },

  //  切换状态历史显示
  toggleStatusHistory: function() {
    OrderHistoryUtils.toggleStatusHistory(this, this.loadStatusHistory);
  },
  
  //  加载状态历史（分页版本）
  loadStatusHistory: function() {
    if (this.data.loadingHistory || this.data.historyLoaded) {
      return;
    }
    
    // 重置分页状态
    this.setData({
      loadingHistory: true,
      historyPage: 1,
      hasMoreHistory: true,
      statusHistoryList: []
    });
    
    this.fetchHistoryPage(1);
  },
  
  //  加载更多历史记录
  loadMoreHistory: function() {
    // 如果正在加载或没有更多数据，直接返回
    if (this.data.isLoadingMore || !this.data.hasMoreHistory) {
      return;
    }
    
    const nextPage = this.data.historyPage + 1;
    
    // 设置加载状态
    this.setData({
      isLoadingMore: true
    });
    
    // 调用加载方法
    setTimeout(() => {
      this.fetchHistoryPage(nextPage);
    }, 200);
  },
  
  //  获取指定页的历史数据
  fetchHistoryPage: function(page) {
    this.$callCloudFunction('order', {
      type: 'getOrderHistory',
      orderId: this.data.orderId,
      page: page,
      pageSize: this.data.historyPageSize
    }, {
      showLoading: false,
      showErrorToast: false,
      pageName: '订单状态历史'
    }).then(result => {
      const newList = result.data.history || [];
      const processedList = OrderHistoryUtils.processStatusHistoryList(newList, this.$formatTime.bind(this));
      
      // 合并列表数据
      const mergedList = page === 1 
        ? processedList 
        : [...this.data.statusHistoryList, ...processedList];
      
      // 获取分页信息
      const pagination = result.data.pagination || {};
      
      // 修复：使用服务器返回的分页信息判断是否有更多数据
      // 而不是通过比较返回的记录数量与页大小
      const hasMore = pagination.page < pagination.totalPages;
      
      // 更新状态
      this.setData({
        statusHistoryList: mergedList,
        historyPage: page,
        hasMoreHistory: hasMore,
        loadingHistory: false,
        isLoadingMore: false,
        historyLoaded: true
      });
      
      // 检查最新一条记录是否为退款状态，如果是则刷新整个订单详情
      if (page === 1) {
        const latestRecord = mergedList[0]; // 最新的一条记录（通常按时间倒序）
        const hasLatestRefunding = latestRecord && 
          latestRecord.toStatus === ORDER_STATUS.REFUNDING && 
          latestRecord.operationResult === 1;
          
        if (hasLatestRefunding) {
          setTimeout(() => {
            // 刷新整个订单详情，包括订单状态、退款信息等
            this.loadOrderDetail(this.data.orderId);
          }, 30000);
        }
      }
    }).catch(err => {
      console.error('获取状态历史失败:', err);
      this.setData({
        loadingHistory: false,
        isLoadingMore: false,
        historyLoaded: true
      });
    });
  },
  
  //  刷新状态历史（用于实时更新）
  refreshStatusHistory: function() {
    this.setData({
      historyLoaded: false,
      historyPage: 1,
      statusHistoryList: []
    });
    this.loadStatusHistory();
  },
  
  //  拒绝退款
  rejectRefund: function() {
    this.$showConfirm('确认操作', '确定要拒绝此退款申请吗？', () => {
      // 调用退款处理云函数
      this.$showToast('退款拒绝功能待实现');
    });
  },

  //  通过退款
  approveRefund: function() {
    this.$showConfirm('确认操作', '确定要通过此退款申请吗？', () => {
      // 调用退款处理云函数
      this.$showToast('退款通过功能待实现');
    });
  },

  //  查看退款进度（一键操作）
  checkRefundProgress: function() {
    const orderInfo = this.data.orderInfo;
    if (!orderInfo) return;
    
    // 🔧 显示退款进度查询loading
    wx.showLoading({
      title: '查询退款进度...',
      mask: true
    });

    //  并行查询订单状态和退款详情
    Promise.all([
      this.$callCloudFunction('order', {
        type: 'getOrderDetail',
        orderId: this.data.orderId
      }, {
        showLoading: false,
        showErrorToast: false,
        pageName: '退款进度查询'
      }),
      this.$callCloudFunction('refund', {
        type: 'queryRefund',
        orderId: this.data.orderId
      }, {
        showLoading: false,
        showErrorToast: false,
        pageName: '退款进度查询'
      })
    ]).then(([orderResult, refundResult]) => {
      wx.hideLoading();
      
      const currentStatus = orderResult.data.status;
      const refundData = refundResult.data;
      
      this.showRefundProgressModal(currentStatus, refundData, orderInfo);
      
    }).catch(err => {
      wx.hideLoading();
      console.error('查询退款进度失败:', err);
      
      // 🔧 降级方案：只查询订单状态
      this.loadOrderDetail(this.data.orderId);
      this.$showToast('退款信息查询失败，已刷新订单状态');
    });
  },

  //  显示退款进度弹窗
  showRefundProgressModal: function(currentStatus, refundData, originalOrderInfo) {
    let title = '退款进度';
    let content = '';
    let showActions = false;

    // 🔧 根据当前状态生成进度信息
    switch (currentStatus) {
      case ORDER_STATUS.REFUNDING:
        const timeElapsed = this.calculateTimeElapsed(originalOrderInfo.updateTime);
        title = '退款处理中';
        content = `退款申请已提交，正在处理中...\n\n`;
        content += `• 申请时间：${originalOrderInfo.updateTime}\n`;
        content += `• 已处理时长：${timeElapsed}\n`;
        content += `• 预计完成：1-3分钟内\n\n`;
        
        if (refundData && refundData.refundId) {
          content += `• 退款单号：${refundData.refundId}\n`;
          content += `• 退款金额：¥${(refundData.refundFee / 100).toFixed(2)}`;
        }
        
        showActions = true;
        break;
        
      case ORDER_STATUS.CANCELLED:
        title = '退款已完成';
        content = `订单已成功中止，退款已处理完成。\n\n`;
        if (refundData) {
          content += `• 退款单号：${refundData.refundId || '已完成'}\n`;
          content += `• 退款金额：¥${((refundData.refundFee || originalOrderInfo.totalFee) / 100).toFixed(2)}\n`;
          content += `• 完成时间：${originalOrderInfo.updateTime}`;
        }
        break;
        
      default:
        title = '退款异常';
        content = `退款处理可能遇到问题，当前状态：${currentStatus}\n\n`;
        content += `建议：\n`;
        content += `• 查看状态历史了解详情\n`;
        content += `• 联系技术支持处理\n`;
        content += `• 必要时进行人工退款`;
        showActions = true;
        break;
    }

    //  显示进度弹窗
    wx.showModal({
      title: title,
      content: content,
      confirmText: showActions ? '继续跟踪' : '知道了',
      cancelText: showActions ? '稍后查看' : '',
      showCancel: showActions,
      success: (res) => {
        if (res.confirm && showActions && currentStatus === ORDER_STATUS.REFUNDING) {
          // 用户选择继续跟踪，启动轮询
          this.startRefundStatusPolling();
        } else {
          // 刷新页面状态
          this.loadOrderDetail(this.data.orderId);
        }
      }
    });
  },

  //  计算时间间隔
  calculateTimeElapsed: function(startTime) {
    try {
      const start = new Date(startTime);
      const now = new Date();
      const diffMs = now - start;
      
      const minutes = Math.floor(diffMs / 60000);
      const seconds = Math.floor((diffMs % 60000) / 1000);
      
      if (minutes > 0) {
        return `${minutes}分钟${seconds}秒`;
      } else {
        return `${seconds}秒`;
      }
    } catch (err) {
      return '计算中...';
    }
  },

  //  关闭退款详情
  closeRefundDetails: function() {
    this.setData({
      showRefundDetails: false,
      refundDetails: null
    });
  },

  // 🔒 检查管理员权限
  checkAdminPermission: function() {
    return new Promise((resolve, reject) => {
      this.$callCloudFunction('user', {
        type: 'checkLoginStatus'
      }, {
        showLoading: false,
        showErrorToast: false,
        pageName: '权限检查'
      }).then(result => {
        console.log('权限检查结果:', result.data);
        
        const isLoggedIn = result.data.isLoggedIn || false;
        const userData = result.data.userData || {};
        const isAdmin = userData.isAdmin || false;
        
        if (isLoggedIn && isAdmin) {
          console.log('管理员权限验证通过');
          resolve();
        } else {
          console.log('权限不足:', { isLoggedIn, isAdmin });
          reject(new Error('权限不足'));
        }
      }).catch(err => {
        console.error('权限检查失败:', err);
        reject(err);
      });
    });
  }
};

// 使用基础页面创建页面实例
Page(basePage.createPage('pages/order-manage-detail/order-manage-detail', pageConfig));