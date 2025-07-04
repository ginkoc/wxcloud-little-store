// 云函数入口文件
const cloud = require('wx-server-sdk')
const logger = require('./logger')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 公共工具函数
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
    logger.error(logMessage, {
      originalError: typeof error === 'object' ? error : { message: error },
      context
    });
    
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

  /**
   * 检查商品是否存在
   */
  async checkProductExists(productId) {
    try {
      // 参数验证
      if (!productId || typeof productId !== 'string') {
        return { success: false, error: '商品ID不能为空且必须是字符串' };
      }

      const product = await db.collection('products').doc(productId).get();
      if (!product.data) {
        logger.warn('商品不存在', { productId });
        return { success: false, error: '商品不存在' };
      }
      
      // 检查商品是否已下架
      if (product.data.isOnSale === false) {
        logger.warn('商品已下架', { 
          productId, 
          productName: product.data.name 
        });
        return { success: false, error: '该商品已下架' };
      }
      
      // 检查库存
      if (product.data.stock <= 0) {
        logger.warn('商品库存不足', { 
          productId, 
          productName: product.data.name,
          currentStock: product.data.stock 
        });
        return { success: false, error: '商品库存不足' };
      }
      
      // 添加获取分类名称的逻辑
      if (product.data.categoryId) {
        try {          
          const categoryResult = await db.collection('categories')
            .doc(product.data.categoryId)
            .get();
          
          if (categoryResult.data 
                  && categoryResult.data.name !== undefined) {
            // 将分类名称添加到商品信息中
            product.data.categoryName = categoryResult.data.name;
          } else {
            product.data.categoryName = '未分类';
          }
        } catch (categoryError) {
          logger.warn('获取商品分类信息失败', {
            productId,
            categoryId: product.data.categoryId,
            error: categoryError.message || String(categoryError)
          });
          // 如果获取分类失败，设置默认分类名称
          product.data.categoryName = '未分类';
        }
      } else {
        // 如果商品没有分类ID，设置默认分类名称
        product.data.categoryName = '未分类';
      }
      
      return { success: true, data: product.data };
    } catch (error) {
      logger.error('检查商品失败', {
        productId,
        error: error.message || String(error),
        stack: error.stack
      });
      return { success: false, error: '查询商品失败' };
    }
  },

  /**
   * 检查购物车商品权限
   */
  async checkCartItemPermission(cartId, wxContext) {
    try {
      // 参数验证
      if (!cartId || typeof cartId !== 'string') {
        return { success: false, error: '购物车商品ID不能为空且必须是字符串' };
      }
      
      if (!wxContext || !wxContext.OPENID) {
        return { success: false, error: '用户身份验证失败' };
      }

      const cartItem = await db.collection('cart').doc(cartId).get();
      
      if (!cartItem.data) {
        logger.warn('购物车商品不存在', { cartId });
        return { success: false, error: '购物车商品不存在' };
      }
      
      if (cartItem.data._openid !== wxContext.OPENID) {
        logger.error('权限错误: 用户试图操作不属于自己的购物车项目', {
          cartId,
          requestUser: wxContext.OPENID,
          actualOwner: cartItem.data._openid,
          action: '检查购物车权限'
        });
        return { success: false, error: '无权限操作此商品' };
      }
      
      return { success: true, data: cartItem.data };
    } catch (error) {
      logger.error('检查购物车商品权限失败', {
        cartId,
        userId: wxContext?.OPENID,
        error: error.message || String(error),
        stack: error.stack
      });
      return { success: false, error: '查询购物车商品失败' };
    }
  },

  /**
   * 检查购物车商品列表权限
   */
  async checkCartItemsPermission(cartIds, wxContext) {
    try {
      // 参数验证
      if (!Array.isArray(cartIds) || cartIds.length === 0) {
        return { success: false, error: '购物车商品ID列表无效' };
      }
      
      if (!wxContext || !wxContext.OPENID) {
        return { success: false, error: '用户身份验证失败' };
      }
      
      // 验证所有ID都是字符串
      for (const id of cartIds) {
        if (typeof id !== 'string') {
          return { success: false, error: '购物车商品ID必须是字符串' };
        }
      }

      const cartItems = await db.collection('cart').where({
        _openid: wxContext.OPENID,
        _id: _.in(cartIds)
      }).get();

      // 检查是否找到了所有请求的项目
      if (cartItems.data.length !== cartIds.length) {
        return { success: false, error: '部分购物车商品不存在或无权限访问' };
      }

      const cartIdOpendIdMap = new Map();
      cartItems.data.forEach(item => {cartIdOpendIdMap.set(item._id, item._openid)});
      for (const cartId of cartIds) {
        if (cartIdOpendIdMap.get(cartId) !== wxContext.OPENID) {
          console.error(`权限错误: 用户 ${wxContext.OPENID} 试图操作不属于自己的购物车项目 ${cartId}`);
          return { success: false, error: '无权限操作商品列表' };
        }
      }
      
      return { success: true, data: cartItems.data };
    } catch (error) {
      return { success: false, error: '查询购物车商品失败' };
    }
  },
  
  /**
   * 验证购物车操作数据
   */
  validateCartOperation(data) {
    // 商品ID验证
    if (!data.productId || typeof data.productId !== 'string') {
      return { valid: false, error: '商品ID不能为空且必须是字符串' };
    }
    
    // 数量验证
    if (data.quantity !== undefined) {
      const quantity = Number(data.quantity);
      if (isNaN(quantity)) {
        return { valid: false, error: '商品数量必须是有效数字' };
      }
      
      if (!Number.isInteger(quantity)) {
        return { valid: false, error: '商品数量必须是整数' };
      }
      
      if (quantity < 1) {
        return { valid: false, error: '商品数量必须大于0' };
      }
      
      if (quantity > 999) {
        return { valid: false, error: '商品数量不能超过999' };
      }
      
      // 返回转换后的值
      return { valid: true, value: {
        productId: data.productId,
        quantity
      }};
    }
    
    return { valid: true, value: { productId: data.productId }};
  }
};

// 云函数入口函数
exports.main = async (event, context) => {
  const { type } = event
  
  // 使用Map优化路由查找性能
  const handlers = {
    'addToCart': addToCart,
    'getCartItems': getCartItems,
    'updateCartItem': updateCartItem,
    'removeCartItem': removeCartItem,
    'removeMultipleItems': removeMultipleItems,
    'clearCart': clearCart,
    'updateSelectAll': updateSelectAll,
    'updateCategorySelect': updateCategorySelect
  };
  
  const handler = handlers[type];
  if (handler) {
    return await handler(event, context);
  }
  
  return utils.errorResponse('未知操作类型');
}

// 添加商品到购物车
async function addToCart(event, context) {
  const wxContext = cloud.getWXContext()
  const { productId, quantity } = event
  
  try {
    // 验证入参
    const validation = utils.validateCartOperation({ productId, quantity });
    if (!validation.valid) {
      return utils.errorResponse(validation.error);
    }
    
    logger.debug('尝试添加商品到购物车', {
      userId: wxContext.OPENID,
      productId,
      quantity
    });
    
    const validatedData = validation.value;
    
    // 检查商品是否存在
    const productCheck = await utils.checkProductExists(validatedData.productId);
    if (!productCheck.success) {
      return utils.errorResponse(productCheck.error, '检查商品');
    }
    
    const productInfo = productCheck.data;
    
    // 检查购物车中是否已存在该商品
    const cartItem = await db.collection('cart').where({
      _openid: wxContext.OPENID,
      productId: validatedData.productId
    }).get()
    
    if (cartItem.data.length > 0) {
      // 更新已有商品数量
      const newQuantity = cartItem.data[0].quantity + validatedData.quantity
      
      // 验证总数量不超过限制
      if (newQuantity > 999) {
        logger.warn('购物车商品数量超出限制', {
          userId: wxContext.OPENID,
          productId: validatedData.productId,
          currentQuantity: cartItem.data[0].quantity,
          addQuantity: validatedData.quantity,
          maxLimit: 999
        });
        return utils.errorResponse('购物车商品数量不能超过999', '添加购物车');
      }
      
      await db.collection('cart').doc(cartItem.data[0]._id).update({
        data: {
          quantity: newQuantity,
          updateTime: db.serverDate()
        }
      })
      
      logger.cart('更新商品数量', {
        productId: validatedData.productId,
        productName: productInfo.name,
        oldQuantity: cartItem.data[0].quantity,
        newQuantity,
        price: productInfo.price
      }, wxContext.OPENID);
    } else {
      // 添加新商品到购物车
      const result = await db.collection('cart').add({
        data: {
          _openid: wxContext.OPENID,
          productId: validatedData.productId,
          productName: productInfo.name,
          price: productInfo.price,
          imageURL: productInfo.imageURL,
          quantity: validatedData.quantity,
          selected: true,
          categoryId: productInfo.categoryId || '',
          categoryName: productInfo.categoryName || '未分类',
          createTime: db.serverDate(),
          updateTime: db.serverDate()
        }
      });
      
      logger.cart('添加新商品', {
        productId: validatedData.productId,
        productName: productInfo.name,
        quantity: validatedData.quantity,
        price: productInfo.price,
        cartItemId: result._id
      }, wxContext.OPENID);
    }
    
    return utils.successResponse(null, '添加成功');
  } catch (err) {
    return utils.errorResponse(err, '添加购物车');
  }
}

// 获取购物车商品
async function getCartItems(event, context) {
  const wxContext = cloud.getWXContext()
  
  try {
    // 性能监控 - 开始计时
    const startTime = Date.now();
    
    // 验证用户身份
    if (!wxContext || !wxContext.OPENID) {
      return utils.errorResponse('用户身份验证失败');
    }
 
    // 使用聚合查询优化购物车和商品的关联查询
    const cartResult = await db.collection('cart')
      .aggregate()
      .match({
        _openid: wxContext.OPENID
      })
      .lookup({
        from: 'products',
        localField: 'productId',
        foreignField: '_id',
        as: 'productInfo'
      })
      .project({
        _id: 1,
        productId: 1,
        productName: 1,
        price: 1,
        quantity: 1,
        selected: 1,
        createTime: 1,
        updateTime: 1,
        imageURL: 1,
        categoryId: 1,
        categoryName: 1,
        // 从关联的商品中获取最新信息
        currentPrice: { $arrayElemAt: ['$productInfo.price', 0] },
        currentStock: { $arrayElemAt: ['$productInfo.stock', 0] },
        isOnSale: { $arrayElemAt: ['$productInfo.isOnSale', 0] },
        currentImageURL: { $arrayElemAt: ['$productInfo.imageURL', 0] }
      })
      .sort({
        createTime: -1
      })
      .end();
    
    // 计算商品小计和选中商品总额
    let totalPrice = 0;
    let selectedCount = 0;
    
    const processedItems = (cartResult.list || []).map(item => {
      // 使用最新的商品价格（如果有）
      const price = Number(item.currentPrice !== undefined ? item.currentPrice : item.price) || 0;
      const quantity = Number(item.quantity) || 0;
      
      // 计算小计
      const subtotal = price * quantity;
      
      // 如果商品被选中，计入总额和数量
      if (item.selected) {
        totalPrice += subtotal;
        selectedCount++;
      }
      
      // 使用最新的商品图片（如果有）
      const imageURL = item.currentImageURL || item.imageURL;
      
      return {
        ...item,
        price,
        quantity,
        subtotal,
        imageURL,
        // 添加库存状态提示
        stockStatus: item.currentStock === 0 ? '缺货' : (item.currentStock < quantity ? '库存不足' : ''),
        // 添加商品状态提示
        statusWarning: item.isOnSale === false ? '已下架' : ''
      };
    });
    
    // 记录查询性能
    const queryTime = Date.now() - startTime;
    console.log(`购物车查询耗时: ${queryTime}ms, 用户: ${wxContext.OPENID}`);
    
    // 性能告警
    if (queryTime > 1000) {
      console.warn('⚠️ 购物车查询性能较差，建议检查索引配置');
    }
    
    const result = {
      items: processedItems,
      totalPrice,
      selectedCount,
      totalCount: processedItems.length
    };
    
    return utils.successResponse(result);
  } catch (err) {
    console.error('获取购物车失败:', err);
    return utils.errorResponse(err, '获取购物车');
  }

}

// 更新购物车商品
async function updateCartItem(event, context) {
  const wxContext = cloud.getWXContext()
  const { cartId, quantity, selected } = event
  
  try {
    // 参数验证
    if (!cartId || typeof cartId !== 'string') {
      return utils.errorResponse('购物车商品ID不能为空且必须是字符串');
    }
    
    // 检查权限
    const permissionCheck = await utils.checkCartItemPermission(cartId, wxContext);
    if (!permissionCheck.success) {
      return utils.errorResponse(permissionCheck.error);
    }
    
    // 准备更新数据
    const updateData = {
      updateTime: db.serverDate()
    };
    
    // 验证并更新数量
    if (quantity !== undefined) {
      const qty = Number(quantity);
      if (isNaN(qty)) {
        return utils.errorResponse('商品数量必须是有效数字');
      }
      
      if (!Number.isInteger(qty)) {
        return utils.errorResponse('商品数量必须是整数');
      }
      
      if (qty < 1) {
        return utils.errorResponse('商品数量必须大于0');
      }
      
      if (qty > 999) {
        return utils.errorResponse('商品数量不能超过999');
      }
      
      updateData.quantity = qty;
    }
    
    // 验证并更新选中状态
    if (selected !== undefined) {
      updateData.selected = !!selected;
    }
    
    // 更新购物车
    await db.collection('cart').doc(cartId).update({
      data: updateData
    });
    
    return utils.successResponse(null, '更新成功');
  } catch (err) {
    return utils.errorResponse(err, '更新购物车');
  }
}

// 移除购物车商品
async function removeCartItem(event, context) {
  const wxContext = cloud.getWXContext()
  const { cartId } = event
  
  try {
    // 参数验证
    if (!cartId || typeof cartId !== 'string') {
      return utils.errorResponse('购物车商品ID不能为空且必须是字符串');
    }
    
    // 验证用户身份
    if (!wxContext || !wxContext.OPENID) {
      return utils.errorResponse('用户身份验证失败');
    }
    
    // 检查购物车商品权限
    const permissionCheck = await utils.checkCartItemPermission(cartId, wxContext);
    if (!permissionCheck.success) {
      return utils.errorResponse(permissionCheck.error);
    }
    
    // 删除购物车商品
    await db.collection('cart').doc(cartId).remove();
    
    return utils.successResponse(null, '删除成功');
  } catch (err) {
    return utils.errorResponse(err, '删除购物车商品');
  }
}

// 移除多个购物车商品
async function removeMultipleItems(event, context) {
  const wxContext = cloud.getWXContext()
  const { cartIds } = event
  
  if (!cartIds || !Array.isArray(cartIds) || cartIds.length === 0) {
    return utils.errorResponse('请提供有效的购物车商品ID列表');
  }
  
  try {
    // 验证所有ID的权限
    const permissionCheck = await utils.checkCartItemsPermission(cartIds, wxContext);
    if (!permissionCheck.success) {
      return utils.errorResponse(`商品(${cartIds})${permissionCheck.error}`);
    }
    
    logger.info('开始批量删除购物车商品', {
      userId: wxContext.OPENID,
      cartItemCount: cartIds.length,
      cartIds
    });
    
    // 使用事务确保批量删除的原子性
    const transaction = await db.startTransaction();
    try {
      // 使用批量操作删除多个购物车商品
      await transaction.collection('cart').where({
        _openid: wxContext.OPENID,
        _id: _.in(cartIds)
      }).remove();
      
      // 提交事务
      await transaction.commit();
      
      logger.cart('批量删除', {
        itemCount: cartIds.length,
        items: cartIds
      }, wxContext.OPENID);
      
      return utils.successResponse(null, '批量删除成功');
    } catch (txError) {
      // 事务出错，回滚所有操作
      logger.error('批量删除购物车商品事务失败', {
        userId: wxContext.OPENID,
        cartIds,
        error: txError.message || String(txError),
        stack: txError.stack
      });
      await transaction.rollback();
      throw txError;
    }
  } catch (err) {
    return utils.errorResponse(err, '批量删除购物车商品');
  }
}

// 清空购物车
async function clearCart(event, context) {
  const wxContext = cloud.getWXContext()
  
  try {
    // 使用事务确保操作原子性
    const transaction = await db.startTransaction();
    try {
      // 直接使用where条件批量删除用户的所有购物车商品
      const result = await transaction.collection('cart').where({
        _openid: wxContext.OPENID
      }).remove();
      
      // 提交事务
      await transaction.commit();
      
      if (result.stats.removed === 0) {
        return utils.successResponse(null, '购物车已为空');
      }
      
      return utils.successResponse(null, `清空购物车成功，已删除${result.stats.removed}件商品`);
    } catch (txError) {
      await transaction.rollback();
      throw txError;
    }
  } catch (err) {
    return utils.errorResponse(err, '清空购物车');
  }
}

// 全选/取消全选
async function updateSelectAll(event, context) {
  const wxContext = cloud.getWXContext()
  const { selected } = event
  
  // 参数完整性验证
  if (selected === undefined) {
    return utils.errorResponse('请提供选中状态');
  }
  
  // 类型验证和转换
  const selectedBoolean = !!selected;
  
  // 验证用户身份
  if (!wxContext || !wxContext.OPENID) {
    return utils.errorResponse('用户身份验证失败');
  }
  
  try {
    // 使用事务确保批量更新的一致性
    const transaction = await db.startTransaction();
    try {
      await transaction.collection('cart').where({
        _openid: wxContext.OPENID
      }).update({
        data: {
          selected: selectedBoolean,
          updateTime: db.serverDate()
        }
      });
      
      // 提交事务
      await transaction.commit();
      return utils.successResponse(null, selectedBoolean ? '全部选中成功' : '全部取消选中成功');
    } catch (txError) {
      await transaction.rollback();
      throw txError;
    }
  } catch (err) {
    return utils.errorResponse(err, '更新全部选中状态');
  }
}

// 按分类选择/取消选择
async function updateCategorySelect(event, context) {
  const wxContext = cloud.getWXContext()
  const { categoryId, selected } = event
  
  // 参数完整性验证
  if (!categoryId) {
    return utils.errorResponse('请提供分类ID');
  }
  
  // 类型验证
  if (typeof categoryId !== 'string') {
    return utils.errorResponse('分类ID必须是字符串类型');
  }
  
  if (selected === undefined) {
    return utils.errorResponse('请提供选中状态');
  }
  
  // 类型转换确保布尔值
  const selectedBoolean = !!selected;
  
  // 验证用户身份
  if (!wxContext || !wxContext.OPENID) {
    return utils.errorResponse('用户身份验证失败');
  }
  
  try {
    // 使用事务确保批量更新的一致性
    const transaction = await db.startTransaction();
    try {
      await transaction.collection('cart').where({
        _openid: wxContext.OPENID,
        categoryId: categoryId
      }).update({
        data: {
          selected: selectedBoolean,
          updateTime: db.serverDate()
        }
      });
      
      // 提交事务
      await transaction.commit();
      return utils.successResponse(null, selectedBoolean ? '分类商品选中成功' : '分类商品取消选中成功');
    } catch (txError) {
      await transaction.rollback();
      throw txError;
    }
  } catch (err) {
    return utils.errorResponse(err, '更新分类选中状态');
  }
}