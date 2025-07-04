/**
 * 时间工具类
 * 提供统一的时间格式化方法
 */

/**
 * 格式化数字为两位数
 * @param {number} n - 数字
 * @returns {string} 格式化后的字符串
 */
function formatNumber(n) {
  n = n.toString();
  return n[1] ? n : '0' + n;
}

/**
 * 格式化时间为 YYYY-MM-DD HH:mm:ss 格式
 * @param {Date|number|string} date - 日期对象、时间戳或日期字符串
 * @param {boolean} includeSeconds - 是否包含秒，默认true
 * @returns {string} 格式化后的时间字符串
 */
function formatTime(date, includeSeconds = true) {
  try {
    if (!date) {
      return '';
    }
    
    // 如果已经是格式化后的字符串，且格式匹配，直接返回
    if (typeof date === 'string' && date.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/)) {
      if (includeSeconds && !date.includes(':')) {
        // 需要秒但字符串没有秒，补上 :00
        return date + ':00';
      } else if (!includeSeconds && date.split(':').length === 3) {
        // 不需要秒但字符串有秒，去掉秒
        return date.substring(0, 16);
      }
      return date;
    }
    
    const dateObj = new Date(date);
    
    // 检查日期是否有效
    if (isNaN(dateObj.getTime())) {
      console.warn('无效的日期格式:', date);
      return typeof date === 'string' ? date : '';
    }
    
    const year = dateObj.getFullYear();
    const month = dateObj.getMonth() + 1;
    const day = dateObj.getDate();
    const hour = dateObj.getHours();
    const minute = dateObj.getMinutes();
    const second = dateObj.getSeconds();

    const datePart = [year, month, day].map(formatNumber).join('-');
    const timePart = includeSeconds 
      ? [hour, minute, second].map(formatNumber).join(':')
      : [hour, minute].map(formatNumber).join(':');
    
    return datePart + ' ' + timePart;
  } catch (err) {
    console.error('格式化时间出错:', err, '原始日期:', date);
    return typeof date === 'string' ? date : '';
  }
}

/**
 * 格式化时间为简短格式 YYYY-MM-DD HH:mm（不包含秒）
 * @param {Date|number|string} date - 日期对象、时间戳或日期字符串
 * @returns {string} 格式化后的时间字符串
 */
function formatTimeShort(date) {
  return formatTime(date, false);
}

/**
 * 格式化时间为完整格式 YYYY-MM-DD HH:mm:ss（包含秒）
 * @param {Date|number|string} date - 日期对象、时间戳或日期字符串
 * @returns {string} 格式化后的时间字符串
 */
function formatTimeFull(date) {
  return formatTime(date, true);
}

/**
 * 格式化时间为相对时间（如：刚刚、5分钟前、2小时前等）
 * @param {Date|number|string} date - 日期对象、时间戳或日期字符串
 * @returns {string} 相对时间字符串
 */
function formatRelativeTime(date) {
  try {
    if (!date) {
      return '';
    }
    
    const dateObj = new Date(date);
    const now = new Date();
    const diff = now.getTime() - dateObj.getTime();
    
    // 检查日期是否有效
    if (isNaN(dateObj.getTime())) {
      return formatTimeShort(date);
    }
    
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    
    if (diff < minute) {
      return '刚刚';
    } else if (diff < hour) {
      return `${Math.floor(diff / minute)}分钟前`;
    } else if (diff < day) {
      return `${Math.floor(diff / hour)}小时前`;
    } else if (diff < 7 * day) {
      return `${Math.floor(diff / day)}天前`;
    } else {
      // 超过7天显示具体日期
      return formatTimeShort(date);
    }
  } catch (err) {
    console.error('格式化相对时间出错:', err);
    return formatTimeShort(date);
  }
}

/**
 * 获取当前时间戳
 * @returns {number} 当前时间戳
 */
function getCurrentTimestamp() {
  return Date.now();
}

/**
 * 获取当前格式化时间
 * @param {boolean} includeSeconds - 是否包含秒，默认true
 * @returns {string} 当前格式化时间
 */
function getCurrentTime(includeSeconds = true) {
  return formatTime(new Date(), includeSeconds);
}

/**
 * 获取客户端设备的时区偏移量（分钟）
 * 东区为负值，西区为正值
 * 例如：东八区 (UTC+8) 返回 -480
 * @returns {number} 时区偏移量（分钟）
 */
function getTimezoneOffset() {
  // 注意：getTimezoneOffset 返回的是本地时间与UTC的差值（分钟）
  // 东区为负，西区为正，与直觉相反，所以我们取反使其符合习惯
  return -new Date().getTimezoneOffset();
}

module.exports = {
  formatTime,
  formatTimeShort,
  formatTimeFull,
  formatRelativeTime,
  getCurrentTimestamp,
  getCurrentTime,
  formatNumber,
  getTimezoneOffset
}; 