// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

// 导入默认配置
const DEFAULT_CONFIG = {
  // 数据库集合配置 - 根据实际系统结构调整
  collections: [
    'orders',
    'products',
    'cart',
    'users',
    'categories', // 独立的分类表
    'refunds',
    'order_history', // 添加订单历史表
    'notices', // 添加消息通知表
    'addresses', // 添加地址表
    'system_errors' // 添加系统错误表
  ],
  
  // 分类配置 - 现在会存储在独立的categories表中
  categories: [
    { 
      name: '类型1', 
      order: 1, 
      description: '类型1'
    },
    { 
      name: '类型2', 
      order: 2, 
      description: '类型2'
    },
    { 
      name: '类型3', 
      order: 3, 
      description: '类型3'
    },
    { 
      name: '类型4', 
      order: 4, 
      description: '类型4'
    },
    { 
      name: '其他', 
      order: 5, 
      description: '其他'
    }
  ]
}

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { 
    type = 'all',
    config = null,
    collections = null,
    settings = null,
    categories = null
  } = event
  
  // 合并配置
  const mergedConfig = {
    collections: collections || config?.collections || DEFAULT_CONFIG.collections,
    settings: settings || config?.settings || DEFAULT_CONFIG.settings,
    categories: categories || config?.categories || DEFAULT_CONFIG.categories
  }
  
  console.log('使用配置:', JSON.stringify(mergedConfig.collections))
  
  const result = {
    success: true,
    details: {},
    errors: [],
    message: '系统初始化完成',
    openid: wxContext.OPENID
  }
  
  try {
    console.log(`开始系统初始化操作，类型: ${type}`)
    
    // 创建数据库表结构
    if (type === 'all' || type === 'collections') {
      try {
        const collectionsResult = await initCollections(mergedConfig.collections)
        result.details.collections = collectionsResult
      } catch (err) {
        console.error('创建集合失败:', err)
        result.success = false
        result.errors.push({
          type: 'collections',
          error: err.message || JSON.stringify(err)
        })
      }
    }
    
    // 初始化分类
    if (type === 'all' || type === 'categories') {
      try {
        const categoriesResult = await initCategories(mergedConfig.categories)
        result.details.categories = categoriesResult
      } catch (err) {
        console.error('初始化分类失败:', err)
        result.success = false
        result.errors.push({
          type: 'categories',
          error: err.message || JSON.stringify(err)
        })
      }
    }
    
    // 初始化管理员账号
    if (type === 'all' || type === 'admin') {
      try {
        const adminResult = await initAdminAccount()
        result.details.admin = adminResult
      } catch (err) {
        console.error('初始化管理员账号失败:', err)
        result.success = false
        result.errors.push({
          type: 'admin',
          error: err.message || JSON.stringify(err)
        })
      }
    }
    
    // 获取当前数据库信息
    if (type === 'all' || type === 'info') {
      try {
        const dbInfo = await getDefaultDatabaseInfo()
        result.details.dbInfo = dbInfo
      } catch (err) {
        console.error('获取数据库信息失败:', err)
        result.success = false
        result.errors.push({
          type: 'info',
          error: err.message || JSON.stringify(err)
        })
      }
    }
    
    // 🆕 迁移statusHistory数据到order_history表
    if (type === 'all' || type === 'migrate_history') {
      try {
        const migrateResult = await migrateStatusHistoryToOrderHistory()
        result.details.migration = migrateResult
      } catch (err) {
        console.error('迁移状态历史数据失败:', err)
        result.success = false
        result.errors.push({
          type: 'migration',
          error: err.message || JSON.stringify(err)
        })
      }
    }
    
    // 设置结果消息
    if (result.errors.length > 0) {
      result.message = `系统初始化部分完成，${result.errors.length}个错误`
    }
    
    return {
      success: result.success,
      data: {
        details: result.details,
        errors: result.errors,
        openid: result.openid
      },
      message: result.message
    }
  } catch (err) {
    console.error('系统初始化失败:', err)
    return {
      success: false,
      error: `系统初始化失败: ${err.message || JSON.stringify(err)}`,
      data: {
        openid: wxContext.OPENID
      }
    }
  }
}

// 获取默认配置中定义的数据库信息
async function getDefaultDatabaseInfo() {
  try {
    // 使用统一的集合配置，而不是硬编码
    const knownCollections = DEFAULT_CONFIG.collections
    
    const results = {
      collections: [],
      schemas: {},
      counts: {}
    }
    
    // 检查每个已知集合是否存在
    for (const name of knownCollections) {
      try {
        // 尝试获取集合的数量来判断集合是否存在
        const countResult = await db.collection(name).count()
        
        // 如果能获取到计数，说明集合存在
        results.collections.push(name)
        results.counts[name] = countResult.total
        
        // 如果集合有数据，获取第一条记录来推断模式
        if (countResult.total > 0) {
          const { data } = await db.collection(name).limit(1).get()
          if (data && data.length > 0) {
            results.schemas[name] = Object.keys(data[0])
          }
        }
      } catch (error) {
        // 如果是集合不存在的错误（-502005），则忽略
        if (error.errCode === -502005) {
          console.log(`集合 ${name} 不存在`)
        } else {
          console.error(`检查集合 ${name} 时出错:`, error)
          results.schemas[name] = { error: error.message }
        }
      }
    }
    
    return results
  } catch (error) {
    console.error('获取数据库信息失败:', error)
    throw error
  }
}

// 初始化数据库集合
async function initCollections(collections) {
  const results = {}
  
  for (const collection of collections) {
    try {
      // 检查集合是否存在
      const checkResult = await checkCollectionExists(collection)
      
      if (!checkResult.exists) {
        // 创建集合
        await db.createCollection(collection)
        results[collection] = { created: true }
        console.log(`集合 ${collection} 创建成功`)
      } else {
        results[collection] = { exists: true }
        console.log(`集合 ${collection} 已存在`)
      }
    } catch (err) {
      console.error(`创建集合 ${collection} 失败:`, err)
      results[collection] = { error: err.message || JSON.stringify(err) }
    }
  }
  
  return results
}

// 检查集合是否存在
async function checkCollectionExists(collectionName) {
  try {
    const { data } = await db.collection(collectionName).limit(1).get()
    return { exists: true }
  } catch (err) {
    // 集合不存在错误通常包含特定的错误信息
    if (err && err.errCode === -502005) {
      return { exists: false }
    }
    // 其他错误
    throw err
  }
}

// 初始化管理员账号
async function initAdminAccount() {
  try {
    // 获取当前用户的openid
    const wxContext = cloud.getWXContext();
    const currentOpenid = wxContext.OPENID;
    
    if (!currentOpenid) {
      return {
        status: 'error',
        message: '无法获取当前用户的openid，请确保在小程序环境中调用此函数'
      };
    }
    
    // 检查users集合是否存在
    const usersExists = await checkCollectionExists('users');
    if (!usersExists.exists) {
      await db.createCollection('users');
    }
    
    // 检查当前用户是否已存在
    const userResult = await db.collection('users').where({
      _openid: currentOpenid
    }).get();
    
    if (userResult.data.length > 0) {
      // 用户已存在，将其设置为管理员
      await db.collection('users').where({
        _openid: currentOpenid
      }).update({
        data: {
          isAdmin: true,
          updateTime: db.serverDate()
        }
      });
    } else {
      // 用户不存在，创建新用户并设置为管理员
      await db.collection('users').add({
        data: {
          _openid: currentOpenid,
          isAdmin: true,
          nickName: '系统管理员',
          createTime: db.serverDate(),
          updateTime: db.serverDate()
        }
      });
    }
    
    return {
      status: 'success',
      message: '当前用户已设置为管理员',
      openid: currentOpenid
    };
  } catch (err) {
    console.error('初始化管理员账号失败:', err);
    throw err;
  }
}

// 初始化分类
async function initCategories(categories) {
  const results = {}
  
  try {
    // 检查categories集合是否存在
    const categoriesExists = await checkCollectionExists('categories')
    if (!categoriesExists.exists) {
      await db.createCollection('categories')
      results.categoriesCollection = 'created'
      console.log('创建categories集合成功')
    }
    
    // 处理每个分类
    for (const category of categories) {
      try {
        // 检查分类是否存在
        const checkResult = await checkCategoryExistsByName(category.name)
        
        if (!checkResult.exists) {
          // 创建分类，添加系统字段
          const categoryData = {
            ...category,
            createTime: db.serverDate(),
            updateTime: db.serverDate(),
            status: 'active'
          }
          
          // 如果没有指定顺序，则使用默认顺序
          if (!categoryData.order) {
            categoryData.order = 999
          }
          
          await db.collection('categories').add({
            data: categoryData
          })
          
          results[category.name] = { created: true }
          console.log(`分类 ${category.name} 创建成功`)
        } else {
          // 更新已有分类的信息
          await db.collection('categories').where({
            name: category.name
          }).update({
            data: {
              ...category,
              updateTime: db.serverDate()
            }
          })
          
          results[category.name] = { updated: true }
          console.log(`分类 ${category.name} 更新成功`)
        }
      } catch (err) {
        console.error(`处理分类 ${category.name} 失败:`, err)
        results[category.name] = { error: err.message || JSON.stringify(err) }
      }
    }
    
    return results
  } catch (err) {
    console.error('初始化分类失败:', err)
    throw err
  }
}

// 检查分类是否存在(通过名称)
async function checkCategoryExistsByName(categoryName) {
  try {
    const result = await db.collection('categories').where({
      name: categoryName
    }).count()
    return result.total > 0
  } catch (err) {
    console.error(`检查分类 ${categoryName} 是否存在时失败:`, err)
    return false
  }
}