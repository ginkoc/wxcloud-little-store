// 引入基础页面类
const basePage = require('../../utils/basePage');
//  引入订单工具类
const { ORDER_STATUS, OrderUtils } = require('../../utils/orderUtils');
//  引入价格工具类
const PriceUtils = require('../../utils/priceUtils');
//  引入订单状态历史处理工具类
const OrderHistoryUtils = require('../../utils/orderHistoryUtils');

// 创建页面配置
const pageConfig = {
  data: {
    orderId: '',
    orderInfo: null,
    loading: true,
    actionButtons: [], //  可执行的操作按钮（仅用户操作）
    
    //  状态历史相关
    showStatusHistory: false, // 是否展开状态历史
    loadingHistory: false, // 是否正在加载状态历史
    statusHistoryList: [], // 状态历史列表
    historyLoaded: false, // 是否已加载过状态历史
    
    // 退款状态轮询相关
    isPolling: false, // 是否正在轮询退款状态
    pollingCount: 0, // 轮询次数
    refundInfo: null, // 退款信息
    
    //  分页加载相关
    historyPage: 1, // 当前页码
    historyPageSize: 4, // 每页加载条数
    hasMoreHistory: true, // 是否有更多历史记录
    isLoadingMore: false // 是否正在加载更多
  },
  
  onLoad: function(options) {
    const { orderId } = options;
    if (orderId) {
      this.setData({ orderId: orderId });    
      
      // 延迟加载订单详情，避免阻塞页面初始化
      setTimeout(() => {
        this.loadOrderDetail(orderId);
      }, 100);
    } else {
      this.$showError('缺少订单ID');
      // 延迟返回，避免阻塞页面初始化
      setTimeout(() => {
        wx.navigateBack();
      }, 1000);
    }
  },
  
  // 页面初次渲染完成后确保数据加载
  onReady: function() {
    if (this.data.orderId && this.data.loading && !this.data.orderInfo) {
      this.loadOrderDetail(this.data.orderId);
    }
  },
  
  // 页面隐藏时停止轮询
  onHide: function() {
    this.stopRefundStatusPolling();
  },
  
  // 页面卸载时停止轮询
  onUnload: function() {
    this.stopRefundStatusPolling();
  },
  
  // 🔧 统一：加载订单详情（安全金额处理 + 完整时间格式化）
  loadOrderDetail: function(orderId) {
    this.$callCloudFunction('order', {
      type: 'getOrderDetail',
      orderId: orderId
    }, {
      loadingText: '加载订单详情...',
      errorTitle: '获取订单详情失败',
      pageName: '订单详情'
    }).then(result => {
      console.log('订单详情:', result.data);
      
      try {
        const orderInfo = result.data;
        
        // 🔧 安全地计算用户可执行的操作按钮（不包含管理员操作）
        let actionButtons = [];
        try {
          actionButtons = OrderUtils.getActionButtons(orderInfo, false); // false表示非管理员
          console.log('用户操作按钮计算成功:', actionButtons);
        } catch (utilsError) {
          console.error('OrderUtils.getActionButtons 出错:', utilsError);
          actionButtons = [];
        }
        
        //  预处理状态显示信息
        let statusText = '未知状态';
        let statusColor = '#999999';
        try {
          statusText = OrderUtils.getStatusText(orderInfo.status);
          statusColor = OrderUtils.getStatusColor(orderInfo.status);
        } catch (utilsError) {
          console.error('处理状态显示信息出错:', utilsError);
        }
        
        // 🔧 统一：安全的金额处理（带容错机制）
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

        // 🔧 统一：格式化所有时间字段（与order-manage-detail一致）
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

        //  为订单商品项添加格式化价格显示
        if (orderInfo.items && Array.isArray(orderInfo.items)) {
          orderInfo.items = orderInfo.items.map(item => ({
            ...item,
            formattedProductPrice: PriceUtils.centToYuan(item.productPrice),
            formattedSubtotal: PriceUtils.centToYuan(item.subtotal || (item.productPrice * item.quantity))
          }));
        }

        this.setData({
          orderInfo: {
            ...orderInfo,
            statusText: statusText,
            statusColor: statusColor,
            // 🔧 使用安全计算后的金额
            totalFee: finalTotalFee,
            formattedTotalPrice: formattedTotalPrice
          },
          actionButtons: actionButtons,
          loading: false
        });
        
        // 如果订单状态为退款中，并且有退款ID，加载退款信息
        if (orderInfo.status === ORDER_STATUS.REFUNDING && orderInfo.refundId) {
          this.loadRefundInfo(orderInfo.refundId);
        } else if (orderInfo.status === ORDER_STATUS.CANCELLED && orderInfo.refundId) {
          // 订单已取消且有退款ID，查询一次退款信息（显示退款详情）
          this.loadRefundInfo(orderInfo.refundId, false);
        }
        
        console.log('订单详情页面数据设置成功');
      } catch (error) {
        console.error('处理订单详情数据时出错:', error);
        // 即使处理出错，也要设置基本数据
        this.setData({
          orderInfo: {
            ...result.data,
            statusText: result.data.status || '未知状态',
            statusColor: '#999999',
            totalFee: 0,
            formattedTotalPrice: '0.00'
          },
          actionButtons: [],
          loading: false
        });
      }
    }).catch(err => {
      console.error('加载订单详情失败:', err);
      this.setData({
        loading: false
      });
      this.$showError('获取订单详情失败');
    });
  },

  // 加载退款信息
  loadRefundInfo: function(refundId, startPolling = true) {
    if (!refundId) {
      console.error('退款ID为空，无法加载退款信息');
      return;
    }
    
    wx.showLoading({ title: '加载退款信息...' });
    
    this.$callCloudFunction('refund', {
      type: 'queryRefund',
      refundId: refundId
    }, {
      showLoading: false,
      showErrorToast: false
    }).then(res => {
      wx.hideLoading();
      
      if (res.result && res.result.success) {
        const refundInfo = res.result.data;
        
        this.setData({ refundInfo });
        
        // 如果退款中且需要轮询，启动轮询
        if (startPolling && 
            this.data.orderInfo && 
            this.data.orderInfo.status === ORDER_STATUS.REFUNDING && 
            refundInfo.status === 'processing') {
          this.startRefundStatusPolling();
        }
      }
    }).catch(err => {
      wx.hideLoading();
      console.error('加载退款信息失败:', err);
    });
  },

  // 开始轮询退款状态
  startRefundStatusPolling: function() {
    if (this.data.isPolling) return;
    
    // 设置轮询参数
    const maxPollCount = 12;      // 最多轮询12次
    const initialInterval = 3000; // 初始3秒
    const maxInterval = 10000;    // 最大10秒
    
    this.setData({
      isPolling: true,
      pollingCount: 0
    });
    
    // 轮询函数
    const pollRefundStatus = () => {
      // 如果页面已卸载或者轮询已停止
      if (!this.data.isPolling) return;
      
      // 达到最大次数，停止轮询
      const currentCount = this.data.pollingCount + 1;
      if (currentCount > maxPollCount) {
        this.setData({ isPolling: false });
        this.showRefundTimeoutTip();
        return;
      }
      
      this.setData({ pollingCount: currentCount });
      
      // 计算当前轮询间隔（逐渐增加间隔时间）
      const currentInterval = Math.min(
        initialInterval * Math.pow(1.5, currentCount - 1),
        maxInterval
      );
      
      // 查询退款状态
      this.$callCloudFunction('refund', {
        type: 'queryRefund',
        refundId: this.data.refundInfo.refundId
      }, {
        showLoading: false,
        showErrorToast: false
      }).then(res => {
        if (res.result && res.result.success) {
          const refundInfo = res.result.data;
          
          // 状态有更新
          if (refundInfo.status !== this.data.refundInfo.status) {
            this.setData({ refundInfo });
            
            // 退款完成 - 显示结果并刷新订单数据
            if (refundInfo.status === 'success' || refundInfo.status === 'failed') {
              this.stopRefundStatusPolling();
              this.showRefundResult(refundInfo);
              this.loadOrderDetail(this.data.orderId);
              return;
            }
          }
          
          // 继续轮询
          setTimeout(pollRefundStatus, currentInterval);
        } else {
          // 查询失败，仍继续轮询但增加延迟
          setTimeout(pollRefundStatus, currentInterval * 1.5);
        }
      }).catch(err => {
        console.error('轮询退款状态失败:', err);
        // 出错仍继续轮询
        setTimeout(pollRefundStatus, currentInterval * 2);
      });
    };
    
    // 开始轮询
    pollRefundStatus();
  },
  
  // 停止退款状态轮询
  stopRefundStatusPolling: function() {
    this.setData({ isPolling: false });
  },
  
  // 显示退款结果
  showRefundResult: function(refundInfo) {
    const isSuccess = refundInfo.status === 'success';
    
    wx.showModal({
      title: isSuccess ? '退款成功' : '退款处理完成',
      content: isSuccess 
        ? '退款已成功处理，资金将退回原支付账户' 
        : `退款结果：${refundInfo.failReason || '未成功，请联系客服'}`,
      showCancel: false,
      confirmText: '我知道了'
    });
  },
  
  // 显示退款超时提示
  showRefundTimeoutTip: function() {
    wx.showModal({
      title: '退款处理中',
      content: '退款正在处理中，可能需要更长时间。您可以稍后刷新页面查看最新状态，如长时间未完成请联系客服。',
      confirmText: '刷新',
      cancelText: '稍后再看',
      success: (res) => {
        if (res.confirm) {
          this.loadOrderDetail(this.data.orderId);
        }
      }
    });
  },
  
  // 查看退款详情
  showRefundDetail: function() {
    const { refundInfo } = this.data;
    if (!refundInfo) {
      if (this.data.orderInfo && this.data.orderInfo.refundId) {
        this.loadRefundInfo(this.data.orderInfo.refundId, false);
        return;
      }
      this.$showToast('无退款信息');
      return;
    }
    
    let statusText = '';
    switch (refundInfo.status) {
      case 'processing':
        statusText = '处理中';
        
        // 计算处理时间
        const createTime = new Date(refundInfo.createTime);
        const now = new Date();
        const diffMinutes = Math.floor((now - createTime) / (1000 * 60));
        
        if (diffMinutes < 5) {
          statusText += '(预计1-3分钟)';
        } else if (diffMinutes > 30) {
          statusText += '(处理时间较长)';
        }
        break;
      case 'success':
        statusText = '已成功';
        break;
      case 'failed':
        statusText = '处理失败';
        break;
      default:
        statusText = '未知状态';
    }
    
    // 构建详情内容
    let content = `退款单号：${refundInfo.refundId}\n`;
    content += `退款金额：¥${(refundInfo.refundFee/100).toFixed(2)}\n`;
    content += `申请时间：${this.formatTime(refundInfo.createTime)}\n`;
    content += `当前状态：${statusText}\n`;
    
    if (refundInfo.completeTime) {
      content += `完成时间：${this.formatTime(refundInfo.completeTime)}\n`;
    }
    
    wx.showModal({
      title: '退款详情',
      content,
      showCancel: false
    });
  },
  
  // 格式化时间
  formatTime: function(dateStr) {
    if (!dateStr) return '';
    
    try {
      const date = new Date(dateStr);
      return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
    } catch (e) {
      return dateStr || '';
    }
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
    console.log('触发加载更多历史记录函数', {
      当前页码: this.data.historyPage,
      加载中状态: this.data.isLoadingMore,
      是否有更多: this.data.hasMoreHistory
    });
    
    // 如果正在加载或没有更多数据，直接返回
    if (this.data.isLoadingMore || !this.data.hasMoreHistory) {
      console.log('跳过加载：', this.data.isLoadingMore ? '正在加载中' : '没有更多数据');
      return;
    }
    
    const nextPage = this.data.historyPage + 1;
    console.log(`准备加载第${nextPage}页数据`);
    
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
      
    }).catch(err => {
      console.error('获取状态历史失败:', err);
      this.setData({
        loadingHistory: false,
        isLoadingMore: false,
        historyLoaded: true
      });
      // 失败时不显示错误，避免干扰用户体验
    });
  },
  
  //  执行订单操作（仅用户操作）
  handleOrderAction: function(e) {
    const { action } = e.currentTarget.dataset;
    const orderInfo = this.data.orderInfo;
    
    if (!orderInfo) return;
    
    switch (action) {
      case 'pay':
        this.payOrder();
        break;
      case 'cancel':
        this.cancelOrder();
        break;
      case 'confirm':
        this.confirmReceived();
        break;
      case 'refund':
        this.requestRefund();
        break;
      default:
        this.$showToast('未知操作');
    }
  },

  //  支付订单
  payOrder: function() {
    const orderId = this.data.orderInfo._id;
    this.$callCloudFunction('order', {
      type: 'createPayment',
      orderId: orderId
    }, {
      loadingText: '发起支付...',
      errorTitle: '支付失败',
      pageName: '订单详情'
    }).then(result => {
      // 调用微信支付
      wx.requestPayment({
        ...result.data.payment,
        success: () => {
          this.$showSuccess('支付成功');
          // 刷新订单详情
          this.loadOrderDetail(orderId);
        },
        fail: (err) => {
          console.error('支付失败:', err);
          this.$showError('支付失败');
        }
      });
    }).catch(err => {
      console.error('发起支付失败:', err);
    });
    
  },

  //  取消订单（用户）
  cancelOrder: function() {
    this.$showConfirm('确认取消', '确定要取消这个订单吗？', () => {
      this.$callCloudFunction('order', {
        type: 'cancelOrder',
        orderId: this.data.orderInfo._id
      }, {
        loadingText: '取消中...',
        errorTitle: '取消订单失败',
        pageName: '订单详情'
      }).then(result => {
        this.$showSuccess('订单已取消');
        // 返回上一页
        wx.navigateBack();
      }).catch(err => {
        console.error('取消订单失败:', err);
      });
    });
  },

  //  确认收货
  confirmReceived: function() {
    this.$showConfirm('确认收货', '确认已收到商品？确认后订单将完成。', () => {
      this.$callCloudFunction('order', {
        type: 'confirmReceived',
        orderId: this.data.orderInfo._id
      }, {
        loadingText: '确认中...',
        errorTitle: '确认收货失败',
        pageName: '订单详情'
      }).then(result => {
        this.$showSuccess('确认收货成功');
        // 刷新订单详情
        this.loadOrderDetail(this.data.orderInfo._id);
      }).catch(err => {
        console.error('确认收货失败:', err);
      });
    });
  },

  //  申请退款
  requestRefund: function() {
    wx.navigateTo({
      url: `/pages/refund/refund?orderId=${this.data.orderInfo._id}`
    });
  },

  // 复制订单号
  copyOrderId: function() {
    if (this.data.orderInfo && this.data.orderInfo._id) {
      wx.setClipboardData({
        data: this.data.orderInfo._id,
        success: () => {
          this.$showSuccess('订单号已复制');
        }
      });
    }
  },
  
  // 联系客服
  contactService: function() {
    const servicePhone = this.$getConfig('servicePhone');
    wx.makePhoneCall({
      phoneNumber: servicePhone,
      fail: () => {
        this.$showToast('拨打电话失败');
      }
    });
  },
  
  // 再次购买
  buyAgain: function() {
    if (!this.data.orderInfo || !this.data.orderInfo.items) {
      this.$showToast('订单信息无效');
      return;
    }

    // 将订单商品添加到购物车
    const items = this.data.orderInfo.items;
    
    wx.showLoading({ title: '添加中...' });
    
    // 批量添加到购物车
    const addPromises = items.map(item => {
      return this.$callCloudFunction('cart', {
        type: 'addToCart',
        productId: item.productId,
        quantity: item.quantity
      });
    });

    Promise.all(addPromises)
      .then(() => {
        wx.hideLoading();
        this.$showSuccess('已添加到购物车');
        
        // 跳转到购物车页面
        wx.switchTab({
          url: '/pages/cart/cart'
        });
      })
      .catch(err => {
        wx.hideLoading();
        console.error('添加到购物车失败:', err);
        this.$showError('添加到购物车失败');
      });
  },

  // 查看退款进度
  checkRefundProgress: function() {
    // 如果有退款信息，显示退款详情
    if (this.data.refundInfo) {
      this.showRefundDetail();
      return;
    }
    
    // 如果没有退款信息但订单状态为退款中，加载退款信息
    if (this.data.orderInfo && this.data.orderInfo.status === ORDER_STATUS.REFUNDING) {
      if (this.data.orderInfo.refundId) {
        this.loadRefundInfo(this.data.orderInfo.refundId);
      } else {
        // 尝试查询最新的退款记录
        this.$callCloudFunction('refund', {
          type: 'queryRefund',
          orderId: this.data.orderId
        }, {
          loadingText: '查询退款信息...'
        }).then(res => {
          if (res.result && res.result.success) {
            this.setData({ refundInfo: res.result.data });
            this.showRefundDetail();
            
            // 如果退款正在处理中，启动轮询
            if (res.result.data.status === 'processing') {
              this.startRefundStatusPolling();
            }
          } else {
            this.$showToast('未找到退款信息');
          }
        }).catch(err => {
          console.error('查询退款信息失败:', err);
          this.$showError('查询退款信息失败');
        });
      }
    } else {
      this.$showToast('此订单没有退款信息');
    }
  }
};

// 使用基础页面类创建页面
Page(basePage.createPage('pages/order-detail/order-detail', pageConfig)); 