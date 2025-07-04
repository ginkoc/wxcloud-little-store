// 引入基础页面类
const basePage = require('../../utils/basePage');
//  引入订单工具类
const { ORDER_STATUS, OrderUtils } = require('../../utils/orderUtils');
// 🔧 引入精度安全的价格工具类
const PriceUtils = require('../../utils/priceUtils');

// 创建页面配置
const pageConfig = {
  data: {
    orders: [],
    isLoggedIn: false,
    //  分页相关
    currentPage: 1,
    pageSize: 10,
    totalPages: 0,
    hasMore: true,
    isLoading: false,
    isRefreshing: false,
    // 筛选状态
    selectedStatus: '', // 空字符串表示全部
    //  简化状态列表，只保留核心状态
    statusList: [
      { value: '', label: '全部' },
      { value: ORDER_STATUS.PENDING_PAYMENT, label: '待支付' },
      { value: ORDER_STATUS.DELIVERED, label: '待收货' },
      { value: ORDER_STATUS.COMPLETED, label: '已完成' }
    ]
  },
  
  onLoad: function() {
    // 检查用户登录状态
    this.$checkLoginStatus(this.handleLoginStatus, '我的订单');
  },
  
  onShow: function() {
    // 每次显示页面时检查登录状态和刷新数据
    this.$checkLoginStatus(this.handleLoginStatus, '我的订单');
  },
  
  //  下拉刷新
  onPullDownRefresh: function() {
    this.refreshOrders();
  },
  
  //  上拉加载更多
  onReachBottom: function() {
    this.loadMoreOrders();
  },
  
  // 处理登录状态变化
  handleLoginStatus: function(isLoggedIn, userData) {
    if (isLoggedIn) {
      this.setData({ isLoggedIn: true });
      this.refreshOrders();
    } else {
      this.setData({ isLoggedIn: false, orders: [] });
    }
  },
  
  //  刷新订单列表（重置到第一页）
  refreshOrders: function() {
    this.setData({
      currentPage: 1,
      orders: [],
      hasMore: true,
      isRefreshing: true
    });
    this.getMyOrders(true);
  },
  
  //  加载更多订单
  loadMoreOrders: function() {
    if (!this.data.hasMore || this.data.isLoading) {
      return;
    }
    
    this.setData({
      currentPage: this.data.currentPage + 1
    });
    this.getMyOrders(false);
  },
  
  //  状态筛选
  onStatusFilterChange: function(e) {
    const selectedStatus = e.currentTarget.dataset.status;
    
    this.setData({
      selectedStatus: selectedStatus
    });
    
    // 重新加载数据
    this.refreshOrders();
  },
  
  // 获取我的订单（支持分页）
  getMyOrders: function(isRefresh = false) {
    if (this.data.isLoading) return;
    
    this.setData({ isLoading: true });
    
    // 使用基础页面类提供的云函数调用方法
    this.$callCloudFunction('order', {
      type: 'getMyOrders',
      page: this.data.currentPage,
      pageSize: this.data.pageSize,
      status: this.data.selectedStatus
    }, {
      loadingText: isRefresh ? '刷新中...' : '加载中...',
      errorTitle: '获取订单失败',
      pageName: '我的订单',
      showLoading: this.data.currentPage === 1 // 只有第一页显示loading
    }).then(result => {
      const { list, pagination } = result.data;
      
      // 格式化订单数据，添加状态显示转换
      const formattedOrders = list.map(order => {
        try {
          // 🔧 使用统一的价格格式化方法
          const formattedTotalPrice = PriceUtils.formatDisplayPrice(
            order.totalFee, 
            '订单总金额', 
            order._id
          );
          
          // 为订单中的商品添加格式化价格
          if (order.items && Array.isArray(order.items)) {
            order.items = order.items.map(item => ({
              ...item,
              formattedProductPrice: PriceUtils.centToYuan(item.productPrice),
              formattedSubtotal: PriceUtils.centToYuan(item.subtotal || (item.productPrice * item.quantity))
            }));
          }
          
          return {
            ...order,
            createTime: this.$formatTime(order.createTime),
            updateTime: this.$formatTime(order.updateTime),
            statusText: OrderUtils.getStatusText(order.status),
            statusColor: OrderUtils.getStatusColor(order.status),
            formattedTotalPrice: formattedTotalPrice
          };
        } catch (error) {
          console.error('转换订单状态显示失败:', error, '订单ID:', order._id);
          return {
            ...order,
            createTime: this.$formatTime(order.createTime),
            updateTime: this.$formatTime(order.updateTime),
            // 提供默认值
            statusText: order.status || '未知状态',
            statusColor: '#999999',
            formattedTotalPrice: '0.00'
          };
        }
      });
      
      let newOrders;
      if (isRefresh || this.data.currentPage === 1) {
        // 刷新或第一页，替换数据
        newOrders = formattedOrders;
      } else {
        // 追加数据
        newOrders = [...this.data.orders, ...formattedOrders];
      }
      
      this.setData({
        orders: newOrders,
        totalPages: pagination.totalPages,
        hasMore: pagination.current < pagination.totalPages,
        isLoading: false,
        isRefreshing: false
      });
      
      // 停止下拉刷新
      if (wx.stopPullDownRefresh) {
        wx.stopPullDownRefresh();
      }
      
    }).catch(err => {
      console.error('获取我的订单失败:', err);
      this.setData({
        isLoading: false,
        isRefreshing: false
      });
      
      // 停止下拉刷新
      if (wx.stopPullDownRefresh) {
        wx.stopPullDownRefresh();
      }
    });
  },
  
  // 支付订单
  payOrder: function(e) {
    const { id } = e.currentTarget.dataset;
    
    // 使用基础页面类提供的云函数调用方法
    this.$callCloudFunction('order', {
      type: 'createPayment',
      orderId: id
    }, {
      loadingText: '发起支付...',
      errorTitle: '发起支付失败',
      pageName: '支付订单'
    }).then(result => {
      const payment = result.data.payment;
      // 调用微信支付
      wx.requestPayment({
        ...payment,
        success: () => {
          this.$showSuccess('支付成功');
          // 刷新订单列表
          this.refreshOrders();
        },
        fail: (err) => {
          console.error('支付失败:', err);
          this.$showToast('支付已取消');
        }
      });
    }).catch(err => {
      console.error('发起支付失败:', err);
    });
  },
  
  // 申请退款
  refundOrder: function(e) {
    const { id } = e.currentTarget.dataset;
    
    // 使用基础页面类提供的确认对话框
    this.$showConfirm('申请退款', '确定要申请退款吗？', () => {
      // 使用基础页面类提供的云函数调用方法
      this.$callCloudFunction('refund', {
        type: 'createRefund',
        orderId: id,
        refundReason: '用户申请退款'
      }, {
        loadingText: '申请退款...',
        errorTitle: '申请退款失败',
        pageName: '退款'
      }).then(result => {
        this.$showSuccess('申请成功');
        // 刷新订单列表
        this.refreshOrders();
      }).catch(err => {
        console.error('申请退款失败:', err);
      });
    });
  },
  
  //  确认收货
  confirmOrder: function(e) {
    const { id } = e.currentTarget.dataset;
    
    // 使用基础页面类提供的确认对话框
    this.$showConfirm('确认收货', '确定已收到商品吗？确认后订单将完成。', () => {
      // 使用基础页面类提供的云函数调用方法
      this.$callCloudFunction('order', {
        type: 'confirmOrder',
        orderId: id
      }, {
        loadingText: '确认收货中...',
        errorTitle: '确认收货失败',
        pageName: '确认收货'
      }).then(result => {
        this.$showSuccess('确认收货成功');
        // 刷新订单列表
        this.refreshOrders();
      }).catch(err => {
        console.error('确认收货失败:', err);
      });
    });
  },
  
  // 查看订单详情
  viewOrderDetail: function(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/order-detail/order-detail?orderId=${id}`
    });
  },
  
  // 去购物
  goShopping: function() {
    wx.switchTab({
      url: '/pages/index/index'
    });
  },
};

// 使用基础页面类创建页面
Page(basePage.createPage('pages/my-orders/my-orders', pageConfig)); 