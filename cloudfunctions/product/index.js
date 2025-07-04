// 云函数入口文件
const cloud = require('wx-server-sdk')
const logger = require('./logger')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command
const $ = db.command.aggregate

// 🛠️ 公共工具函数
const utils = {
  // 检查管理员权限
  async checkAdminPermission(wxContext) {
    try {
      const result = await cloud.callFunction({
        name: 'user',
        data: {
          type: 'checkAdmin',
          openid: wxContext.OPENID
        }
      })
      
      const isAdmin = result.result && result.result.success 
                        && result.result.data && result.result.data.isAdmin;
      
      if (!isAdmin) {
        logger.warn('非管理员尝试执行管理操作', {
          userId: wxContext.OPENID
        });
      }
      
      return isAdmin
    } catch (error) {
      logger.error('检查管理员权限失败', {
        userId: wxContext.OPENID,
        error: error.message || String(error)
      });
      return false
    }
  },

  // 检查分类是否存在
  async checkCategoryExists(categoryId) {
    try {
      if (!categoryId) {
        return { success: false, error: '分类ID不能为空' };
      }
      
      const categoryResult = await db.collection('categories').where({
        _id: categoryId
      }).get();
      
      if (categoryResult.data.length === 0) {
        logger.warn('引用了不存在的分类', { categoryId });
        return { success: false, error: '分类不存在' };
      }
      
      return { success: true, data: categoryResult.data[0] };
    } catch (error) {
      logger.error('检查分类失败', { 
        categoryId,
        error: error.message || String(error)
      });
      return { success: false, error: '检查分类失败' };
    }
  },

  // 增强版商品数据验证
  validateProductData(data) {
    // 商品名称验证
    if (!data.name || typeof data.name !== 'string' || data.name.trim() === '') {
      return { valid: false, error: '商品名称不能为空' };
    }
    
    if (data.name.length > 100) {
      return { valid: false, error: '商品名称不能超过100个字符' };
    }
    
    // 价格验证
    const price = Number(data.price);
    if (isNaN(price) || price <= 0) {
      return { valid: false, error: '商品价格必须大于0' };
    }
    
    if (price > 1000000) {
      return { valid: false, error: '商品价格超出合理范围' };
    }
    
    // 分类ID验证
    if (!data.categoryId) {
      return { valid: false, error: '请选择商品分类' };
    }
    
    // 库存验证
    if (data.stock !== undefined) {
      const stock = Number(data.stock);
      if (isNaN(stock) || !Number.isInteger(stock) || stock < 0) {
        return { valid: false, error: '库存数量必须为非负整数' };
      }
      
      if (stock > 999999) {
        return { valid: false, error: '库存数量超出合理范围' };
      }
    }
    
    // 图片URL验证
    if (data.imageURL && typeof data.imageURL === 'string') {
      if (!data.imageURL.startsWith('/') && !data.imageURL.startsWith('cloud://') && !data.imageURL.startsWith('http')) {
        return { valid: false, error: '图片链接格式不正确' };
      }
    }
    
    // 商品描述验证
    if (data.description && typeof data.description === 'string' && data.description.length > 2000) {
      return { valid: false, error: '商品描述不能超过2000个字符' };
    }
    
    return { valid: true };
  },

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
      error: typeof error === 'object' ? error : { message: error },
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
  }
};

// 云函数入口函数
exports.main = async (event, context) => {
  const { type } = event
  const wxContext = cloud.getWXContext()
  
  // 使用Map优化路由查找性能
  const handlers = {
    'getProducts': getProducts,
    'getProductById': getProductById,
    'addProduct': addProduct,
    'updateProduct': updateProduct,
    'deleteProduct': deleteProduct,
    'getCategories': getCategories
  };
  
  const handler = handlers[type];
  if (handler) {
    return await handler(event, wxContext);
  }
  
  return utils.errorResponse('未知操作类型');
}

// 获取商品列表
async function getProducts(event) {
  const { 
    categoryId,
    page = 1, 
    pageSize = 20,
    isOnSale
  } = event
  
  try {
    // 性能监控 - 开始计时
    const startTime = Date.now();
    
    // 构建查询条件
    let query = {}
    
    // 如果指定了分类，按分类筛选
    if (categoryId !== undefined) {
      query.categoryId = categoryId
    }
    
    // 如果指定了上架状态，按上架状态筛选
    if (isOnSale !== undefined) {
      query.isOnSale = isOnSale
    }
    
    // 验证分页参数
    const MAX_PAGE_SIZE = 50; // 最大每页50条
    const MAX_PAGE = 1000; // 最大允许查询到第1000页
    
    const safePage = Math.max(1, parseInt(page));
    const safePageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(pageSize)));
    
    if (safePage > MAX_PAGE) {
      return utils.errorResponse(`分页查询超出限制，最大支持查询到第${MAX_PAGE}页`);
    }
    
    // 并行执行计数和数据查询（提升性能）
    const [countResult, dataResult] = await Promise.all([
      // 计数查询
      db.collection('products').where(query).count(),
      // 数据查询 - 只获取必要字段，减少数据传输量
      db.collection('products')
        .where(query)
        .orderBy('createTime', 'desc')
        .skip((safePage - 1) * safePageSize)
        .limit(safePageSize)
        .field({
          _id: true,
          name: true,
          price: true,
          imageURL: true,
          categoryId: true,
          isOnSale: true,
          stock: true,
          sales: true,
          createTime: true,
          // 不返回完整描述，减少数据传输
        })
        .get()
    ]);
    
    const total = countResult.total;
    
    // 记录查询性能
    const queryTime = Date.now() - startTime;
    console.log(`商品列表查询耗时: ${queryTime}ms, 条件:`, query);
    
    // 性能告警
    if (queryTime > 1000) {
      console.warn('⚠️ 商品列表查询性能较差，建议检查索引配置');
    }
    
    return utils.successResponse({
      list: dataResult.data,
      pagination: {
        current: safePage,
        pageSize: safePageSize,
        total,
        totalPages: Math.ceil(total / safePageSize)
      }
    });
  } catch (err) {
    logger.error('获取商品列表失败', {
      error: err.message || String(err),
      categoryId,
      page,
      pageSize
    });
    return utils.errorResponse(err, '获取商品列表');
  }
}

// 按ID获取商品
async function getProductById(event) {
  const { id } = event
  
  try {
    // 性能监控 - 开始计时
    const startTime = Date.now();
    
    // 参数验证
    if (!id) {
      return utils.errorResponse('商品ID不能为空');
    }
    
    // 使用聚合查询优化商品和分类的关联查询
    const productResult = await db.collection('products')
      .aggregate()
      .match({
        _id: id
      })
      .lookup({
        from: 'categories',
        localField: 'categoryId',
        foreignField: '_id',
        as: 'categoryInfo'
      })
      .project({
        _id: 1,
        name: 1,
        price: 1,
        imageURL: 1,
        description: 1,
        categoryId: 1,
        stock: 1,
        sales: 1,
        isOnSale: 1,
        createTime: 1,
        updateTime: 1,
        category: { $arrayElemAt: ['$categoryInfo', 0] }
      })
      .end();
    
    // 如果没有找到商品
    if (!productResult.list || productResult.list.length === 0) {
      return utils.errorResponse('商品不存在');
    }
    
    // 记录查询性能
    const queryTime = Date.now() - startTime;
    console.log(`商品详情查询耗时: ${queryTime}ms, 商品ID: ${id}`);
    
    // 性能告警
    if (queryTime > 500) {
      console.warn('⚠️ 商品详情查询性能较差，建议检查索引配置');
    }
    
    return utils.successResponse(productResult.list[0]);
  } catch (err) {
    console.error('获取商品详情失败:', err);
    return utils.errorResponse(err, '获取商品详情');
  }
}

// 添加商品
async function addProduct(event, wxContext) {
  const { name, price, imageURL, description, categoryId, stock } = event
  
  try {
    // 使用公共方法检查管理员权限
    const isAdmin = await utils.checkAdminPermission(wxContext);
    if (!isAdmin) {
      return utils.errorResponse('无权限操作');
    }
    
    logger.debug('尝试添加商品', { 
      name, 
      price, 
      categoryId, 
      operatorId: wxContext.OPENID 
    });
    
    // 防止XSS的简单处理
    const sanitizedData = {
      name: name ? String(name).trim() : '',
      price,
      imageURL: imageURL ? String(imageURL).trim() : '',
      description: description ? String(description).trim() : '',
      categoryId,
      stock
    };
    
    // 使用公共方法验证商品数据
    const validation = utils.validateProductData(sanitizedData);
    if (!validation.valid) {
      logger.warn('商品数据验证失败', {
        error: validation.error,
        data: sanitizedData,
        operatorId: wxContext.OPENID
      });
      return utils.errorResponse(validation.error);
    }
    
    // 使用公共方法检查分类是否存在
    const categoryCheck = await utils.checkCategoryExists(categoryId);
    if (!categoryCheck.success) {
      return utils.errorResponse(categoryCheck.error);
    }
    
    // 添加数据前转换类型，确保数据类型正确
    const processedPrice = Number(price);
    const processedStock = stock ? Number(stock) : 999;
    
    // 添加商品
    const result = await db.collection('products').add({
      data: {
        name: sanitizedData.name,
        price: processedPrice,
        imageURL: sanitizedData.imageURL,
        description: sanitizedData.description,
        categoryId: categoryId,
        stock: processedStock,
        sales: 0,
        isOnSale: true,
        hasOrders: false,
        createTime: db.serverDate(),
        updateTime: db.serverDate()
      }
    });
    
    // 记录成功添加商品
    logger.product('添加', {
      productId: result._id,
      name: sanitizedData.name,
      price: processedPrice,
      categoryId,
      stock: processedStock
    }, wxContext.OPENID);
    
    return utils.successResponse({
      id: result._id,
      imageURL: imageURL
    });
  } catch (err) {
    return utils.errorResponse(err, '添加商品');
  }
}

// 更新商品
async function updateProduct(event, wxContext) {
  const { id, name, price, imageURL, description, categoryId, stock, isOnSale } = event
  
  try {
    // 参数验证
    if (!id) {
      return utils.errorResponse('商品ID不能为空');
    }
    
    // 使用公共方法检查管理员权限
    const isAdmin = await utils.checkAdminPermission(wxContext);
    if (!isAdmin) {
      return utils.errorResponse('无权限操作');
    }
    
    logger.debug('尝试更新商品', { 
      productId: id, 
      operatorId: wxContext.OPENID 
    });
    
    // 检查商品是否存在
    const productRes = await db.collection('products').doc(id).get();
    if (!productRes.data) {
      logger.warn('更新不存在的商品', { productId: id, operatorId: wxContext.OPENID });
      return utils.errorResponse('商品不存在');
    }
    
    // 防止XSS的简单处理
    const sanitizedData = {
      name: name ? String(name).trim() : '',
      price,
      imageURL: imageURL ? String(imageURL).trim() : '',
      description: description ? String(description).trim() : '',
      categoryId,
      stock,
      isOnSale
    };
    
    // 验证商品数据
    const validation = utils.validateProductData(sanitizedData);
    if (!validation.valid) {
      logger.warn('商品数据验证失败', {
        error: validation.error,
        data: sanitizedData,
        productId: id,
        operatorId: wxContext.OPENID
      });
      return utils.errorResponse(validation.error);
    }
    
    // 如果提供了分类ID，检查分类是否存在
    if (categoryId) {
      const categoryCheck = await utils.checkCategoryExists(categoryId);
      if (!categoryCheck.success) {
        return utils.errorResponse(categoryCheck.error);
      }
    }
    
    // 准备更新数据
    const updateData = {};
    
    if (name !== undefined) updateData.name = sanitizedData.name;
    if (price !== undefined) updateData.price = Number(price);
    if (imageURL !== undefined) updateData.imageURL = sanitizedData.imageURL;
    if (description !== undefined) updateData.description = sanitizedData.description;
    if (categoryId !== undefined) updateData.categoryId = categoryId;
    if (stock !== undefined) updateData.stock = Number(stock);
    if (isOnSale !== undefined) updateData.isOnSale = !!isOnSale;
    
    // 总是更新updateTime
    updateData.updateTime = db.serverDate();
    
    // 更新商品
    await db.collection('products').doc(id).update({
      data: updateData
    });
    
    // 记录成功更新商品
    logger.product('更新', {
      productId: id,
      updatedFields: Object.keys(updateData),
      ...updateData
    }, wxContext.OPENID);
    
    return utils.successResponse({
      id,
      ...updateData
    });
  } catch (err) {
    return utils.errorResponse(err, '更新商品');
  }
}

// 删除商品
async function deleteProduct(event, wxContext) {
  const { id } = event;
  
  try {
    // 检查管理员权限
    const isAdmin = await utils.checkAdminPermission(wxContext);
    if (!isAdmin) {
      return utils.errorResponse('无权限操作');
    }
    
    if (!id) {
      return utils.errorResponse('商品ID为必填项');
    }
    
    logger.debug('尝试删除商品', { 
      productId: id, 
      operatorId: wxContext.OPENID 
    });
    
    // 检查商品是否存在
    const productRes = await db.collection('products').doc(id).get();
    if (!productRes.data) {
      logger.warn('删除不存在的商品', { productId: id, operatorId: wxContext.OPENID });
      return utils.errorResponse('商品不存在');
    }
    
    // 获取商品图片URL
    const imageURL = productRes.data.imageURL;
    const productName = productRes.data.name;
    
    // 检查商品是否已经售出（使用hasOrders字段）
    if (productRes.data.hasOrders) {
      logger.warn('尝试删除已售出商品', { 
        productId: id, 
        productName: productName,
        operatorId: wxContext.OPENID 
      });
      return utils.errorResponse('该商品已有订单记录，不能删除，请改为下架操作');
    }
    
    // 执行删除操作
    await db.collection('products').doc(id).remove();
    
    // 如果商品有图片，尝试删除云存储中的图片
    if (imageURL) {
      try {
        const fileID = getFileIDFromURL(imageURL);
        if (fileID) {
          await cloud.deleteFile({
            fileList: [fileID]
          });
          logger.debug('删除商品图片成功', { fileID });
        }
      } catch (fileError) {
        logger.warn('删除商品图片失败', {
          productId: id,
          fileID: getFileIDFromURL(imageURL),
          error: fileError.message || String(fileError)
        });
        // 继续执行，不影响商品删除结果
      }
    }
    
    // 记录删除商品成功
    logger.product('删除', {
      productId: id,
      name: productName,
      imageURL
    }, wxContext.OPENID);
    
    return utils.successResponse({ id });
  } catch (error) {
    return utils.errorResponse(error, '删除商品');
  }
}

// 从URL中提取文件ID
function getFileIDFromURL(imageUrl) {
  if (!imageUrl) return null;
  
  // 检查是否是云存储地址
  if (imageUrl.includes('cloud://')) {
    return imageUrl;
  }
  
  // 匹配临时URL中的文件ID部分
  const match = imageUrl.match(/\/([^\/]+)$/);
  if (match && match[1]) {
    return `cloud://${cloud.DYNAMIC_CURRENT_ENV}.${match[1]}`;
  }
  
  return null;
}

// 获取所有分类
async function getCategories(event) {
  const { 
    page = 1, 
    pageSize = 50,
    status = 'active'
  } = event;
  
  try {
    // 性能监控 - 开始计时
    const startTime = Date.now();
    
    // 验证分页参数
    const MAX_PAGE_SIZE = 100; // 最大每页100条
    const MAX_PAGE = 100; // 最大允许查询到第100页
    
    const safePage = Math.max(1, parseInt(page));
    const safePageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(pageSize)));
    
    if (safePage > MAX_PAGE) {
      return utils.errorResponse(`分页查询超出限制，最大支持查询到第${MAX_PAGE}页`);
    }
    
    // 构建查询条件
    const query = {};
    
    // 如果指定了状态，按状态筛选
    if (status) {
      query.status = status;
    }
    
    // 并行执行计数和数据查询
    const [countResult, categoriesResult] = await Promise.all([
      db.collection('categories').where(query).count(),
      db.collection('categories')
        .where(query)
        .orderBy('order', 'asc')
        .skip((safePage - 1) * safePageSize)
        .limit(safePageSize)
        .field({
          _id: true,
          name: true,
          order: true,
          status: true,
          // 只返回必要字段，减少数据传输
        })
        .get()
    ]);
    
    const total = countResult.total;
    const categories = categoriesResult.data || [];
    
    // 记录查询性能
    const queryTime = Date.now() - startTime;
    console.log(`分类列表查询耗时: ${queryTime}ms, 条件:`, query);
    
    // 性能告警
    if (queryTime > 500) {
      console.warn('⚠️ 分类列表查询性能较差，建议检查索引配置');
    }
    
    return utils.successResponse({
      list: categories,
      pagination: {
        current: safePage,
        pageSize: safePageSize,
        total,
        totalPages: Math.ceil(total / safePageSize)
      }
    });
  } catch (err) {
    logger.error('获取分类失败', {
      error: err.message || String(err)
    });
    return utils.errorResponse(err, '获取分类失败');
  }
}