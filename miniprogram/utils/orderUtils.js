/**
 * 订单工具类
 * 包含订单状态管理、流转逻辑、权限控制等功能
 */
const OrderStateManager = require('./orderStateManager');

// 订单状态枚举 - 保留用于向后兼容
const ORDER_STATUS = {
  PENDING_PAYMENT: 'pending_payment',    // 待支付
  PAID: 'paid',                         // 已支付
  ACCEPTED: 'accepted',                 // 已接单
  DELIVERING: 'delivering',             // 待配送
  DELIVERED: 'delivered',               // 待用户确认（配送完成）
  REFUNDING: 'refunding',               // 退款中
  CANCELLED: 'cancelled',               // 已中止
  COMPLETED: 'completed'                // 已完成
};

// 操作类型枚举 - 与后端状态机保持一致
const OPERATION_TYPE = {
  // 用户操作
  CANCEL_ORDER: 'cancelOrder',           // 取消订单
  PAY_ORDER: 'payOrder',                 // 支付订单
  CONFIRM_RECEIVED: 'confirmReceived',   // 确认收货
  APPLY_REFUND: 'applyRefund',           // 申请退款
  
  // 管理员操作
  ACCEPT_ORDER: 'acceptOrder',           // 接单
  START_DELIVERY: 'startDelivery',       // 开始配送
  COMPLETE_DELIVERY: 'completeDelivery', // 完成配送
  REFUND_ORDER: 'refundOrder',           // 退款订单
  CANCEL_REFUND: 'cancelRefund',         // 取消退款
  COMPLETE_REFUND: 'completeRefund',     // 完成退款
  
  // 系统操作
  REFUND_FAILED: 'refundFailed',         // 退款失败
  STATUS_CHANGE: 'statusChange',         // 状态变更
  ROLLBACK: 'rollback'                   // 状态回滚
};

// 订单状态中文显示 - 保留用于向后兼容
const ORDER_STATUS_TEXT = {
  [ORDER_STATUS.PENDING_PAYMENT]: '待支付',
  [ORDER_STATUS.PAID]: '已支付',
  [ORDER_STATUS.ACCEPTED]: '已接单',
  [ORDER_STATUS.DELIVERING]: '配送中',
  [ORDER_STATUS.DELIVERED]: '待确认收货',
  [ORDER_STATUS.REFUNDING]: '退款中',
  [ORDER_STATUS.CANCELLED]: '已中止',
  [ORDER_STATUS.COMPLETED]: '已完成'
};

// 订单状态颜色 - 保留用于向后兼容
const ORDER_STATUS_COLOR = {
  [ORDER_STATUS.PENDING_PAYMENT]: '#ff9500', // 橙色
  [ORDER_STATUS.PAID]: '#007aff',            // 蓝色
  [ORDER_STATUS.ACCEPTED]: '#5856d6',        // 紫色
  [ORDER_STATUS.DELIVERING]: '#ff3b30',      // 红色
  [ORDER_STATUS.DELIVERED]: '#ff9500',       // 橙色
  [ORDER_STATUS.REFUNDING]: '#ff9500',       // 橙色
  [ORDER_STATUS.CANCELLED]: '#8e8e93',       // 灰色
  [ORDER_STATUS.COMPLETED]: '#34c759'        // 绿色
};

// 状态转换规则 - 与后端保持一致
const STATUS_TRANSITIONS = {
  [ORDER_STATUS.PENDING_PAYMENT]: [ORDER_STATUS.PAID, ORDER_STATUS.CANCELLED], // 待支付 -> 已支付/已中止
  [ORDER_STATUS.PAID]: [ORDER_STATUS.ACCEPTED, ORDER_STATUS.CANCELLED, ORDER_STATUS.REFUNDING], // 已支付 -> 已接单/已中止/退款中
  [ORDER_STATUS.ACCEPTED]: [ORDER_STATUS.DELIVERING, ORDER_STATUS.CANCELLED, ORDER_STATUS.REFUNDING], // 已接单 -> 配送中/已中止/退款中
  [ORDER_STATUS.DELIVERING]: [ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED, ORDER_STATUS.REFUNDING], // 配送中 -> 待确认收货/已中止/退款中
  [ORDER_STATUS.DELIVERED]: [ORDER_STATUS.COMPLETED, ORDER_STATUS.REFUNDING], // 待确认收货 -> 已完成/退款中
  [ORDER_STATUS.REFUNDING]: [ORDER_STATUS.CANCELLED, ORDER_STATUS.PAID], // 退款中 -> 已中止/已支付
  [ORDER_STATUS.COMPLETED]: [], // 已完成 -> 无后续状态
  [ORDER_STATUS.CANCELLED]: []  // 已中止 -> 无后续状态
};

// 用户权限操作定义 - 添加与后端状态机匹配的操作名称
const USER_ACTIONS = {
  // 客户可执行的操作
  CUSTOMER: {
    [ORDER_STATUS.PENDING_PAYMENT]: [OPERATION_TYPE.CANCEL_ORDER, OPERATION_TYPE.PAY_ORDER], // 取消订单、支付
    [ORDER_STATUS.PAID]: ['view', OPERATION_TYPE.APPLY_REFUND], // 可申请退款
    [ORDER_STATUS.ACCEPTED]: ['view', OPERATION_TYPE.APPLY_REFUND], // 可申请退款
    [ORDER_STATUS.DELIVERING]: ['view', OPERATION_TYPE.APPLY_REFUND], // 可申请退款
    [ORDER_STATUS.DELIVERED]: [OPERATION_TYPE.CONFIRM_RECEIVED, OPERATION_TYPE.APPLY_REFUND], // 确认收货、申请退款
    [ORDER_STATUS.REFUNDING]: ['view'], // 仅查看
    [ORDER_STATUS.CANCELLED]: ['view'], // 仅查看
    [ORDER_STATUS.COMPLETED]: ['view'] // 仅查看
  },
  // 管理员可执行的操作
  ADMIN: {
    [ORDER_STATUS.PENDING_PAYMENT]: [], // 看不到待支付订单
    [ORDER_STATUS.PAID]: [OPERATION_TYPE.ACCEPT_ORDER, OPERATION_TYPE.CANCEL_ORDER, OPERATION_TYPE.REFUND_ORDER], // 接单、中止、退款
    [ORDER_STATUS.ACCEPTED]: [OPERATION_TYPE.START_DELIVERY, OPERATION_TYPE.CANCEL_ORDER, OPERATION_TYPE.REFUND_ORDER], // 配送、中止、退款
    [ORDER_STATUS.DELIVERING]: [OPERATION_TYPE.COMPLETE_DELIVERY, OPERATION_TYPE.CANCEL_ORDER, OPERATION_TYPE.REFUND_ORDER], // 完成配送、中止、退款
    [ORDER_STATUS.DELIVERED]: [OPERATION_TYPE.CANCEL_ORDER, OPERATION_TYPE.REFUND_ORDER], // 退款
    [ORDER_STATUS.REFUNDING]: ['view', OPERATION_TYPE.CANCEL_REFUND, OPERATION_TYPE.COMPLETE_REFUND], // 取消退款、完成退款
    [ORDER_STATUS.CANCELLED]: ['view'], // 仅查看
    [ORDER_STATUS.COMPLETED]: ['view'] // 仅查看
  }
};

// 需要退款的状态变更 - 与后端保持一致
const REFUND_REQUIRED_TRANSITIONS = [
  `${ORDER_STATUS.PAID}->${ORDER_STATUS.REFUNDING}`,
  `${ORDER_STATUS.ACCEPTED}->${ORDER_STATUS.REFUNDING}`,
  `${ORDER_STATUS.DELIVERING}->${ORDER_STATUS.REFUNDING}`,
  `${ORDER_STATUS.DELIVERED}->${ORDER_STATUS.REFUNDING}`
];

// 状态友好提示消息 - 添加与后端一致的提示信息
const FRIENDLY_MSG_WHEN_STATUS_CHANGE = {
  'paid': {
    'refunding': '正在为您处理退款，预计1-3个工作日到账'
  },
  'refunding': {
    'cancelled': '订单状态已调整，如需退款请联系客服或重新申请'
  },
  'accepted': {
    'refunding': '正在为您处理退款，预计1-3个工作日到账'
  },
  'delivering': {
    'refunding': '正在为您处理退款，预计1-3个工作日到账'
  },
  'delivered': {
    'refunding': '正在为您处理退款，预计1-3个工作日到账'
  }
};

/**
 * 订单工具类
 */
class OrderUtils {
  
  /**
   * 获取订单状态文本
   */
  static getStatusText(status) {
    // 优先使用OrderStateManager
    if (OrderStateManager.config) {
      return OrderStateManager.getStatusText(status);
    }
    // 向后兼容
    return ORDER_STATUS_TEXT[status] || '未知状态';
  }

  /**
   * 获取订单状态颜色
   */
  static getStatusColor(status) {
    // 优先使用OrderStateManager
    if (OrderStateManager.config) {
      return OrderStateManager.getStatusColor(status);
    }
    // 向后兼容
    return ORDER_STATUS_COLOR[status] || '#8e8e93';
  }

  /**
   * 检查状态流转是否合法
   */
  static canTransition(fromStatus, toStatus) {
    // 优先使用OrderStateManager
    if (OrderStateManager.config) {
      return OrderStateManager.canTransition(fromStatus, toStatus);
    }
    // 向后兼容 - 使用原有静态定义
    const allowedTransitions = STATUS_TRANSITIONS[fromStatus] || [];
    return allowedTransitions.includes(toStatus);
  }

  /**
   * 获取用户在指定状态下可执行的操作
   */
  static getUserActions(status, isAdmin = false) {
    // 优先使用OrderStateManager
    if (OrderStateManager.config) {
      return OrderStateManager.getAvailableActions(status, isAdmin);
    }
    // 向后兼容 - 使用原有静态定义
    const userType = isAdmin ? 'ADMIN' : 'CUSTOMER';
    return USER_ACTIONS[userType][status] || [];
  }

  /**
   * 检查用户是否有权限执行指定操作
   */
  static hasPermission(status, action, isAdmin = false) {
    const actions = this.getUserActions(status, isAdmin);
    return actions.includes(action);
  }

  /**
   * 检查状态变更是否需要退款
   */
  static needsRefund(fromStatus, toStatus) {
    // 优先使用OrderStateManager
    if (OrderStateManager.config && OrderStateManager.config.REFUND_REQUIRED_TRANSITIONS) {
      const transition = `${fromStatus}->${toStatus}`;
      return OrderStateManager.config.REFUND_REQUIRED_TRANSITIONS.includes(transition);
    }
    // 向后兼容
    const transition = `${fromStatus}->${toStatus}`;
    return REFUND_REQUIRED_TRANSITIONS.includes(transition);
  }

  /**
   * 获取友好提示消息
   */
  static getFriendlyMessage(fromStatus, toStatus) {
    // 优先使用OrderStateManager
    if (OrderStateManager.config) {
      return OrderStateManager.getFriendlyMessage(fromStatus, toStatus);
    }
    // 向后兼容
    return FRIENDLY_MSG_WHEN_STATUS_CHANGE[fromStatus]?.[toStatus] || null;
  }

  /**
   * 检查订单对用户是否可见
   */
  static isVisibleToUser(order, userId, isAdmin = false) {
    // 管理员看不到待支付订单
    if (isAdmin && order.status === ORDER_STATUS.PENDING_PAYMENT) {
      return false;
    }
    
    // 客户只能看到自己的订单
    if (!isAdmin && order._openid !== userId) {
      return false;
    }
    
    return true;
  }

  /**
   * 获取订单可执行的操作按钮配置
   */
  static getActionButtons(order, isAdmin = false) {
    // 优先使用OrderStateManager
    if (OrderStateManager.config) {
      return OrderStateManager.getActionButtons(order.status, isAdmin);
    }
    
    // 向后兼容 - 使用原有实现
    const actions = this.getUserActions(order.status, isAdmin);
    const buttons = [];

    // 客户操作按钮
    if (!isAdmin) {
      if (actions.includes(OPERATION_TYPE.CANCEL_ORDER)) {
        buttons.push({ action: 'cancel', text: '取消订单', type: 'default' });
      }
      if (actions.includes(OPERATION_TYPE.PAY_ORDER)) {
        buttons.push({ action: 'pay', text: '立即支付', type: 'primary' });
      }
      if (actions.includes(OPERATION_TYPE.CONFIRM_RECEIVED)) {
        buttons.push({ action: 'confirm', text: '确认收货', type: 'primary' });
      }
      if (actions.includes(OPERATION_TYPE.APPLY_REFUND)) {
        buttons.push({ action: 'refund', text: '申请退款', type: 'default' });
      }
    }
    // 管理员操作按钮
    else {
      if (actions.includes(OPERATION_TYPE.ACCEPT_ORDER)) {
        buttons.push({ action: 'accept', text: '接单', type: 'primary' });
      }
      if (actions.includes(OPERATION_TYPE.START_DELIVERY)) {
        buttons.push({ action: 'deliver', text: '开始配送', type: 'primary' });
      }
      if (actions.includes(OPERATION_TYPE.COMPLETE_DELIVERY)) {
        buttons.push({ action: 'complete_delivery', text: '配送完成', type: 'primary' });
      }
      if (actions.includes(OPERATION_TYPE.CANCEL_ORDER)) {
        buttons.push({ action: 'cancel', text: '中止订单', type: 'warn' });
      }
      if (actions.includes(OPERATION_TYPE.REFUND_ORDER)) {
        buttons.push({ action: 'refund', text: '申请退款', type: 'default' });
      }
      if (actions.includes(OPERATION_TYPE.CANCEL_REFUND)) {
        buttons.push({ action: 'cancel_refund', text: '取消退款', type: 'default' });
      }
      if (actions.includes(OPERATION_TYPE.COMPLETE_REFUND)) {
        buttons.push({ action: 'complete_refund', text: '完成退款', type: 'primary' });
      }
    }

    return buttons;
  }

  /**
   * 获取状态变更的描述信息
   */
  static getTransitionDescription(fromStatus, toStatus, isAdmin = false) {
    const actor = isAdmin ? '管理员' : '客户';
    const fromText = this.getStatusText(fromStatus);
    const toText = this.getStatusText(toStatus);
    
    return `${actor}将订单从"${fromText}"变更为"${toText}"`;
  }

  /**
   * 检查订单是否超时需要自动确认
   */
  static needsAutoConfirm(order) {
    if (order.status !== ORDER_STATUS.DELIVERED) {
      return false;
    }
    
    // 检查是否有配送完成时间
    if (!order.deliveredTime) {
      return false;
    }
    
    // 计算是否超过7天
    const deliveredDate = new Date(order.deliveredTime);
    const now = new Date();
    const diffDays = Math.floor((now - deliveredDate) / (1000 * 60 * 60 * 24));
    
    return diffDays >= 7;
  }

  /**
   * 🆕 通用的接单操作处理
   * @param {Object} orderInfo 订单信息
   * @param {Function} callCloudFunction 云函数调用方法
   * @param {Function} showToast 显示提示方法
   * @param {Function} showConfirm 显示确认对话框方法
   * @param {Function} showSuccess 显示成功提示方法
   * @param {Function} onSuccess 成功回调
   * @param {Function} onError 错误回调(可选)
   */
  static handleAcceptOrder(orderInfo, callCloudFunction, showToast, showConfirm, showSuccess, onSuccess, onError) {
    if (!orderInfo) {
      showToast('订单信息无效');
      return;
    }

    if (orderInfo.status !== ORDER_STATUS.PAID) {
      showToast('订单状态不正确，无法接单');
      return;
    }

    showConfirm('确认接单', '确定要接受这个订单吗？', () => {
      callCloudFunction('order', {
        type: 'acceptOrder',
        orderId: orderInfo._id
      }, {
        loadingText: '接单中...',
        errorTitle: '接单失败',
        pageName: '订单详情'
      }).then(result => {
        showSuccess('接单成功');
        if (onSuccess) {
          onSuccess(result);
        }
      }).catch(err => {
        console.error('接单失败:', err);
        if (onError) {
          onError(err);
        }
      });
    });
  }

  /**
   * 格式化时间显示
   */
  static formatTime(time) {
    const date = new Date(time);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) { // 1分钟内
      return '刚刚';
    } else if (diff < 3600000) { // 1小时内
      return `${Math.floor(diff / 60000)}分钟前`;
    } else if (diff < 86400000) { // 1天内
      return `${Math.floor(diff / 3600000)}小时前`;
    } else {
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }
  }
}

/**
 * 🆕 判断订单是否需要显示退款信息
 * @param {Object} order 订单对象
 * @returns {Boolean} 是否需要显示退款信息
 */
function needsRefundInfo(order) {
  return order.status === ORDER_STATUS.REFUNDING || order.status === ORDER_STATUS.CANCELLED;
}

/**
 * 🆕 根据订单状态获取退款状态显示
 * @param {Object} order 订单对象  
 * @returns {Object|null} 退款状态信息
 */
function getRefundStatusFromOrderStatus(order) {
  if (!needsRefundInfo(order)) {
    return null;
  }
  
  switch(order.status) {
    case ORDER_STATUS.REFUNDING:
      return {
        status: 'PROCESSING',
        statusText: '退款处理中',
        color: '#ff9500'
      };
    case ORDER_STATUS.CANCELLED:
      return {
        status: 'SUCCESS', 
        statusText: '已退款',
        color: '#09bb07'
      };
    default:
      return null;
  }
}

// 导出常量和工具类
module.exports = {
  ORDER_STATUS,
  OPERATION_TYPE,
  ORDER_STATUS_TEXT,
  ORDER_STATUS_COLOR,
  STATUS_TRANSITIONS,
  REFUND_REQUIRED_TRANSITIONS,
  FRIENDLY_MSG_WHEN_STATUS_CHANGE,
  OrderUtils,
  needsRefundInfo,
  getRefundStatusFromOrderStatus
}; 