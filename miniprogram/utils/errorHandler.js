/**
 * 小程序端错误处理器
 * 统一版，处理所有云函数返回格式
 */

class ErrorHandler {
  /**
   * 统一处理云函数返回结果
   * @param {Object} response - 云函数原始返回（包含 result 层）
   * @param {Function} successCallback - 成功回调
   * @param {string} errorTitle - 错误标题
   * @param {string} pageName - 页面名称
   * @returns {boolean} 是否处理成功
   */
  static handleResult(response, successCallback, errorTitle = '操作失败', pageName = '') {
    console.log(`处理云函数结果 [${pageName}]:`, {
      hasResult: !!response.result,
      success: response.result ? response.result.success : false,
      requestId: response.requestId || (response.result && response.result.requestId) || '无'
    });

    // 检查返回结构
    if (!response || !response.result) {
      console.error(`云函数返回异常 [${pageName}]: 缺少result对象`);
      this.showErrorToast('网络请求失败');
      return false;
    }
    
    const result = response.result;
    
    // 处理失败情况
    if (!result.success) {
      console.error(`云函数操作失败 [${pageName}]:`, result.error || result);
      
      // 🆕 增强的错误信息处理
      const errorMessage = this.extractErrorMessage(result);
      const contextInfo = this.extractContextInfo(result);
      
      // 🆕 如果有重试信息，在错误提示中体现
      const displayMessage = this.enhanceErrorMessage(errorMessage, contextInfo);
      
      this.showErrorToast(displayMessage);
      return false;
    }
    
    // 🆕 处理成功情况，检查是否有特殊信息需要展示
    console.log(`云函数操作成功 [${pageName}]`, result.data || {});
    
    // 🆕 检查是否有成功消息需要特殊处理
    if (result.message) {
      this.handleSuccessMessage(result.message, result.data);
    }
    
    if (typeof successCallback === 'function') {
      try {
        successCallback(result);
      } catch (err) {
        console.error(`回调处理异常 [${pageName}]:`, err);
        this.showErrorToast('处理结果失败');
        return false;
      }
    }
    
    return true;
  }

  /**
   * 🆕 提取完整的错误信息
   */
  static extractErrorMessage(result) {
    if (result.error) return result.error;
    if (result.errMsg) return result.errMsg;
    if (result.message) return result.message;
    return '操作失败，请重试';
  }

  /**
   * 🆕 提取错误上下文信息
   */
  static extractContextInfo(result) {
    return {
      context: result.context || '',
      errorCode: result.errorCode || '',
      technical: result.technical || '',
      isRetryable: result.isRetryable || false,
      timestamp: result.timestamp || Date.now()
    };
  }

  /**
   * 🆕 增强错误信息（暂时不展示重试信息）
   */
  static enhanceErrorMessage(errorMessage, contextInfo) {
    let enhancedMessage = errorMessage;
    
    // 🆕 可重试错误的提示
    if (contextInfo.isRetryable) {
      enhancedMessage += '\n请稍后重试';
    }
    
    return enhancedMessage;
  }

  /**
   * 🆕 处理成功消息（包含异步处理提示）
   */
  static handleSuccessMessage(message, data) {
    // 🆕 检查是否为异步退款操作
    if (message.includes('退款正在处理中')) {
      // 异步退款的特殊提示
      wx.showModal({
        title: '操作成功',
        content: `${message}\n\n退款通常在1-3分钟内完成，您可以：\n• 停留在当前页面查看进度\n• 稍后刷新查看结果`,
        confirmText: '知道了',
        showCancel: false
      });
      return;
    }
    
    // 普通成功消息
    this.showSuccessToast(message);
  }

  /**
   * 处理云函数返回的错误
   */
  static handleCloudFunctionResponse(response) {
    // 🆕 统一使用 handleResult 方法
    return new Promise((resolve, reject) => {
      if (this.handleResult({ result: response }, (result) => {
        resolve({ success: true, data: result.data });
      })) {
        // 成功处理
      } else {
        reject({ success: false, error: this.extractErrorMessage(response) });
      }
    });
  }

  /**
   * 处理网络请求错误
   */
  static handleNetworkError(err) {
    console.error('网络请求错误:', err);
    
    let errorMessage = '网络连接异常，请检查网络';
    
    // 根据错误类型提供更具体的信息
    if (err.errMsg) {
      if (err.errMsg.includes('timeout')) {
        errorMessage = '请求超时，请重试';
      } else if (err.errMsg.includes('fail')) {
        errorMessage = '网络请求失败，请重试';
      }
    }

    this.showErrorToast(errorMessage);

    return {
      success: false,
      error: errorMessage
    };
  }

  /**
   * 显示错误提示
   */
  static showErrorToast(message) {
    wx.showToast({
      title: message,
      icon: 'error',
      duration: 2500  // 🆕 增加显示时间，让用户有足够时间阅读
    });
  }

  /**
   * 显示成功提示
   */
  static showSuccessToast(message) {
    wx.showToast({
      title: message,
      icon: 'success',
      duration: 1500
    });
  }

  /**
   * 显示加载提示
   */
  static showLoading(title = '加载中...') {
    wx.showLoading({
      title,
      mask: true
    });
  }

  /**
   * 隐藏加载提示
   */
  static hideLoading() {
    wx.hideLoading();
  }

  /**
   * 错误日志记录
   */
  static logError(error) {
    const logData = {
      timestamp: new Date().toISOString(),
      error: error.error,
      context: error.context || '',
      errorCode: error.errorCode || '',
      page: getCurrentPages().pop()?.route || 'unknown'
    };
    
    console.error('客户端错误:', logData);
    
    // 可以在这里添加错误上报逻辑
    // this.reportError(logData);
  }

  /**
   * 统一的云函数调用方法
   */
  static async callCloudFunction(name, data) {
    this.showLoading();
    
    try {
      const result = await wx.cloud.callFunction({
        name,
        data
      });

      this.hideLoading();
      
      // 🆕 使用统一的处理方法
      return new Promise((resolve, reject) => {
        if (this.handleResult(result, (processedResult) => {
          resolve(processedResult);
        })) {
          // 成功处理
        } else {
          reject(this.extractErrorMessage(result.result || {}));
        }
      });
    } catch (err) {
      this.hideLoading();
      return this.handleNetworkError(err);
    }
  }

  /**
   * 兼容旧版本的错误处理方法
   */
  static handleError(error, defaultMessage = '操作失败', operationName = '') {
    console.log(`错误处理 [${operationName}]:`, error);
    
    let errorMessage = defaultMessage;
    if (error && typeof error === 'object') {
      if (error.message) {
        errorMessage = error.message;
      } else if (error.errMsg) {
        errorMessage = error.errMsg;
      } else if (typeof error.toString === 'function') {
        errorMessage = error.toString();
      }
    } else if (typeof error === 'string') {
      errorMessage = error;
    }
    
    this.showErrorToast(errorMessage);
  }
}

module.exports = ErrorHandler; 