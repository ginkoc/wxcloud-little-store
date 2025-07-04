/**
 * 基础页面类
 * 提供统一的页面生命周期管理和资源清理功能
 * 所有页面可以继承此类以获得统一的资源管理能力
 */

// 引入事件管理工具类
const eventManager = require('./eventManager');
// 引入错误处理工具类
const errorHandler = require('./errorHandler');
// 引入时间工具类
const timeUtils = require('./timeUtils');
// 引入认证工具类
const auth = require('./auth');

/**
 * 创建基础页面对象
 * @param {string} pageId - 页面唯一标识
 * @param {Object} pageConfig - 页面配置对象
 * @returns {Object} 增强后的页面配置对象
 */
function createPage(pageId, pageConfig) {
  // 安全创建页面混入对象，添加错误检查
  let pageMixin = {};
  try {
    if (eventManager && typeof eventManager.createPageMixin === 'function') {
      pageMixin = eventManager.createPageMixin(pageId) || {};
    }
  } catch (err) {
    console.warn(`创建页面混入对象失败 (${pageId}):`, err);
    pageMixin = {};
  }
  
  // 保存原始的生命周期方法
  const originalOnLoad = pageConfig.onLoad;
  const originalOnUnload = pageConfig.onUnload;
  const originalOnShow = pageConfig.onShow;
  const originalOnHide = pageConfig.onHide;
  
  // 基础页面通用方法
  const baseMethods = {
    /**
     * 检查用户登录状态
     * @param {Function} callback - 登录状态回调函数，参数为isLoggedIn和userData
     * @param {string} pageName - 页面名称，用于错误提示
     */
    $checkLoginStatus: function(callback, pageName = '当前页面') {
      // 先检查本地存储中的登录状态
      if (auth.isLoggedIn()) {
        const userInfo = auth.getUserInfo();
        this.setData({ 
          isLoggedIn: true 
        });
        
        if (typeof callback === 'function') {
          callback(true, userInfo);
        }
        return;
      }
      
      // 本地无登录状态时，调用云函数检查
      this.$callCloudFunction('user', {
        type: 'checkLoginStatus'
      }, {
        showLoading: false,
        showErrorToast: false,
        pageName: `${pageName}-登录检查`
      }).then(result => {
        // 如果云端有登录状态，更新本地存储
        if (result.data.isLoggedIn && result.data.userData) {
          auth.setUserInfo(result.data.userData);
        }
        
        this.setData({ 
          isLoggedIn: result.data.isLoggedIn
        });
        
        if (typeof callback === 'function') {
          callback(result.data.isLoggedIn, result.data.userData);
        }
      }).catch(err => {
        console.warn(`页面 ${pageName} 检查登录状态失败:`, err);
        this.setData({ 
          isLoggedIn: false
        });
        
        if (typeof callback === 'function') {
          callback(false, null);
        }
      });
    },
    
    /**
     * 调用云函数的通用方法
     * @param {string} name - 云函数名称
     * @param {object} data - 传递给云函数的数据
     * @param {object} options - 选项配置
     * @param {boolean} options.showLoading - 是否显示加载提示，默认true
     * @param {string} options.loadingText - 加载提示文字，默认'加载中...'
     * @param {boolean} options.showErrorToast - 是否显示错误提示，默认true
     * @param {string} options.errorTitle - 错误提示标题，默认'操作失败'
     * @param {boolean} options.handleResult - 是否使用errorHandler处理结果，默认true
     * @param {string} options.pageName - 页面名称，用于日志记录
     * @returns {Promise} 云函数调用的Promise
     */
    $callCloudFunction: function(name, data = {}, options = {}) {
      const defaultOptions = {
        showLoading: true,
        loadingText: '加载中...',
        showErrorToast: true,
        errorTitle: '操作失败',
        handleResult: true,
        pageName: '未知页面'
      };
      
      const mergedOptions = { ...defaultOptions, ...options };
      let loadingShown = false;
      
      // 显示加载提示
      if (mergedOptions.showLoading) {
        try {
          wx.showLoading({
            title: mergedOptions.loadingText,
            mask: true
          });
          loadingShown = true;
          this._hasActiveLoading = true;
          console.log(`页面loading已显示: ${mergedOptions.loadingText}`);
        } catch (err) {
          console.warn('显示loading失败:', err);
          loadingShown = false;
        }
      }
      
      return wx.cloud.callFunction({
        name,
        data
      }).then(res => {
        // 隐藏加载提示 - 成功分支
        if (loadingShown) {
          try {
            wx.hideLoading();
            this._hasActiveLoading = false;
            loadingShown = false;
            console.log('页面loading已隐藏(成功)');
          } catch (err) {
            console.warn('隐藏loading失败(成功分支):', err);
            this._hasActiveLoading = false;
            loadingShown = false;
          }
        }
        
        // 使用errorHandler处理结果
        if (mergedOptions.handleResult !== false) {
          return new Promise((resolve, reject) => {
            if (errorHandler.handleResult(res, result => {
              resolve(result);
            }, mergedOptions.errorTitle, mergedOptions.pageName)) {
              // 成功处理，无需额外操作
            } else {
              // 如果handleResult返回false，表示处理失败
              reject(new Error('处理结果失败'));
            }
          });
        }
        
        return res;
      }).catch(err => {
        // 隐藏加载提示 - 错误分支
        if (loadingShown) {
          try {
            wx.hideLoading();
            this._hasActiveLoading = false;
            loadingShown = false;
            console.log('页面loading已隐藏(错误)');
          } catch (hideErr) {
            console.warn('隐藏loading失败(错误分支):', hideErr);
            this._hasActiveLoading = false;
            loadingShown = false;
          }
        }
        
        console.error(`调用云函数 ${name} 失败:`, err);
        
        if (mergedOptions.showErrorToast !== false) {
          wx.showToast({
            title: mergedOptions.errorTitle,
            icon: 'error'
          });
        }
        
        throw err;
      });
    },
    
    /**
     * 显示成功提示
     * @param {string} message - 提示消息
     * @param {number} duration - 提示持续时间，默认1500ms
     */
    $showSuccess: function(message, duration = 1500) {
      wx.showToast({
        title: message,
        icon: 'success',
        duration: duration
      });
    },
    
    /**
     * 显示错误提示
     * @param {string} message - 提示消息
     * @param {number} duration - 提示持续时间，默认1500ms
     */
    $showError: function(message, duration = 1500) {
      wx.showToast({
        title: message,
        icon: 'error',
        duration: duration
      });
    },
    
    /**
     * 显示一般提示
     * @param {string} message - 提示消息
     * @param {number} duration - 提示持续时间，默认1500ms
     */
    $showToast: function(message, duration = 1500) {
      wx.showToast({
        title: message,
        icon: 'none',
        duration: duration
      });
    },
    
    /**
     * 显示确认对话框
     * @param {string} title - 对话框标题
     * @param {string} content - 对话框内容
     * @param {Function} confirmCallback - 确认回调函数
     * @param {Function} cancelCallback - 取消回调函数
     */
    $showConfirm: function(title, content, confirmCallback, cancelCallback) {
      wx.showModal({
        title: title,
        content: content,
        success: (res) => {
          if (res.confirm && typeof confirmCallback === 'function') {
            confirmCallback();
          } else if (res.cancel && typeof cancelCallback === 'function') {
            cancelCallback();
          }
        }
      });
    },
    
    /**
     * 格式化时间（简短格式：YYYY-MM-DD HH:mm）
     * @param {Date|number|string} date - 日期对象、时间戳或日期字符串
     * @returns {string} 格式化后的时间字符串
     */
    $formatTime: function(date) {
      return timeUtils.formatTimeShort(date);
    },
    
    /**
     * 格式化时间（完整格式：YYYY-MM-DD HH:mm:ss）
     * @param {Date|number|string} date - 日期对象、时间戳或日期字符串
     * @returns {string} 格式化后的时间字符串
     */
    $formatTimeFull: function(date) {
      return timeUtils.formatTimeFull(date);
    },
    
    /**
     * 格式化相对时间（如：刚刚、5分钟前等）
     * @param {Date|number|string} date - 日期对象、时间戳或日期字符串
     * @returns {string} 相对时间字符串
     */
    $formatRelativeTime: function(date) {
      return timeUtils.formatRelativeTime(date);
    },
    
    /**
     * 格式化数字为两位数
     * @param {number} n - 数字
     * @returns {string} 格式化后的字符串
     */
    $formatNumber: function(n) {
      return timeUtils.formatNumber(n);
    },
    
    /**
     * 获取应用配置
     * @param {string} key - 配置键名，如果不提供则返回整个配置
     * @returns {any} 配置值
     */
    $getConfig: function(key) {
      const app = getApp();
      const config = app.getConfig();
      if (!config) {
        console.error('获取应用配置失败: 配置对象为空');
        return key ? '' : {};
      }
      
      return key ? (config[key] || '') : config;
    },
    
    /**
     * 检查管理员权限
     * @returns {Promise} 权限检查的Promise，成功返回true，失败会被拒绝
     */
    $checkAdminPermission: function() {
      return new Promise((resolve, reject) => {
        this.$callCloudFunction('user', {
          type: 'checkAdmin'
          // 云函数入口会自动从上下文获取 openid 并传递给 checkAdmin 函数
          // 请参阅 user/index.js 中 exports.main 函数的实现
        }, {
          showLoading: false,
          errorTitle: '权限检查失败',
          pageName: '管理员权限检查'
        }).then(result => {
          if (result.data && result.data.isAdmin) {
            resolve(true);
          } else {
            reject(new Error('非管理员无法访问'));
          }
        }).catch(err => {
          console.error('管理员权限检查失败:', err);
          reject(err);
        });
      });
    },
    
    /**
     * 预览图片
     * @param {Event} e - 事件对象，包含图片URL的dataset
     */
    $previewImage: function(e) {
      const { src } = e.currentTarget.dataset;
      
      if (src && src !== '/images/default-product.png') {
        wx.previewImage({
          current: src,
          urls: [src]
        });
      }
    }
  };
  
  // 增强页面配置
  const enhancedPageConfig = {
    // 混入事件管理功能
    ...pageMixin,
    
    // 混入基础方法
    ...baseMethods,
    
    // 增强原始页面配置
    ...pageConfig,
    
    // 提供基础 onLoad 调用方法
    $callBaseOnLoad: function(options) {
      // 防重复调用
      if (this._baseOnLoadCalled) {
        console.log(`页面 ${pageId} 基础初始化已完成，跳过重复调用`);
        return;
      }
      this._baseOnLoadCalled = true;
      
      console.log(`页面 ${pageId} 基础初始化`);
      
      // 初始化loading状态标记
      this._hasActiveLoading = false;
      
      // 清理可能存在的事件监听器，避免重复绑定
      if (this.$eventCleanup) {
        this.$eventCleanup('onBeforeUnloadPage', true);
      }
      
      // 安全调用 pageMixin 的 onLoad 逻辑
      if (pageMixin && typeof pageMixin.onLoad === 'function') {
        try {
          pageMixin.onLoad.call(this, options);
        } catch (err) {
          console.warn(`页面 ${pageId} pageMixin.onLoad 调用失败:`, err);
        }
      }
    },
    
    // 提供基础 onShow 调用方法
    $callBaseOnShow: function() {
      console.log(`页面 ${pageId} 显示`);
      
      // 页面重新显示时，检查是否有异常的loading状态
      setTimeout(() => {
        if (this._hasActiveLoading) {
          console.warn('页面显示时发现异常的loading状态，尝试清理');
          this.$safeHideLoading();
        }
      }, 100);
    },
    
    // 提供基础 onHide 调用方法
    $callBaseOnHide: function() {
      console.log(`页面 ${pageId} 隐藏`);
      
      if (this._hasActiveLoading) {
        console.warn('页面隐藏时存在活跃的loading状态');
      }
    },
    
    // 提供基础 onUnload 调用方法
    $callBaseOnUnload: function() {
      // 防重复调用
      if (this._baseOnUnloadCalled) {
        console.log(`页面 ${pageId} 基础清理已完成，跳过重复调用`);
        return;
      }
      this._baseOnUnloadCalled = true;
      
      console.log(`页面 ${pageId} 基础清理`);
      
      // 手动清理可能没有被自动清理的事件监听器
      if (this.$eventCleanup) {
        this.$eventCleanup('onBeforeUnloadPage', true);
      }
      
      // 安全调用基类的onUnload方法，确保资源被清理
      if (pageMixin && typeof pageMixin.onUnload === 'function') {
        try {
          pageMixin.onUnload.call(this);
        } catch (err) {
          console.warn(`页面 ${pageId} pageMixin.onUnload 调用失败:`, err);
        }
      }
      
      // 安全地清理可能残留的 loading 状态
      if (this._hasActiveLoading) {
        try {
          wx.hideLoading();
          this._hasActiveLoading = false;
          console.log('页面卸载时清理了残留的loading状态');
        } catch (err) {
          console.warn('清理loading状态时出错:', err.message);
          this._hasActiveLoading = false;
        }
      }
    },
    
    // 提供安全的loading状态检查方法
    $checkLoadingState: function() {
      if (this._hasActiveLoading) {
        console.warn('检测到页面存在活跃的loading状态');
        return true;
      }
      return false;
    },
    
    // 提供手动清理loading的方法
    $safeHideLoading: function() {
      if (this._hasActiveLoading) {
        try {
          wx.hideLoading();
          this._hasActiveLoading = false;
          console.log('手动清理loading状态成功');
          return true;
        } catch (err) {
          console.warn('手动清理loading状态失败:', err);
          this._hasActiveLoading = false;
          return false;
        }
      }
      return true;
    },
    
    // 智能onLoad：自动调用 + 支持手动控制
    onLoad: function(options) {
      try {
        if (originalOnLoad && typeof originalOnLoad === 'function') {
          originalOnLoad.call(this, options);
        }
      } catch (err) {
        console.error(`页面 ${pageId} onLoad执行失败:`, err);
      } finally {
        this.$callBaseOnLoad(options);
      }
    },
    
    // 智能onShow：统一调用模式
    onShow: function() {
      try {
        if (originalOnShow && typeof originalOnShow === 'function') {
          originalOnShow.call(this);
        }
      } catch (err) {
        console.error(`页面 ${pageId} onShow执行失败:`, err);
      } finally {
        this.$callBaseOnShow();
      }
    },
    
    // 智能onHide：统一调用模式
    onHide: function() {
      try {
        if (originalOnHide && typeof originalOnHide === 'function') {
          originalOnHide.call(this);
        }
      } catch (err) {
        console.error(`页面 ${pageId} onHide执行失败:`, err);
      } finally {
        this.$callBaseOnHide();
      }
    },
    
    // 智能onUnload：强制确保清理
    onUnload: function() {
      try {
        if (originalOnUnload && typeof originalOnUnload === 'function') {
          originalOnUnload.call(this);
        }
      } catch (err) {
        console.error(`页面 ${pageId} onUnload执行失败:`, err);
      } finally {
        this.$callBaseOnUnload();
      }
    }
  };
  
  return enhancedPageConfig;
}

module.exports = {
  createPage
}; 