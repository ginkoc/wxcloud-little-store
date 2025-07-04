/**
 * 认证工具类
 * 用于管理用户登录状态和信息
 */

// 存储键名
const AUTH_KEY = 'wxstore_auth';
const AUTH_EXPIRE_DAYS = 7; // 7天过期

const auth = {
  // 保存用户登录信息
  setUserInfo(userInfo) {
    const expireTime = Date.now() + AUTH_EXPIRE_DAYS * 24 * 60 * 60 * 1000;
    wx.setStorageSync(AUTH_KEY, {
      userInfo,
      expireTime
    });
  },
  
  // 获取用户信息
  getUserInfo() {
    const authData = wx.getStorageSync(AUTH_KEY);
    if (!authData) return null;
    
    // 检查是否过期
    if (authData.expireTime < Date.now()) {
      this.clearUserInfo();
      return null;
    }
    
    return authData.userInfo;
  },
  
  // 清除用户信息
  clearUserInfo() {
    wx.removeStorageSync(AUTH_KEY);
  },
  
  // 检查是否登录
  isLoggedIn() {
    return this.getUserInfo() !== null;
  },
  
  // 检查是否为管理员
  isAdmin() {
    const userInfo = this.getUserInfo();
    return userInfo && userInfo.isAdmin === true;
  }
};

module.exports = auth; 