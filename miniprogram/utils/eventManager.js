/**
 * 事件管理工具类
 * 用于管理页面中的定时器、事件监听等资源，确保它们在页面卸载时被正确清理
 */

// 存储每个页面的资源（定时器ID等）
const pageResources = {};

/**
 * 初始化页面资源管理
 * @param {string} pageId - 页面唯一标识
 */
const initPage = function(pageId) {
  if (!pageResources[pageId]) {
    pageResources[pageId] = {
      timeoutIds: [],
      intervalIds: [],
      listeners: []
    };
  }
};

/**
 * 添加定时器
 * @param {string} pageId - 页面唯一标识
 * @param {number} timeoutId - setTimeout返回的ID
 * @returns {number} 传入的timeoutId
 */
const addTimeout = function(pageId, timeoutId) {
  initPage(pageId);
  pageResources[pageId].timeoutIds.push(timeoutId);
  return timeoutId;
};

/**
 * 添加间隔定时器
 * @param {string} pageId - 页面唯一标识
 * @param {number} intervalId - setInterval返回的ID
 * @returns {number} 传入的intervalId
 */
const addInterval = function(pageId, intervalId) {
  initPage(pageId);
  pageResources[pageId].intervalIds.push(intervalId);
  return intervalId;
};

/**
 * 添加事件监听器
 * @param {string} pageId - 页面唯一标识
 * @param {string} eventName - 事件名称
 * @param {Object} target - 事件目标对象
 * @param {Function} listener - 监听函数
 */
const addListener = function(pageId, eventName, target, listener) {
  initPage(pageId);
  pageResources[pageId].listeners.push({
    eventName,
    target,
    listener
  });
  
  // 绑定事件
  if (target && typeof target.on === 'function') {
    target.on(eventName, listener);
  }
};

/**
 * 清理页面所有资源
 * @param {string} pageId - 页面唯一标识
 */
const cleanupPage = function(pageId) {
  if (!pageResources[pageId]) return;
  
  console.log(`开始清理页面 ${pageId} 的资源`);
  
  // 清理所有setTimeout
  const timeoutCount = pageResources[pageId].timeoutIds.length;
  pageResources[pageId].timeoutIds.forEach(id => {
    try {
      clearTimeout(id);
    } catch (err) {
      console.error(`清理timeout失败: ${id}`, err);
    }
  });
  
  // 清理所有setInterval
  const intervalCount = pageResources[pageId].intervalIds.length;
  pageResources[pageId].intervalIds.forEach(id => {
    try {
      clearInterval(id);
    } catch (err) {
      console.error(`清理interval失败: ${id}`, err);
    }
  });
  
  // 清理所有事件监听器
  const listenerCount = pageResources[pageId].listeners.length;
  pageResources[pageId].listeners.forEach(item => {
    if (item.target && typeof item.target.off === 'function') {
      try {
        item.target.off(item.eventName, item.listener);
      } catch (err) {
        console.error(`清理事件监听器失败: ${item.eventName}`, err);
      }
    }
  });
  
  console.log(`页面 ${pageId} 资源清理完成: 清理了 ${timeoutCount} 个timeout, ${intervalCount} 个interval, ${listenerCount} 个事件监听器`);
  
  // 重置资源列表
  pageResources[pageId] = {
    timeoutIds: [],
    intervalIds: [],
    listeners: []
  };
};

/**
 * 清理特定事件名称的所有监听器
 * @param {string} pageId - 页面唯一标识
 * @param {string} eventName - 要清理的事件名称，如果不指定则清理所有
 * @param {boolean} isPattern - 是否使用模式匹配
 */
const cleanupEventsByName = function(pageId, eventName, isPattern = false) {
  if (!pageResources[pageId]) return;
  
  const listeners = pageResources[pageId].listeners;
  let eventsToClean = [];
  
  if (eventName) {
    if (isPattern) {
      // 使用模式匹配，如清理所有以eventName开头的事件
      eventsToClean = listeners.filter(item => 
        item.eventName && item.eventName.startsWith(eventName)
      );
    } else {
      // 精确匹配特定事件名
      eventsToClean = listeners.filter(item => item.eventName === eventName);
    }
    
    // 解绑监听器
    eventsToClean.forEach(item => {
      if (item.target && typeof item.target.off === 'function') {
        try {
          item.target.off(item.eventName, item.listener);
          console.log(`已清理事件: ${item.eventName}`);
        } catch (err) {
          console.error(`清理事件失败: ${item.eventName}`, err);
        }
      }
    });
    
    // 从列表中移除已清理的事件
    if (isPattern) {
      pageResources[pageId].listeners = listeners.filter(item => 
        !item.eventName || !item.eventName.startsWith(eventName)
      );
    } else {
      pageResources[pageId].listeners = listeners.filter(item => 
        item.eventName !== eventName
      );
    }
  }
  
  return eventsToClean.length; // 返回清理的事件数量
};

/**
 * 创建一个页面混入对象，添加自动资源清理功能
 * @param {string} pageId - 页面唯一标识，通常可以使用页面路径
 * @returns {Object} 页面混入对象
 */
const createPageMixin = function(pageId) {
  return {
    onLoad() {
      // 初始化页面资源
      initPage(pageId);
      
      // 添加事件清理方法
      this.$eventCleanup = function(eventName, isPattern = false) {
        cleanupEventsByName(pageId, eventName, isPattern);
      };
    },
    onUnload() {
      // 页面卸载时清理资源
      cleanupPage(pageId);
    },
    // 安全的setTimeout，会在页面卸载时自动清理
    $setTimeout(callback, delay) {
      const timeoutId = setTimeout(callback, delay);
      return addTimeout(pageId, timeoutId);
    },
    // 安全的setInterval，会在页面卸载时自动清理
    $setInterval(callback, delay) {
      const intervalId = setInterval(callback, delay);
      return addInterval(pageId, intervalId);
    },
    // 安全的事件监听，会在页面卸载时自动解绑
    $on(eventName, target, listener) {
      addListener(pageId, eventName, target, listener);
    }
  };
};

module.exports = {
  initPage,
  addTimeout,
  addInterval,
  addListener,
  cleanupPage,
  cleanupEventsByName,
  createPageMixin
}; 