/**
 * 价格计算和格式化工具类 - 精度安全版本
 * 统一使用分为单位进行计算，避免JavaScript浮点数精度问题
 */

/**
 * 精度安全的价格工具类
 */
const PriceUtils = {
  /**
   * 分转元（用于显示）
   * @param {number} cent 分金额
   * @returns {string} 元金额字符串，保留2位小数
   */
  centToYuan(cent) {
    return (parseInt(cent || 0) / 100).toFixed(2);
  },
  
  /**
   * 🆕 验证价格精度，确保最多两位小数（精确到分）
   * @param {string|number} price 价格（元）
   * @returns {boolean} 是否符合精度要求
   */
  validatePricePrecision(price) {
    if (!price && price !== 0) return false;
    
    const priceStr = price.toString();
    if (!priceStr.includes('.')) return true; // 整数一定符合精度
    
    const decimalPart = priceStr.split('.')[1];
    return !decimalPart || decimalPart.length <= 2; // 最多两位小数
  },
  
  /**
   * 安全的价格计算（分为单位）
   * @param {Array} items 商品数组
   * @returns {number} 总金额（分）
   */
  calculateTotal(items) {
    if (!Array.isArray(items)) return 0;
    
    return items.reduce((total, item) => {
      const price = parseInt(item.productPrice || item.price || 0);
      const quantity = parseInt(item.quantity || 0);
      return total + (price * quantity);
    }, 0);
  },
  
  /**
   * 验证价格有效性
   * @param {number} cent 分金额
   * @returns {boolean} 是否为有效价格
   */
  isValidPrice(cent) {
    const price = parseInt(cent);
    return !isNaN(price) && price >= 0;
  },

  /**
   * 计算购物车或订单商品的总价和总数量（精度安全版）
   * @param {Array} items - 商品列表
   * @param {boolean} onlySelected - 是否只计算选中的商品（购物车使用）
   * @returns {Object} - 包含totalFee和totalItems的对象
   */
  calculateCartTotal(items, onlySelected = false) {
    let totalFee = 0;
    let totalItems = 0;
    
    if (!Array.isArray(items)) {
      console.warn('calculateCartTotal: items 不是数组', items);
      return { totalFee: 0, totalItems: 0 };
    }
    
    console.log('价格计算开始，商品数量:', items.length, '只计算选中:', onlySelected);
    
    items.forEach((item, index) => {
      // 如果需要检查选中状态，且商品未选中，则跳过
      if (onlySelected && !item.selected) {
        console.log(`跳过未选中商品: ${item.productName || item.name}`);
        return;
      }
      
      // 所有整数价格都按分单位处理
      let priceCent = 0;
      if (item.productPrice && Number.isInteger(parseInt(item.productPrice))) {
        // 整数，按分单位处理
        priceCent = parseInt(item.productPrice);
      } else if (item.price && Number.isInteger(parseInt(item.price))) {
        // 整数，按分单位处理
        priceCent = parseInt(item.price);
      } else if (item.productPrice) {
        // 浮点数，假设是元单位，转换为分
        priceCent = Math.round(parseFloat(item.productPrice) * 100);
      } else if (item.price) {
        // 浮点数，假设是元单位，转换为分
        priceCent = Math.round(parseFloat(item.price) * 100);
      }
      
      const quantity = parseInt(item.quantity) || 0;
      
      console.log(`处理商品: ${item.productName || item.name}, 价格(分): ${priceCent}, 数量: ${quantity}`);
      
      // 精确的整数计算
      const itemTotal = priceCent * quantity;
      totalFee += itemTotal;
      totalItems += quantity;
      
      console.log(`单项小计(分): ${itemTotal}, 累计总价(分): ${totalFee}, 累计数量: ${totalItems}`);
    });
    
    console.log('价格计算完成，最终结果:', { totalFee, totalItems, displayPrice: this.centToYuan(totalFee) });
    
    return {
      totalFee,
      totalItems
    };
  },

  /**
   * 计算结算页面的价格信息（精度安全版）
   * @param {Array} items - 商品列表
   * @returns {Object} - 包含totalFee、originalFee、discountFee的对象
   */
  calculateCheckoutTotal(items) {
    const { totalFee, totalItems } = this.calculateCartTotal(items);
    
    // 目前不需要打折逻辑
    const originalFee = totalFee;
    const discountFee = 0;
    
    return {
      totalFee,
      originalFee,
      discountFee,
      totalItems
    };
  },

  /**
   * 计算单个商品的小计（精度安全版）
   * @param {number} price - 单价（分或元）
   * @param {number} quantity - 数量
   * @returns {number} - 小计金额（分）
   */
  calculateItemSubtotal(price, quantity) {
    let priceCent = 0;
    
    if (Number.isInteger(parseInt(price))) {
      // 整数，按分单位处理
      priceCent = parseInt(price);
    } else {
      // 浮点数假设是元单位，转换为分
      priceCent = Math.round(parseFloat(price || 0) * 100);
    }
    
    const numQuantity = parseInt(quantity) || 0;
    return priceCent * numQuantity;
  },

  /**
   * 🆕 统一的价格格式化显示方法
   * 智能识别价格字段并转换为格式化的显示字符串
   * @param {number|string} priceValue - 价格值（可能是分单位或元单位）
   * @param {string} context - 上下文信息，用于错误日志
   * @param {string} itemId - 商品/订单ID，用于错误日志
   * @returns {string} - 格式化的价格字符串，如"1.23"
   */
  formatDisplayPrice(priceValue, context = '价格', itemId = '') {
    // 处理空值或无效值
    if (!priceValue && priceValue !== 0) {
      if (itemId) {
        console.error(`${context}字段缺失:`, itemId, priceValue);
      } else {
        console.warn(`${context}值无效:`, priceValue);
      }
      return '0.00';
    }

    const numValue = parseInt(priceValue);
    
    // 检查是否为有效数字
    if (isNaN(numValue)) {
      if (itemId) {
        console.error(`${context}字段格式错误:`, itemId, priceValue);
      } else {
        console.warn(`${context}格式错误:`, priceValue);
      }
      return '0.00';
    }

    // 整数都按分单位处理
    if (Number.isInteger(numValue)) {
      // 整数，按分单位处理转换为元显示
      return (numValue / 100).toFixed(2);
    } else {
      // 浮点数，假设是元单位，直接格式化
      return parseFloat(priceValue).toFixed(2);
    }
  },

  /**
   * 🆕 批量格式化商品价格
   * 为商品列表批量添加格式化价格字段
   * @param {Array} items - 商品列表
   * @param {string} priceField - 价格字段名（如'price', 'totalFee'等）
   * @param {string} outputField - 输出字段名（如'formattedPrice', 'formattedTotalPrice'等）
   * @param {string} context - 上下文信息，用于错误日志
   * @returns {Array} - 添加了格式化价格字段的商品列表
   */
  formatItemsPriceDisplay(items, priceField, outputField, context = '商品') {
    if (!Array.isArray(items)) {
      console.warn('formatItemsPriceDisplay: items 不是数组', items);
      return [];
    }

    return items.map(item => {
      const priceValue = item[priceField];
      const itemId = item._id || item.id || item.productId || '';
      const formattedPrice = this.formatDisplayPrice(priceValue, `${context}${priceField}`, itemId);
      
      return {
        ...item,
        [outputField]: formattedPrice
      };
    });
  }
};

// 🔧 向后兼容的接口封装
function calculateCartTotal(items, onlySelected = false) {
  return PriceUtils.calculateCartTotal(items, onlySelected);
}

function calculateCheckoutTotal(items) {
  return PriceUtils.calculateCheckoutTotal(items);
}

function formatPrice(price) {
  // 整数都按分单位处理
  if (Number.isInteger(parseInt(price))) {
    // 整数，按分单位处理
    return PriceUtils.centToYuan(parseInt(price));
  } else {
    // 浮点数，假设是元单位，直接格式化
    const numPrice = parseFloat(price) || 0;
    return numPrice.toFixed(2);
  }
}

function calculateItemSubtotal(price, quantity) {
  const subtotalCent = PriceUtils.calculateItemSubtotal(price, quantity);
  // 返回元单位，保持向后兼容
  return parseFloat(PriceUtils.centToYuan(subtotalCent));
}

module.exports = {
  // 精度安全的价格工具接口
  ...PriceUtils
}; 