// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

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
    console.error('商品错误:', logMessage);
    
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
  }
}

// 云函数入口函数
exports.main = async (event, context) => {
  const { type } = event
  const wxContext = cloud.getWXContext()

  // 使用Map优化路由查找性能
  const handlers = {
    'getAddressList': getAddressList,
    'getDefaultAddress': getDefaultAddress,
    'getAddressDetail': getAddressDetail,
    'addAddress': addAddress,
    'updateAddress': updateAddress,
    'deleteAddress': deleteAddress,
    'setDefaultAddress': setDefaultAddress
  };
  
  const handler = handlers[type];
  if (handler) {
    return await handler(event, wxContext);
  }
  
  return utils.errorResponse('未知操作类型');
}

// 获取地址列表
async function getAddressList(event, wxContext) {
  try {
    // 查询用户的所有地址
    const result = await db.collection('addresses')
      .where({
        _openid: wxContext.OPENID
      })
      .orderBy('isDefault', 'desc') // 默认地址排在前面
      .orderBy('createTime', 'desc') // 新地址排在前面
      .get()
    
    return utils.successResponse(result.data);
  } catch (err) {
    console.error('获取地址列表失败:', err)
    return utils.errorResponse(err, 'getAddressList');
  }
}

async function getDefaultAddress(event, wxContext) { 
    try {
        // 查询默认地址
        const result = await db.collection('addresses')
            .where({
                _openid: wxContext.OPENID,
                isDefault: true 
            })
            .orderBy('createTime', 'desc')
            .limit(1)
            .get()
        
        // 如果没有任何地址，返回空    
        const resData = {defaultAddress: null};
        if (result.data && result.data.length > 0) {
           resData.defaultAddress = result.data[0];
        }
            
        return utils.successResponse(resData);
    } catch (err) {
        console.error('获取默认地址失败:', err)
        return utils.errorResponse(err, 'getDefaultAddress');
    }
}

// 获取地址详情
async function getAddressDetail(event, wxContext) {
  const { addressId } = event
  
  try {
    if (!addressId) {
        return {
            success: false,
            error: '缺少地址ID'
        }
    }
    
    // 查询地址详情
    const result = await db.collection('addresses')
      .doc(addressId)
      .get()
    
    // 验证所有权
    if (result.data._openid !== wxContext.OPENID) {
      return utils.errorResponse('无权限查看此地址', 'getAddressDetail');
    }
    
    return utils.successResponse(result.data);
  } catch (err) {
    console.error('获取地址详情失败:', err)
    return {
      success: false,
      error: '获取地址详情失败'
    }
  }
}

// 添加地址
async function addAddress(event, wxContext) {
  const { address } = event
  
  try {
    if (!address) {
      return {
        success: false,
        error: '缺少地址信息'
      }
    }
    
    // 如果设为默认地址，需要先取消之前的默认地址
    if (address.isDefault) {
      await cancelDefaultAddress(wxContext.OPENID)
    }
    
    // 添加地址
    const result = await db.collection('addresses').add({
      data: {
        _openid: wxContext.OPENID,
        contactName: address.contactName,
        contactPhone: address.contactPhone,
        province: address.province,
        city: address.city,
        district: address.district,
        street: address.street,
        detailAddress: address.detailAddress,
        isDefault: address.isDefault || false,
        tag: address.tag || '',
        createTime: db.serverDate(),
        updateTime: db.serverDate()
      }
    })
    
    return utils.successResponse({
        addressId: result._id
    })
  } catch (err) {
    console.error('添加地址失败:', err)
    return utils.errorResponse(err, 'addAddress');
  }
}

// 更新地址
async function updateAddress(event, wxContext) {
  const { addressId, address } = event
  
  try {
    if (!addressId || !address) {
      return utils.errorResponse('缺少地址ID或地址信息', 'updateAddress');
    }
    
    // 验证所有权
    const addressData = await db.collection('addresses')
      .doc(addressId)
      .get()
    
    if (addressData.data._openid !== wxContext.OPENID) {
      return utils.errorResponse('无权限修改此地址', 'updateAddress');
    }
    
    // 如果设为默认地址，需要先取消之前的默认地址
    if (address.isDefault) {
      await cancelDefaultAddress(wxContext.OPENID)
    }
    
    // 更新地址
    await db.collection('addresses')
      .doc(addressId)
      .update({
        data: {
          contactName: address.contactName,
          contactPhone: address.contactPhone,
          province: address.province,
          city: address.city,
          district: address.district,
          street: address.street,
          detailAddress: address.detailAddress,
          isDefault: address.isDefault,
          tag: address.tag,
          updateTime: db.serverDate()
        }
      })
    
    return utils.successResponse('success','地址更新成功');
  } catch (err) {
    console.error('更新地址失败:', err)
    return utils.errorResponse(err, 'updateAddress');
  }
}

// 删除地址
async function deleteAddress(event, wxContext) {
  const { addressId } = event
  
  try {
    if (!addressId) {
      return utils.errorResponse('缺少地址ID', 'deleteAddress');
    }
    
    // 验证所有权
    const addressData = await db.collection('addresses')
      .doc(addressId)
      .get()
    
    if (addressData.data._openid !== wxContext.OPENID) {
      return utils.errorResponse('无权限删除此地址', 'deleteAddress');
    }
    
    // 删除地址
    await db.collection('addresses')
      .doc(addressId)
      .remove()
    
    return utils.successResponse('success', '地址删除成功');
  } catch (err) {
    console.error('删除地址失败:', err)
    return utils.errorResponse(err, 'deleteAddress');
  }
}

// 设置默认地址
async function setDefaultAddress(event, wxContext) {
  const { addressId } = event
  
  try {
    if (!addressId) {
      return utils.errorResponse('缺少地址ID', 'setDefaultAddress');
    }
    
    // 验证所有权
    const addressData = await db.collection('addresses')
      .doc(addressId)
      .get()
    
    if (addressData.data._openid !== wxContext.OPENID) {
      return utils.errorResponse('无权限设置此地址', 'setDefaultAddress');
    }
    
    // 先取消之前的默认地址
    await cancelDefaultAddress(wxContext.OPENID)
    
    // 设置新的默认地址
    await db.collection('addresses')
      .doc(addressId)
      .update({
        data: {
          isDefault: true,
          updateTime: db.serverDate()
        }
      })
    
    return utils.successResponse('success', '设置默认地址成功');
  } catch (err) {
    console.error('设置默认地址失败:', err)
    return utils.errorResponse(err, 'setDefaultAddress');
  }
}

// 取消所有默认地址
async function cancelDefaultAddress(openid) {
  try {
    await db.collection('addresses')
      .where({
        _openid: openid,
        isDefault: true
      })
      .update({
        data: {
          isDefault: false,
          updateTime: db.serverDate()
        }
      })
    
    return true
  } catch (err) {
    console.error('取消默认地址失败:', err)
    return false
  }
} 