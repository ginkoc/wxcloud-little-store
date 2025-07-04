// 引入应用配置
const appConfig = require('./config/appConfig');
// 引入订单状态管理器
const OrderStateManager = require('./utils/orderStateManager');
// 引入认证工具类
const auth = require('./utils/auth');

App({
  onLaunch: function () {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
      wx.showModal({
        title: '版本过低',
        content: '当前微信版本过低，无法使用云开发功能，请升级到最新版本。',
        showCancel: false
      });
      return;
    }

    try {
      wx.cloud.init({
        env: wx.cloud.DYNAMIC_CURRENT_ENV, // 使用动态环境ID
        traceUser: true,
      });
      
      console.log('云开发初始化成功');
      
      // 初始化订单状态配置
      this.initOrderStateConfig();
      
      // 初始化用户登录状态
      this.initUserLoginState();
      
    } catch (error) {
      console.error('云开发初始化失败:', error);
      wx.showToast({
        title: '云服务初始化失败',
        icon: 'none'
      });
    }

    // 处理页面卸载时的资源回收
    this.monitorPageLifecycle();
  },

  // 全局共享数据
  globalData: {
    appConfig: appConfig,
    userInfo: null,
    isLoggedIn: false,
    isAdmin: false
  },
  
  // 获取应用配置
  getConfig(key) {
    const config = this.globalData.appConfig || {};
    
    if (key) {
      return config[key];
    }
    
    return config;
  },

  // 缓存最近一次退出时的页面路径
  lastPath: null,
  
  // 监控页面生命周期
  monitorPageLifecycle() {
    const pages = getCurrentPages();
    if (pages.length > 0) {
      const lastPage = pages[pages.length - 1];
      this.lastPath = lastPage.route;
    }
  },
  
  /**
   * 初始化用户登录状态
   */
  initUserLoginState() {
    // 从本地存储恢复用户登录状态
    const userInfo = auth.getUserInfo();
    const isLoggedIn = auth.isLoggedIn();
    
    this.globalData.userInfo = userInfo;
    this.globalData.isLoggedIn = isLoggedIn;
    this.globalData.isAdmin = auth.isAdmin();
    
    console.log('用户登录状态初始化完成', 
      isLoggedIn ? '已登录' : '未登录',
      this.globalData.isAdmin ? '管理员' : '普通用户');
    
    // 如果有登录状态，验证其有效性
    if (isLoggedIn && userInfo) {
      this.verifyLoginStatus(userInfo.openid);
    }
  },
  
  /**
   * 验证登录状态有效性
   */
  verifyLoginStatus(openid) {
    // 调用云函数验证登录状态
    wx.cloud.callFunction({
      name: 'user',
      data: {
        type: 'verifyLoginStatus',
        openid: openid
      }
    }).then(res => {
      if (res.result && res.result.success) {
        const data = res.result.data;
        
        if (!data.isValid) {
          console.log('登录状态已失效:', data.message);
          // 清除登录状态
          auth.clearUserInfo();
          this.globalData.userInfo = null;
          this.globalData.isLoggedIn = false;
          this.globalData.isAdmin = false;
        } else {
          console.log('登录状态有效');
          // 更新管理员状态
          if (this.globalData.isAdmin !== data.isAdmin) {
            this.globalData.isAdmin = data.isAdmin;
            // 如果用户信息存在，更新isAdmin属性
            if (this.globalData.userInfo) {
              this.globalData.userInfo.isAdmin = data.isAdmin;
              // 更新本地存储
              auth.setUserInfo(this.globalData.userInfo);
            }
          }
        }
      }
    }).catch(err => {
      console.error('验证登录状态失败:', err);
    });
  },
  
  /**
   * 初始化订单状态配置
   */
  async initOrderStateConfig() {
    try {
      console.log('开始初始化订单状态配置');
      await OrderStateManager.init();
      console.log('订单状态配置初始化完成');
    } catch (err) {
      console.error('订单状态配置初始化失败', err);
    }
  },
  
  /**
   * 获取订单状态管理器
   */
  getOrderStateManager() {
    return OrderStateManager;
  },

  onError: function(msg) {
    console.error('小程序全局错误:', msg);
    // 可以在这里上报错误到服务器
    wx.showToast({
      title: '系统出现错误',
      icon: 'error',
      duration: 2000
    });
  },

  onPageNotFound: function(res) {
    console.error('页面不存在:', res);
    wx.switchTab({
      url: '/pages/index/index'
    });
  }
}) 