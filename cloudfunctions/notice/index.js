// 消息通知云函数
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  const { type } = event
  const wxContext = cloud.getWXContext()
  
  // 使用Map优化路由查找性能
  const handlers = {
    'createNotice': createNotice,
    'getNotices': getNotices,
    'markAsRead': markAsRead,
    'deleteNotices': deleteNotices,
    'getUnreadCount': getUnreadCount
  };
  
  const handler = handlers[type];
  if (handler) {
    return await handler(event, wxContext);
  }
  
  return {
    success: false,
    error: '未知操作类型'
  };
}

/**
 * 创建通知消息
 */
async function createNotice(event, wxContext) {
  const { noticeData, expireDays = 7 } = event  // 默认7天后过期
  
  try {
    // 验证必要字段
    if (!noticeData.orderId || !noticeData.merchantId) {
      return {
        success: false,
        error: '缺少必要的通知信息'
      }
    }
    
    // 添加创建时间和默认状态
    const completeNoticeData = {
      ...noticeData,
      createTime: db.serverDate(),
      updateTime: db.serverDate(),
      expireTime: db.serverDate({ offset: expireDays * 24 * 60 * 60 * 1000 }),
      status: 'UNREAD',
      isRead: false
    }
    
    const result = await db.collection('notices').add({
      data: completeNoticeData
    })
    
    console.log('通知消息创建成功:', result._id, '过期天数:', expireDays)
    
    return {
      success: true,
      data: {
        noticeId: result._id,
        ...completeNoticeData
      }
    }
  } catch (err) {
    console.error('创建通知消息失败:', err)
    return {
      success: false,
      error: '创建通知消息失败'
    }
  }
}

/**
 * 获取通知消息列表（支持分页和筛选）
 */
async function getNotices(event, wxContext) {
  const { 
    page = 1, 
    pageSize = 20, 
    status = '', // 消息状态筛选：UNREAD/READ/RESOLVED
    messageType = '', 
    level = ''   // 消息级别筛选：ERROR/WARNING/INFO
  } = event
  
  try {
    // 检查管理员权限
    const isAdmin = await checkAdminPermission(wxContext.OPENID)
    
    if (!isAdmin) {
      return {
        success: false,
        error: '无权限访问'
      }
    }
    
    // 构建查询条件
    const query = {
      merchantId: wxContext.OPENID // 只查看当前管理员的通知
    }
    
    // 添加状态筛选
    if (status) {
      query.status = status
    }
    
    if (messageType) {
      query.messageType = messageType
    }
    
    // 添加级别筛选
    if (level) {
      query.level = level
    }
    
    // 只显示未过期的消息
    const currentTime = new Date();
    query.expireTime = db.command.gt(currentTime);
    
    // 分页参数
    const safePage = Math.max(1, parseInt(page))
    const safePageSize = Math.min(50, Math.max(1, parseInt(pageSize)))
    
    // 并行执行计数和数据查询
    const [countResult, dataResult] = await Promise.all([
      db.collection('notices').where(query).count(),
      db.collection('notices')
        .where(query)
        .orderBy('createTime', 'desc')
        .skip((safePage - 1) * safePageSize)
        .limit(safePageSize)
        .get()
    ])
    
    const total = countResult.total
    
    return {
      success: true,
      data: {
        list: dataResult.data,
        pagination: {
          current: safePage,
          pageSize: safePageSize,
          total,
          totalPages: Math.ceil(total / safePageSize)
        }
      }
    }
  } catch (err) {
    console.error(' 获取通知消息列表失败:', err)
    return {
      success: false,
      error: '获取通知消息失败'
    }
  }
}

/**
 * 标记消息为已读
 */
async function markAsRead(event, wxContext) {
  const { noticeIds } = event
  
  try {
    if (!noticeIds || !Array.isArray(noticeIds)) {
      return {
        success: false,
        error: '缺少消息ID'
      }
    }

    // 检查管理员权限
    const isAdmin = await checkAdminPermission(wxContext.OPENID)
    if (!isAdmin) {
      return {
        success: false,
        error: '无权限操作'
      }
    }

    await db.collection('notices').where({
      _id: db.command.in(noticeIds),
      merchantId: wxContext.OPENID
    }).update({
      data: {
        status: 'READ',
        isRead: true,
        readTime: db.serverDate(),
        updateTime: db.serverDate()
      }
    })
    
    return {
      success: true,
      message: '消息已标记为已读'
    }
  } catch (err) {
    console.error('标记消息已读失败:', err)
    return {
      success: false,
      error: '标记消息已读失败'
    }
  }
}

/**
 * 删除通知消息
 */
async function deleteNotices(event, wxContext) {
  const { noticeIds } = event
  
  try {
    if (!noticeIds || !Array.isArray(noticeIds)) {
      return {
        success: false,
        error: '缺少消息ID'
      }
    }

    // 检查管理员权限
    const isAdmin = await checkAdminPermission(wxContext.OPENID)
    if (!isAdmin) {
      return {
        success: false,
        error: '无权限操作'
      }
    }
  
    // 只能删除自己的消息
    await db.collection('notices')
      .where({
        _id: db.command.in(noticeIds),
        merchantId: wxContext.OPENID
      })
      .remove()
    
    return {
      success: true,
      message: '消息已删除'
    }
  } catch (err) {
    console.error('删除通知消息失败:', err)
    return {
      success: false,
      error: '删除消息失败'
    }
  }
}

/**
 * 获取未读消息数量
 */
async function getUnreadCount(event, wxContext) {
  try {
    // 检查管理员权限
    const isAdmin = await checkAdminPermission(wxContext.OPENID)
    if (!isAdmin) {
      return {
        success: false,
        error: '无权限访问'
      }
    }
    
    // 查询未读消息数量
    const countResult = await db.collection('notices')
      .where({
        merchantId: wxContext.OPENID,
        status: 'UNREAD',
        expireTime: db.command.gt(new Date())
      })
      .count()
    
    return {
      success: true,
      data: {
        unreadCount: countResult.total
      }
    }
  } catch (err) {
    console.error('获取未读消息数量失败:', err)
    return {
      success: false,
      error: '获取未读消息数量失败'
    }
  }
}

/**
 * 检查管理员权限
 */
async function checkAdminPermission(openId) {
  try {
    const result = await cloud.callFunction({
      name: 'user',
      data: {
        type: 'checkAdmin',
        openid: openId
      }
    })
    
    return result.result && result.result.success && result.result.data && result.result.data.isAdmin
  } catch (error) {
    console.error('检查管理员权限失败:', error)
    return false
  }
}