//app.js
const app = getApp();
const { ORDER_STATUS, OrderUtils } = require('../../utils/orderUtils');
// 添加价格工具类引用
const PriceUtils = require('../../utils/priceUtils');
// 引入timeUtils获取时区信息
const timeUtils = require('../../utils/timeUtils');

// 页面配置对象
const pageConfig = {
  data: {
    displayOrders: [],
    total: 0,
    totalPages: 0,
    currentPage: 1,
    pageSize: 10,
    needRefresh: false,
    searchQuery: '',
    searchType: 'orderId',
    searchTypes: [
      { id: 'orderId', name: '订单号' },
      { id: 'contactName', name: '姓名' },
      { id: 'contactPhone', name: '电话' },
      { id: 'address', name: '地址' }
    ],
    dateRange: {
      start: '',
      end: ''
    },
    showDatePicker: false,
    statusFilter: '',
    statusList: [
      { value: '', text: '全部状态' },
      { value: ORDER_STATUS.PAID, text: OrderUtils.getStatusText(ORDER_STATUS.PAID) },
      { value: ORDER_STATUS.ACCEPTED, text: OrderUtils.getStatusText(ORDER_STATUS.ACCEPTED) },
      { value: ORDER_STATUS.DELIVERING, text: OrderUtils.getStatusText(ORDER_STATUS.DELIVERING) },
      { value: ORDER_STATUS.DELIVERED, text: OrderUtils.getStatusText(ORDER_STATUS.DELIVERED) },
      { value: ORDER_STATUS.COMPLETED, text: OrderUtils.getStatusText(ORDER_STATUS.COMPLETED) },
      { value: ORDER_STATUS.CANCELLED, text: OrderUtils.getStatusText(ORDER_STATUS.CANCELLED) },
      { value: ORDER_STATUS.REFUNDING, text: OrderUtils.getStatusText(ORDER_STATUS.REFUNDING) }
    ],
    statusFilterIndex: 0, // 🆕 状态筛选索引
    isLoading: false,
    navigating: false,
    isActionButtonClick: false
  },

  onLoad: function() {
    // 🔒 检查管理员权限
    this.$checkAdminPermission()
      .then(() => {
        // 初始加载订单数据
        this.loadOrders();
      })
      .catch(() => {
        // 🔒 无权限，跳转回首页
        this.$showError('您没有管理员权限');
        setTimeout(() => {
          wx.switchTab({
            url: '/pages/index/index'
          });
        }, 1500);
      });
  },

  // 🔄 页面显示时检查是否需要刷新
  onShow: function() {
    if (this.data.needRefresh) {
      // 重新加载当前页数据
      this.loadOrders(this.data.currentPage);
      this.setData({
        needRefresh: false
      });
    }
  },

  // 下拉刷新
  onPullDownRefresh: function() {
    this.loadOrders(this.data.currentPage, true);
  },

  // 🔍 加载订单数据
  loadOrders: function(page = 1, isPullDown = false) {
    // 防止重复加载
    if (this.data.isLoading) {
      console.log('已在加载中，忽略重复请求');
      return;
    }

    this.setData({
      isLoading: true,
      currentPage: page
    });

    // 准备查询参数
    const params = {
      type: 'getAllOrdersWithFilter',
      page,
      pageSize: this.data.pageSize,
      searchType: this.data.searchType,
      searchQuery: this.data.searchQuery,
      status: this.data.statusFilter,
      dateStart: this.data.dateRange.start,
      dateEnd: this.data.dateRange.end,
      timezoneOffset: timeUtils.getTimezoneOffset() // 添加时区偏移参数
    };

    //  调用云函数获取订单列表
    this.$callCloudFunction('order', params, {
      loadingText: '加载订单...',
      showLoading: !isPullDown, // 下拉刷新时不显示loading
      errorTitle: '获取订单失败',
      pageName: '订单管理'
    }).then(result => {
      // 打印完整返回结果，用于调试
      console.log('订单云函数返回结果:', result);
      console.log('返回结果类型:', typeof result);
      
      // 检查result对象的结构
      if (!result) {
        console.error('返回结果为空');
        this.setData({
          isLoading: false,
          displayOrders: []
        });
        return;
      }

      if (result.data && result.data.list && Array.isArray(result.data.list)) {
        // 处理订单状态和金额显示
        const processedOrders = result.data.list.map(order => {
          try {
            // 🔧 处理状态显示
            order.statusText = OrderUtils.getStatusText(order.status);
            order.statusColor = OrderUtils.getStatusColor(order.status);
            
            // 🔧 格式化时间
            order.createTime = order.createTime ? this.$formatTime(order.createTime) : '';
            
            // 🔧 处理价格显示（分 -> 元）
            if (order.totalFee) {
              // 添加格式化价格字段，统一命名
              order.formattedTotalPrice = PriceUtils.centToYuan(order.totalFee);
            } else {
              order.formattedTotalPrice = '0.00';
            }
            
            return order;
          } catch (err) {
            console.error('处理订单数据失败:', err, order);
            // 返回一个安全版本
            return {
              ...order,
              statusText: order.status || '未知',
              statusColor: '#999',
              displayPrice: '0.00'
            };
          }
        });

        // 获取分页信息
        const pagination = result.data.pagination || {
          total: processedOrders.length,
          totalPages: Math.ceil(processedOrders.length / this.data.pageSize)
        };

        this.setData({
          displayOrders: processedOrders,
          total: pagination.total,
          totalPages: pagination.totalPages,
          isLoading: false
        });

        if (isPullDown) {
          wx.stopPullDownRefresh();
        }
        return;
      }
      

      this.setData({
        displayOrders: processedOrders,
        total: paginationInfo.total,
        totalPages: paginationInfo.totalPages,
        isLoading: false
      });

      if (isPullDown) {
        wx.stopPullDownRefresh();
      }
      
      return;
    }).catch(err => {
      console.error('加载订单失败:', err);
      this.setData({
        isLoading: false,
        displayOrders: []
      });

      if (isPullDown) {
        wx.stopPullDownRefresh();
      }

      // 🆕 如果是权限错误，可能是登录过期，尝试重新验证权限
      if (err.message && (err.message.includes('权限') || err.message.includes('login'))) {
        this.$checkAdminPermission().catch(() => {
          wx.showModal({
            title: '登录已过期',
            content: '您的登录状态已过期，请返回首页重新登录',
            showCancel: false,
            success: () => {
              wx.switchTab({
                url: '/pages/index/index'
              });
            }
          });
        });
      }
    });
  },

  // 处理搜索类型切换
  onSearchTypeChange: function(e) {
    const index = e.detail.value;
    const searchType = this.data.searchTypes[index].id;
    
    this.setData({
      searchType
    });
  },

  // 处理搜索输入
  onSearchInput: function(e) {
    this.setData({
      searchQuery: e.detail.value
    });
  },

  // 处理状态筛选变化
  onStatusFilterChange: function(e) {
    const index = e.detail.value;
    const status = this.data.statusList[index].value;
    
    this.setData({
      statusFilter: status,
      statusFilterIndex: index,
      currentPage: 1 // 重置到第一页
    });
    
    this.loadOrders(1);
  },

  // 显示日期选择器
  showDatePicker: function() {
    this.setData({
      showDatePicker: true
    });
  },

  // 处理开始日期变化
  onStartDateChange: function(e) {
    this.setData({
      'dateRange.start': e.detail.value
    });
  },

  // 处理结束日期变化
  onEndDateChange: function(e) {
    this.setData({
      'dateRange.end': e.detail.value
    });
  },

  // 确认日期选择
  onDatePickerConfirm: function() {
    this.setData({
      showDatePicker: false,
      currentPage: 1 // 重置到第一页
    });
    
    this.loadOrders(1);
  },

  // 取消日期选择
  onDatePickerCancel: function() {
    this.setData({
      showDatePicker: false
    });
  },

  // 清空筛选条件
  clearSearch: function() {
    this.setData({
      searchQuery: '',
      searchType: 'orderId',
      dateRange: {
        start: '',
        end: ''
      },
      statusFilter: '',
      statusFilterIndex: 0,
      currentPage: 1 // 重置到第一页
    });
    
    this.loadOrders(1);
  },

  // 执行搜索
  doSearch: function() {
    this.setData({
      currentPage: 1
    });
    this.loadOrders();
  },

  // 🆕 处理页面切换
  changePage: function(e) {
    const type = e.currentTarget.dataset.type;
    let { currentPage, totalPages } = this.data;
    
    switch(type) {
      case 'first':
        currentPage = 1;
        break;
      case 'prev':
        currentPage = Math.max(1, currentPage - 1);
        break;
      case 'next':
        currentPage = Math.min(totalPages, currentPage + 1);
        break;
      case 'last':
        currentPage = totalPages;
        break;
      default:
        return;
    }
    
    if (currentPage !== this.data.currentPage) {
      this.setData({ currentPage });
      this.loadOrders(currentPage);
      
      // 回到页面顶部
      wx.pageScrollTo({
        scrollTop: 0,
        duration: 300
      });
    }
  },

  // 跳转到订单详情页
  navigateToOrderDetail: function(e) {
    // 防止误触发
    if (this.data.isActionButtonClick) {
      this.setData({
        isActionButtonClick: false
      });
      return;
    }
    
    const id = e.currentTarget.dataset.id;
    if (!id) {
      this.$showToast('订单ID不存在');
      return;
    }
    
    // 阻止事件冒泡
    e.stopPropagation && e.stopPropagation();
    
    wx.navigateTo({
      url: '/pages/order-manage-detail/order-manage-detail?orderId=' + id
    });
  },

  // 标记用户点击了操作按钮
  markActionButtonClick: function() {
    this.setData({
      isActionButtonClick: true
    });
  }
};

// 引入基础页面类
const basePage = require('../../utils/basePage');

// 注册页面
Page(basePage.createPage('pages/order-manage/order-manage', pageConfig)); 