/**
 * 结构化日志模块
 * 提供统一的日志格式和记录方法
 */

const logger = {
  /**
   * 记录错误级别日志
   * @param {string} message 日志消息
   * @param {object} context 上下文信息
   */
  error: function(message, context = {}) {
    console.error(JSON.stringify({
      level: 'ERROR',
      module: 'cart',
      message,
      timestamp: new Date().toISOString(),
      ...context
    }));
  },
  
  /**
   * 记录警告级别日志
   * @param {string} message 日志消息
   * @param {object} context 上下文信息
   */
  warn: function(message, context = {}) {
    console.warn(JSON.stringify({
      level: 'WARN',
      module: 'cart',
      message,
      timestamp: new Date().toISOString(),
      ...context
    }));
  },
  
  /**
   * 记录信息级别日志
   * @param {string} message 日志消息
   * @param {object} context 上下文信息
   */
  info: function(message, context = {}) {
    console.info(JSON.stringify({
      level: 'INFO',
      module: 'cart',
      message,
      timestamp: new Date().toISOString(),
      ...context
    }));
  },

  /**
   * 记录调试级别日志
   * @param {string} message 日志消息
   * @param {object} context 上下文信息
   */
  debug: function(message, context = {}) {
    console.log(JSON.stringify({
      level: 'DEBUG',
      module: 'cart',
      message,
      timestamp: new Date().toISOString(),
      ...context
    }));
  },
  
  /**
   * 记录购物车操作日志
   * @param {string} operation 操作类型
   * @param {object} details 操作详情
   * @param {string} userId 用户ID
   */
  cart: function(operation, details = {}, userId = '') {
    console.info(JSON.stringify({
      level: 'CART',
      module: 'cart',
      operation,
      userId,
      timestamp: new Date().toISOString(),
      ...details
    }));
  }
};

module.exports = logger; 