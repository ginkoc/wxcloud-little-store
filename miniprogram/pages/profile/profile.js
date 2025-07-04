// 引入基础页面类
const basePage = require('../../utils/basePage');
// 引入认证工具类
const auth = require('../../utils/auth');

// 创建页面配置
const pageConfig = {
  data: {
    userInfo: null,
    isAdmin: false,
    isLoggedIn: false,
    storeName: '',
    storeVersion: '',
    unreadCount: 0
  },

  // 定时器ID
  pollingTimer: null,
  
  onLoad: function() {
    this.loadAppConfig();
    
    // 从本地存储恢复登录状态
    if (auth.isLoggedIn()) {
      const userInfo = auth.getUserInfo();
      this.setData({
        isLoggedIn: true,
        isAdmin: userInfo.isAdmin,
        userInfo: userInfo
      });
      
      // 如果是管理员，加载未读消息
      if (userInfo.isAdmin) {
        this.loadUnreadCount();
        this.startPolling();
      }
    } else {
      // 仍然调用云函数检查一次，避免本地存储与服务器状态不一致
      this.checkLoginStatus();
    }
  },

  onShow: function() {
    // 仅当本地存储没有登录状态时才检查登录状态
    if (!auth.isLoggedIn()) {
      this.checkLoginStatus();
    }
    
    // 如果是管理员，每次显示页面时都刷新未读消息数量
    if (this.data.isAdmin) {
      this.loadUnreadCount();
      // 启动定时轮询
      this.startPolling();
    }
  },

  onHide: function() {
    // 页面隐藏时停止轮询
    this.stopPolling();
  },

  onUnload: function() {
    // 页面卸载时停止轮询
    this.stopPolling();
  },

  // 启动定时轮询
  startPolling: function() {
    // 清除之前的定时器
    this.stopPolling();
    
    // 只有管理员才启动轮询
    if (!this.data.isAdmin) return;
    
    // 每30秒轮询一次未读消息数量
    this.pollingTimer = setInterval(() => {
      this.loadUnreadCount();
    }, 30000); // 30秒
    
    console.log('启动未读消息轮询');
  },

  // 停止定时轮询
  stopPolling: function() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
      console.log('停止未读消息轮询');
    }
  },
  
  loadAppConfig: function() {
    // 从app实例获取配置
    const app = getApp();
    const appConfig = app.getConfig();
    
    this.setData({
      storeName: typeof appConfig.storeName === 'string' ? appConfig.storeName : '我的小店',
      storeVersion: typeof appConfig.storeVersion === 'string' ? appConfig.storeVersion : 'v1.0.0'
    });
    
    console.log('加载应用配置:', appConfig.storeName, appConfig.storeVersion);
  },
  
  // 检查用户登录状态
  checkLoginStatus: function() {
    this.$callCloudFunction('user', {
      type: 'getUserInfo'
    }, {
      loadingText: '加载中...',
      errorTitle: '获取用户信息失败',
      pageName: '个人中心'
    }).then(result => {
      const isAdmin = result.data && result.data.isAdmin === true;
      
      // 如果获取到用户信息，保存到本地存储
      if (result.data) {
        auth.setUserInfo(result.data);
      }
      
      this.setData({ 
        userInfo: result.data,
        isAdmin: isAdmin,
        isLoggedIn: !!result.data
      });
      
      // 如果是管理员，加载未读消息数量
      if (isAdmin) {
        this.loadUnreadCount();
      }
      
      console.log('用户信息:', result.data);
      console.log('是否管理员:', isAdmin);
    }).catch(err => {
      console.error('获取用户信息失败:', err);
      
      // 清除本地存储的用户信息
      auth.clearUserInfo();
      
      this.setData({
        userInfo: null,
        isAdmin: false,
        isLoggedIn: false,
        unreadCount: 0
      });
    });
  },
  
  // 加载未读消息数量
  loadUnreadCount: function() {
    this.$callCloudFunction('notice', {
      type: 'getUnreadCount'
    }, {
      showLoading: false,
      showError: false,
      pageName: '消息通知'
    }).then(result => {
      this.setData({
        unreadCount: result.data.unreadCount || 0
      });
    }).catch(err => {
      console.error('获取未读消息数量失败:', err);
      // 不显示错误提示，静默失败
    });
  },
  
  // 登录
  login: function() {
    wx.getUserProfile({
      desc: '用于完善会员资料',
      success: (userRes) => {
        this.$callCloudFunction('user', {
          type: 'login',
          userInfo: userRes.userInfo
        }, {
          loadingText: '登录中...',
          errorTitle: '登录失败',
          pageName: '登录'
        }).then(result => {
          // 合并用户信息
          const completeUserInfo = {
            ...userRes.userInfo,
            openid: result.data.openid,
            isAdmin: result.data.isAdmin
          };
          
          // 保存到本地存储
          auth.setUserInfo(completeUserInfo);
          
          // 更新小程序全局状态
          const app = getApp();
          app.globalData.userInfo = completeUserInfo;
          app.globalData.isLoggedIn = true;
          app.globalData.isAdmin = result.data.isAdmin;
          
          // 立即更新状态，避免等待checkLoginStatus的网络请求
          this.setData({
            isLoggedIn: true,
            isAdmin: result.data.isAdmin,
            userInfo: completeUserInfo
          });
          
          this.$showSuccess('登录成功');
          
          // 不再调用checkLoginStatus避免状态被覆盖
          // 如果需要获取未读消息数量等信息，直接调用相关函数
          if (result.data.isAdmin) {
            this.loadUnreadCount();
            this.startPolling();
          }
        }).catch(err => {
          console.error('登录失败:', err);
          this.$showError('登录失败');
        });
      },
      fail: (err) => {
        console.log('获取用户信息失败:', err);
        if (err.errMsg.indexOf('auth deny') > -1 || err.errMsg.indexOf('cancel') > -1) {
          this.$showToast('您已取消授权');
        } else {
          this.$showToast('获取用户信息失败');
        }
      }
    });
  },
  
  // 退出登录
  logout: function() {
    this.$showConfirm('提示', '确定要退出登录吗？', () => {
      this.$callCloudFunction('user', {
        type: 'logout'
      }, {
        loadingText: '退出中...',
        errorTitle: '退出失败',
        pageName: '退出登录'
      }).then(result => {
        // 清除本地存储的用户信息
        auth.clearUserInfo();
        
        // 更新小程序全局状态
        const app = getApp();
        app.globalData.userInfo = null;
        app.globalData.isLoggedIn = false;
        app.globalData.isAdmin = false;
        
        // 清除用户信息
        this.setData({
          userInfo: null,
          isAdmin: false,
          isLoggedIn: false,
          unreadCount: 0
        });
        
        this.$showSuccess('已退出登录');
      }).catch(err => {
        console.error('退出登录失败:', err);
        
        // 即使云端请求失败，也清除本地登录状态
        auth.clearUserInfo();
        
        // 更新小程序全局状态
        const app = getApp();
        app.globalData.userInfo = null;
        app.globalData.isLoggedIn = false;
        app.globalData.isAdmin = false;
        
        // 清除用户信息
        this.setData({
          userInfo: null,
          isAdmin: false,
          isLoggedIn: false,
          unreadCount: 0
        });
        
        this.$showError('退出失败，请重试');
      });
    });
  },
  
  // 跳转到我的订单页面
  navigateToMyOrders: function() {
    if (this.navigating) return;
    this.navigating = true;
    
    wx.navigateTo({
      url: '/pages/my-orders/my-orders',
      success: () => {
        console.log('跳转到我的订单成功');
      },
      fail: (err) => {
        console.error('跳转到我的订单失败:', err);
        this.$showToast('页面跳转失败，请重试');
      },
      complete: () => {
        setTimeout(() => {
          this.navigating = false;
        }, 1000);
      }
    });
  },
  
  // 跳转到购物车页面
  navigateToCart: function() {
    if (this.navigating) return;
    this.navigating = true;
    
    wx.navigateTo({
      url: '/pages/cart/cart',
      success: () => {
        console.log('跳转到购物车成功');
      },
      fail: (err) => {
        console.error('跳转到购物车失败:', err);
        this.$showToast('页面跳转失败，请重试');
      },
      complete: () => {
        setTimeout(() => {
          this.navigating = false;
        }, 1000);
      }
    });
  },
  
  // 跳转到订单管理页面
  navigateToOrderManage: function() {
    if (this.navigating) return;
    this.navigating = true;
    
    wx.navigateTo({
      url: '/pages/order-manage/order-manage',
      success: () => {
        console.log('跳转到订单管理成功');
      },
      fail: (err) => {
        console.error('跳转到订单管理失败:', err);
        this.$showToast('页面跳转失败，请重试');
      },
      complete: () => {
        setTimeout(() => {
          this.navigating = false;
        }, 1000);
      }
    });
  },
  
  // 跳转到地址管理页面
  navigateToAddressList: function() {
    if (this.navigating) return;
    this.navigating = true;
    
    wx.navigateTo({
      url: '/pages/address-list/address-list',
      success: () => {
        console.log('跳转到地址管理成功');
      },
      fail: (err) => {
        console.error('跳转到地址管理失败:', err);
        this.$showToast('页面跳转失败，请重试');
      },
      complete: () => {
        setTimeout(() => {
          this.navigating = false;
        }, 1000);
      }
    });
  },
  
  // 跳转到商品管理页面
  navigateToProductManage: function() {
    if (this.navigating) return;
    this.navigating = true;
    
    wx.navigateTo({
      url: '/pages/product/product',
      success: () => {
        console.log('跳转到商品管理成功');
      },
      fail: (err) => {
        console.error('跳转到商品管理失败:', err);
        this.$showToast('页面跳转失败，请重试');
      },
      complete: () => {
        setTimeout(() => {
          this.navigating = false;
        }, 1000);
      }
    });
  },
  
  // 跳转到消息通知页面
  navigateToNotices: function() {
    if (this.navigating) return;
    this.navigating = true;
    
    wx.navigateTo({
      url: '/pages/notices/notices',
      success: () => {
        console.log('跳转到消息通知成功');
      },
      fail: (err) => {
        console.error('跳转到消息通知失败:', err);
        this.$showToast('页面跳转失败，请重试');
      },
      complete: () => {
        setTimeout(() => {
          this.navigating = false;
        }, 1000);
      }
    });
  }
};

// 使用基础页面类创建页面
Page(basePage.createPage('pages/profile/profile', pageConfig)); 