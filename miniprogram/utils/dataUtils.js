/**
 * 数据验证和清理工具类
 */

/**
 * 验证和清理购物车商品数据
 * @param {Array} items - 商品列表
 * @returns {Array} - 清理后的商品列表
 */
function cleanCartItems(items) {
  if (!Array.isArray(items)) {
    console.warn('cleanCartItems: items 不是数组', items);
    return [];
  }
  
  const cleanedItems = items.map((item, index) => {
    const cleaned = {
      ...item,
      // 确保价格是有效数字
      price: parseFloat(item.price) || 0,
      // 确保数量是有效的正整数
      quantity: Math.max(1, parseInt(item.quantity) || 1),
      // 确保选中状态是布尔值（购物车需要）
      selected: item.selected !== undefined ? !!item.selected : true,
      // 确保图片字段存在，统一使用imageURL字段
      imageURL: item.imageURL || ''
    };
    
    return cleaned;
  });
  
  return cleanedItems;
}

/**
 * 验证和清理订单商品数据
 * @param {Array} items - 商品列表
 * @returns {Array} - 清理后的商品列表
 */
function cleanOrderItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  
  return items.map(item => {
    return {
      ...item,
      // 确保价格是有效数字
      price: parseFloat(item.price) || 0,
      // 确保数量是有效的正整数
      quantity: Math.max(1, parseInt(item.quantity) || 1),
      // 确保图片字段存在，统一使用imageURL字段
      imageURL: item.imageURL || ''
    };
  });
}

/**
 * 验证手机号或座机号格式
 * @param {string} phone - 手机号或座机号
 * @returns {boolean} - 是否有效
 */
function validatePhone(phone) {
  if (!phone || typeof phone !== 'string') {
    return false;
  }
  
  // 去除所有空格和常见分隔符
  const cleanPhone = phone.replace(/[\s\-()]/g, '');
  
  // 手机号格式：1开头的11位数字
  const mobilePattern = /^1[3-9]\d{9}$/;
  
  // 座机号格式：
  // 1. 带区号：010-12345678, 0571-87654321 (区号3-4位，号码7-8位)
  // 2. 400/800电话：400-123-4567, 8001234567
  // 3. 不带区号的座机：12345678 (7-8位数字)
  const landlinePatterns = [
    /^0\d{2,3}\d{7,8}$/, // 带区号的座机：010/021/0571等 + 7-8位号码
    /^[48]00\d{7}$/,     // 400/800电话：400/800 + 7位数字  
    /^\d{7,8}$/          // 不带区号的座机：7-8位数字
  ];
  
  // 检查手机号
  if (mobilePattern.test(cleanPhone)) {
    return true;
  }
  
  // 检查座机号
  for (let pattern of landlinePatterns) {
    if (pattern.test(cleanPhone)) {
      return true;
    }
  }
  
  return false;
}

/**
 * 验证邮箱格式
 * @param {string} email - 邮箱
 * @returns {boolean} - 是否有效
 */
function validateEmail(email) {
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailPattern.test(email);
}

/**
 * 深度克隆对象（简单版本）
 * @param {any} obj - 要克隆的对象
 * @returns {any} - 克隆后的对象
 */
function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  if (obj instanceof Date) {
    return new Date(obj.getTime());
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => deepClone(item));
  }
  
  const cloned = {};
  for (let key in obj) {
    if (obj.hasOwnProperty(key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }
  
  return cloned;
}

module.exports = {
  cleanCartItems,
  cleanOrderItems,
  validatePhone,
  validateEmail,
  deepClone
}; 