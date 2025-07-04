// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 🛠️ 公共工具函数
const utils = {
  /**
   * 成功响应
   */
  successResponse(data, message = '') {
    return {
      success: true,
      data,
      ...(message && { message })
    };
  },

  /**
   * 错误响应
   */
  errorResponse(error, context = '') {
    const errorMessage = this.extractErrorMessage(error);
    const logMessage = context ? `[${context}] ${errorMessage}` : errorMessage;
    
    // 记录错误日志
    console.error('用户错误:', logMessage);
    
    return {
      success: false,
      error: errorMessage,
      timestamp: Date.now()
    };
  },

  /**
   * 提取错误信息
   */
  extractErrorMessage(error) {
    if (typeof error === 'string') return error;
    if (error && error.message) return error.message;
    if (error && error.errMsg) return error.errMsg;
    if (error && error.returnMsg) return error.returnMsg;
    return '操作失败，请重试';
  },

  // 格式化用户数据（移除敏感信息）
  formatUserData(userData, openid) {
    return {
      openid: openid,
      nickName: userData.nickName,
      avatarUrl: userData.avatarUrl,
      gender: userData.gender,
      isAdmin: userData.isAdmin,
      createTime: userData.createTime,
      lastLoginTime: userData.lastLoginTime
    };
  }
};

// 检查是否为管理员
async function checkIsAdmin(openid) {
  console.log('checkIsAdmin 被调用，openid:', openid);
  
  if (!openid) {
    console.log('openid 为空，返回 false');
    return false;
  }
  
  try {
    // 根据openid查询用户是否为管理员
    const adminResult = await db.collection('users').where({
      _openid: openid,
      isAdmin: true
    }).get();
    
    console.log('数据库查询结果:', adminResult);
    console.log('查询到的管理员用户数量:', adminResult.data.length);
    
    return adminResult.data.length > 0;
  } catch (error) {
    console.error('管理员权限检查出错:', error);
    return false;
  }
}

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  // 优先使用传递过来的 openid，否则使用当前上下文的 openid
  const openid = event.openid || wxContext.OPENID

  // 使用Map优化路由查找性能
  const handlers = {
    'login': login,
    'logout': logout,
    'getUserInfo': getUserInfo,
    'checkAdmin': checkAdmin,
    'checkLoginStatus': checkLoginStatus,
    'verifyLoginStatus': verifyLoginStatus
  };
  
  const handler = handlers[event.type];
  if (handler) {
    return await handler(openid, event);
  }
  
  return utils.errorResponse('未知的操作类型');
}

// 检查是否为管理员
async function checkAdmin(openid, event) {
  try {
    console.log('checkAdmin 被调用，openid:', openid);
    const isAdmin = await checkIsAdmin(openid);
    console.log('checkIsAdmin 返回结果:', isAdmin);
    
    return utils.successResponse({ isAdmin });
  } catch (err) {
    return utils.errorResponse(err, '检查管理员权限');
  }
}

// 登录处理
async function login(openid, event) {
  try {
    // 检查是否已有用户记录
    const userRecord = await db.collection('users').where({
      _openid: openid
    }).get()
    
    // 判断是否为管理员
    const isAdmin = await checkIsAdmin(openid);
    
    // 用户信息
    const userInfo = event.userInfo || {}
    
    // 生成登录凭证信息
    const loginInfo = {
      loginTime: db.serverDate(),
      expireTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7天后过期
      lastActiveTime: db.serverDate()
    };
    
    if (userRecord.data.length === 0) {
      // 新用户，创建记录
      await db.collection('users').add({
        data: {
          _openid: openid,
          nickName: userInfo.nickName || '用户',
          avatarUrl: userInfo.avatarUrl || '',
          gender: userInfo.gender || 0,
          isAdmin: isAdmin,
          createTime: db.serverDate(),
          lastLoginTime: db.serverDate(),
          loginInfo: loginInfo
        }
      })
    } else {
      // 更新现有用户记录
      await db.collection('users').where({
        _openid: openid
      }).update({
        data: {
          nickName: userInfo.nickName || userRecord.data[0].nickName,
          avatarUrl: userInfo.avatarUrl || userRecord.data[0].avatarUrl,
          gender: userInfo.gender || userRecord.data[0].gender,
          isAdmin: isAdmin, // 更新管理员状态
          lastLoginTime: db.serverDate(),
          loginInfo: loginInfo
        }
      })
    }
    
    // 返回用户信息，包含登录凭证
    const userData = {
      openid: openid,
      nickName: userInfo.nickName || (userRecord.data[0] ? userRecord.data[0].nickName : '用户'),
      avatarUrl: userInfo.avatarUrl || (userRecord.data[0] ? userRecord.data[0].avatarUrl : ''),
      gender: userInfo.gender || (userRecord.data[0] ? userRecord.data[0].gender : 0),
      isAdmin: isAdmin,
      loginTime: new Date().toISOString(),
      expireTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    };
    
    return utils.successResponse(userData);
  } catch (err) {
    return utils.errorResponse(err, '登录');
  }
}

// 退出登录
async function logout(openid, event) {
  try {
    // 确保openid存在
    if (!openid) {
      return utils.successResponse({ message: '退出登录成功' });
    }
    
    // 更新用户记录，清除登录凭证
    await db.collection('users').where({
      _openid: openid
    }).update({
      data: {
        loginInfo: {
          loginTime: null,
          expireTime: null,
          lastActiveTime: null
        }
      }
    });
    
    console.log('用户登出成功，已清除登录凭证:', openid);
    
    return utils.successResponse({ message: '已退出登录' });
  } catch (err) {
    console.error('退出登录失败:', err);
    return utils.errorResponse(err, '退出登录');
  }
}

// 获取用户信息
async function getUserInfo(openid, event) {
  try {
    console.log('getUserInfo 被调用，openid:', openid);
    
    // 确保openid存在
    if (!openid) {
      return utils.successResponse(null);
    }
    
    // 查询用户记录
    const userRecord = await db.collection('users').where({
      _openid: openid
    }).get()
    
    console.log('用户数据查询结果:', JSON.stringify(userRecord));
    
    if (userRecord.data.length === 0) {
      // 用户不存在
      console.log('未找到用户数据，返回null');
      return utils.successResponse(null);
    }
    
    // 判断是否为管理员
    const isAdmin = await checkIsAdmin(openid);
    
    // 使用公共方法格式化用户数据
    const userData = userRecord.data[0];
    userData.isAdmin = isAdmin; // 使用最新的管理员状态
    
    const formattedData = utils.formatUserData(userData, openid);
    return utils.successResponse(formattedData);
  } catch (err) {
    console.error('获取用户信息失败:', err);
    return utils.errorResponse(err, '获取用户信息');
  }
}

// 检查登录状态
async function checkLoginStatus(openid, event) {
  try {
    console.log('checkLoginStatus 被调用，openid:', openid);
    
    if (!openid) {
      return utils.successResponse({ 
        isLoggedIn: false, 
        userData: null 
      });
    }
    
    // 查询用户记录
    const userRecord = await db.collection('users').where({
      _openid: openid
    }).get();
    
    if (userRecord.data.length === 0) {
      // 用户不存在，表示未登录
      return utils.successResponse({ 
        isLoggedIn: false, 
        userData: null 
      });
    }
    
    // 用户存在，获取最新的管理员状态
    const isAdmin = await checkIsAdmin(openid);
    const userData = userRecord.data[0];
    userData.isAdmin = isAdmin;
    
    return utils.successResponse({ 
      isLoggedIn: true, 
      userData: utils.formatUserData(userData, openid)
    });
  } catch (err) {
    console.error('检查登录状态失败:', err);
    return utils.errorResponse(err, '检查登录状态');
  }
}

// 验证登录状态
async function verifyLoginStatus(openid, event) {
  try {
    if (!openid) {
      return utils.successResponse({ 
        isValid: false,
        message: '未提供用户标识'
      });
    }
    
    // 查询用户记录
    const userRecord = await db.collection('users').where({
      _openid: openid
    }).get();
    
    if (userRecord.data.length === 0) {
      return utils.successResponse({ 
        isValid: false,
        message: '用户不存在'
      });
    }
    
    const userData = userRecord.data[0];
    
    // 检查登录凭证是否存在且未过期
    if (!userData.loginInfo || !userData.loginInfo.expireTime) {
      return utils.successResponse({ 
        isValid: false,
        message: '登录凭证不存在'
      });
    }
    
    const expireTime = new Date(userData.loginInfo.expireTime);
    const now = new Date();
    
    if (expireTime < now) {
      return utils.successResponse({ 
        isValid: false,
        message: '登录已过期'
      });
    }
    
    // 更新最后活动时间
    await db.collection('users').where({
      _openid: openid
    }).update({
      data: {
        'loginInfo.lastActiveTime': db.serverDate()
      }
    });
    
    // 判断是否为管理员
    const isAdmin = await checkIsAdmin(openid);
    
    return utils.successResponse({ 
      isValid: true,
      isAdmin: isAdmin,
      message: '登录有效'
    });
  } catch (err) {
    console.error('验证登录状态失败:', err);
    return utils.errorResponse(err, '验证登录状态');
  }
} 