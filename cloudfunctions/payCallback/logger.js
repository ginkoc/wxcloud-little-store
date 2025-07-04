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
      module: 'payCallback',
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
      module: 'payCallback',
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
      module: 'payCallback',
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
      module: 'payCallback',
      message,
      timestamp: new Date().toISOString(),
      ...context
    }));
  },
  
  /**
   * 记录支付相关日志
   * @param {string} status 支付状态
   * @param {object} paymentInfo 支付信息
   */
  payment: function(status, paymentInfo = {}) {
    console.info(JSON.stringify({
      level: 'PAYMENT',
      module: 'payCallback',
      status,
      timestamp: new Date().toISOString(),
      ...paymentInfo
    }));
  }
};

module.exports = logger; 