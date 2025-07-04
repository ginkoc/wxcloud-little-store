// 订单状态历史处理工具类
const { ORDER_STATUS, OPERATION_TYPE, OrderUtils } = require('./orderUtils');

class OrderHistoryUtils {
  
  /**
   * 获取操作类型
   * @param {Object} historyItem 历史记录项
   * @returns {String} 操作类型
   */
  static getOperationType(historyItem) {
    // 首先尝试从metadata中获取操作类型
    if (historyItem.metadata && historyItem.metadata.operationType) {
      return historyItem.metadata.operationType;
    }
    
    const fromStatus = historyItem.fromStatus;
    const toStatus = historyItem.toStatus;
    
    // 根据状态转换判断操作类型，映射到orderUtils.js中的OPERATION_TYPE常量
    if (fromStatus === ORDER_STATUS.PENDING_PAYMENT && toStatus === ORDER_STATUS.PAID) {
      return OPERATION_TYPE.PAY_ORDER;
    } else if (fromStatus === ORDER_STATUS.PAID && toStatus === ORDER_STATUS.ACCEPTED) {
      return OPERATION_TYPE.ACCEPT_ORDER;
    } else if (fromStatus === ORDER_STATUS.ACCEPTED && toStatus === ORDER_STATUS.DELIVERING) {
      return OPERATION_TYPE.START_DELIVERY;
    } else if (fromStatus === ORDER_STATUS.DELIVERING && toStatus === ORDER_STATUS.DELIVERED) {
      return OPERATION_TYPE.COMPLETE_DELIVERY;
    } else if (fromStatus === ORDER_STATUS.DELIVERED && toStatus === ORDER_STATUS.COMPLETED) {
      return OPERATION_TYPE.CONFIRM_RECEIVED;
    } else if (toStatus === ORDER_STATUS.CANCELLED) {
      return OPERATION_TYPE.CANCEL_ORDER;
    } else if (toStatus === ORDER_STATUS.REFUNDING) {
      return OPERATION_TYPE.APPLY_REFUND;
    } else if (fromStatus === ORDER_STATUS.REFUNDING && toStatus !== ORDER_STATUS.CANCELLED) {
      // 从退款状态变为非取消状态，说明是退款失败回滚
      return OPERATION_TYPE.ROLLBACK;
    }
    
    // 默认为状态变更
    return OPERATION_TYPE.STATUS_CHANGE;
  }

  /**
   * 判断是否为失败操作
   * @param {Object} historyItem 历史记录项
   * @returns {Boolean} 是否为失败操作
   */
  static isFailedOperation(historyItem) {
    // 直接检查operationResult字段，0表示失败
    const isFailed = historyItem.operationResult === 0;
    
    // 检查metadata中是否有失败相关的标记
    if (!isFailed && historyItem.metadata) {
      const metadata = historyItem.metadata;
      
      // 检查是否有退款失败的标记
      if (metadata.operationType === OPERATION_TYPE.REFUND_FAILED) {
        return true;
      }
      
      // 检查additionalData中是否有失败相关的信息
      const additionalData = metadata.additionalData || {};
      if (additionalData.refundError || 
          additionalData.errorCode || 
          additionalData.failureType || 
          additionalData.technicalError) {
        return true;
      }
    }
    
    return isFailed;
  }

  /**
   * 🔧 重构：基于操作类型和结果生成显示信息（不依赖remark文本匹配）
   */
  static getStatusDisplayInfo(historyItem, isFailedOperation) {
    // 如果是失败操作，应该显示失败的状态信息
    if (isFailedOperation) {
      // 获取操作类型，用于确定显示什么信息
      const operationType = this.getOperationType(historyItem);
      
      // 根据操作类型和元数据确定显示信息
      switch(operationType) {
        case OPERATION_TYPE.REFUND_FAILED:
          return {
            statusText: '退款处理失败',
            displayRemark: historyItem.remark || '退款处理遇到问题，请联系客服',
            statusType: 'failed',
            userFriendlyMessage: historyItem.userFriendlyMessage || '退款处理遇到问题，系统会自动重试',
            showContactService: true
          };
          
        case OPERATION_TYPE.PAYMENT_FAILED:
          return {
            statusText: '支付失败',
            displayRemark: historyItem.remark || '支付处理失败',
            statusType: 'failed',
            userFriendlyMessage: historyItem.userFriendlyMessage || '支付未成功，请重新尝试',
            showContactService: false
          };
          
        default:
          // 默认失败状态显示
          return {
            statusText: `${this.getStatusText(historyItem.fromStatus)}(失败)`,
            displayRemark: historyItem.remark || '操作未成功完成',
            statusType: 'failed',
            userFriendlyMessage: historyItem.userFriendlyMessage,
            showContactService: false
          };
      }
    }
    
    // 正常状态变更
    // 修复：优先使用toStatus的状态文本，而不是直接使用statusText字段
    const statusText = this.getStatusText(historyItem.toStatus) || historyItem.statusText || '未知状态';
    
    // 根据状态确定是否需要显示备注
    let displayRemark = null;
    let statusType = 'normal';
    
    // 特殊状态处理
    if (historyItem.toStatus === ORDER_STATUS.REFUNDING) {
      statusType = 'warning';
      displayRemark = historyItem.remark || '订单正在申请退款';
    } else if (historyItem.toStatus === ORDER_STATUS.CANCELLED) {
      statusType = 'warning';
      displayRemark = historyItem.remark || '订单已取消';
    } else if (historyItem.remark && historyItem.remark.trim() !== '') {
      // 如果有备注，则显示备注
      displayRemark = historyItem.remark;
    }
    
    return {
      statusText,
      displayRemark,
      statusType,
      userFriendlyMessage: historyItem.userFriendlyMessage,
      showContactService: false
    };
  }

  /**
   *  获取状态文本（本地方法）
   */
  static getStatusText(status) {
    try {
      return OrderUtils.getStatusText(status);
    } catch (error) {
      console.error('获取状态文本失败:', error);
      return status;
    }
  }

  /**
   *  处理状态历史数据列表
   * @param {Array} historyList 原始状态历史列表
   * @param {Function} formatTimeFunc 时间格式化函数
   * @returns {Array} 处理后的状态历史列表
   */
  static processStatusHistoryList(historyList, formatTimeFunc) {
    const processedList = historyList.map(item => {
      // 检查是否为失败状态
      const isFailedOperation = this.isFailedOperation(item);
      const statusInfo = this.getStatusDisplayInfo(item, isFailedOperation);
      
      // 边界数据处理：为空的fromStatusText设置默认值
      let fromStatusText = '';
      if (item.fromStatus) {
        fromStatusText = this.getStatusText(item.fromStatus);
      } else if (item.fromStatus === '' && item.toStatus) {
        fromStatusText = '初始状态';
      }
      
      return {
        ...item,
        statusText: statusInfo.statusText,
        fromStatusText: fromStatusText,
        timeText: formatTimeFunc ? formatTimeFunc(item.createTime) : item.createTime,
        operatorText: item.operatorId ? `${item.operator || '系统'}` : '系统',
        // 失败状态标识
        isFailed: isFailedOperation,
        displayRemark: statusInfo.displayRemark,
        statusType: statusInfo.statusType, // normal, failed, warning
        userFriendlyMessage: statusInfo.userFriendlyMessage,
        showContactService: statusInfo.showContactService,
        
        // 退款相关标识
        isRefundRelated: item.toStatus === ORDER_STATUS.REFUNDING || 
                        item.fromStatus === ORDER_STATUS.REFUNDING || 
                        (item.metadata?.operationType === OPERATION_TYPE.REFUND_FAILED)
      };
    });
    
    return processedList;
  }

  /**
   *  通用的toggleStatusHistory实现
   * @param {Object} pageContext 页面上下文(this)
   * @param {Function} loadHistoryCallback 加载历史记录的回调函数
   */
  static toggleStatusHistory(pageContext, loadHistoryCallback) {
    const showStatusHistory = !pageContext.data.showStatusHistory;
    
    // 展开状态时重置分页状态
    if (showStatusHistory) {
      // 重置分页状态，确保每次展开时都显示最新的数据
      pageContext.setData({
        showStatusHistory: true,
        historyPage: 1,
        hasMoreHistory: true,
        statusHistoryList: [],
        historyLoaded: false,
        isLoadingMore: false
      });
      
      // 立即加载历史记录
      if (loadHistoryCallback) {
        loadHistoryCallback.call(pageContext);
      }
    } else {
      // 只需折叠显示
      pageContext.setData({
        showStatusHistory: false
      });
    }
  }
}

module.exports = OrderHistoryUtils; 