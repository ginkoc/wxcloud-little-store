// 订单状态机引擎
const cloud = require('wx-server-sdk');
const logger = require('./logger');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

// 订单状态机共享定义
// 此文件同时被云函数和小程序前端使用

// 订单状态常量
const ORDER_STATUS = {
    PENDING_PAYMENT: 'pending_payment',    // 待支付
    PAID: 'paid',                         // 已支付
    ACCEPTED: 'accepted',                 // 已接单
    DELIVERING: 'delivering',             // 配送中
    DELIVERED: 'delivered',               // 待用户确认（配送完成）
    COMPLETED: 'completed',                // 已完成
    CANCELLED: 'cancelled',               // 已中止
    REFUNDING: 'refunding'                 // 退款中
  };
  
  // 状态映射表 - 用于显示
  const STATUS_MAPPING = {
    'pending_payment': '待支付',
    'paid': '已支付',
    'accepted': '已接单',
    'delivering': '配送中',
    'delivered': '待确认收货',
    'refunding': '退款中',
    'cancelled': '已中止',
    'completed': '已完成'
  };
  
  // 状态转换规则
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
  
  // 需要退款的状态变更
  const REFUND_REQUIRED_TRANSITIONS = [
    `${ORDER_STATUS.PAID}->${ORDER_STATUS.REFUNDING}`,
    `${ORDER_STATUS.ACCEPTED}->${ORDER_STATUS.REFUNDING}`,
    `${ORDER_STATUS.DELIVERING}->${ORDER_STATUS.REFUNDING}`,
    `${ORDER_STATUS.DELIVERED}->${ORDER_STATUS.REFUNDING}`
  ];
  
  // 状态友好提示消息
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
  
  // 状态机定义
  const ORDER_STATE_MACHINE = {
    // 状态定义
    states: {
      [ORDER_STATUS.PENDING_PAYMENT]: {
        name: STATUS_MAPPING[ORDER_STATUS.PENDING_PAYMENT],
        timeField: null, // 无特定时间字段
        icon: 'pending-payment-icon',
        color: '#FF9500',
        userActions: ['cancelOrder', 'payOrder'],
        adminActions: []
      },
      [ORDER_STATUS.PAID]: {
        name: STATUS_MAPPING[ORDER_STATUS.PAID],
        timeField: 'payTime',
        icon: 'paid-icon',
        color: '#1890FF',
        userActions: ['applyRefund'],
        adminActions: ['acceptOrder', 'cancelOrder', 'refundOrder']
      },
      [ORDER_STATUS.ACCEPTED]: {
        name: STATUS_MAPPING[ORDER_STATUS.ACCEPTED],
        timeField: 'acceptTime',
        icon: 'accepted-icon',
        color: '#52C41A',
        userActions: ['applyRefund'],
        adminActions: ['startDelivery', 'cancelOrder', 'refundOrder']
      },
      [ORDER_STATUS.DELIVERING]: {
        name: STATUS_MAPPING[ORDER_STATUS.DELIVERING],
        timeField: 'deliverTime',
        icon: 'delivering-icon',
        color: '#722ED1',
        userActions: ['applyRefund'],
        adminActions: ['completeDelivery', 'cancelOrder', 'refundOrder']
      },
      [ORDER_STATUS.DELIVERED]: {
        name: STATUS_MAPPING[ORDER_STATUS.DELIVERED],
        timeField: 'deliveredTime',
        icon: 'delivered-icon',
        color: '#13C2C2',
        userActions: ['confirmReceived', 'applyRefund'],
        adminActions: ['refundOrder']
      },
      [ORDER_STATUS.COMPLETED]: {
        name: STATUS_MAPPING[ORDER_STATUS.COMPLETED],
        timeField: 'completeTime',
        icon: 'completed-icon',
        color: '#52C41A',
        userActions: [],
        adminActions: []
      },
      [ORDER_STATUS.CANCELLED]: {
        name: STATUS_MAPPING[ORDER_STATUS.CANCELLED],
        timeField: 'cancelTime',
        icon: 'cancelled-icon',
        color: '#F5222D',
        userActions: [],
        adminActions: []
      },
      [ORDER_STATUS.REFUNDING]: {
        name: STATUS_MAPPING[ORDER_STATUS.REFUNDING],
        timeField: 'refundingTime',
        icon: 'refunding-icon',
        color: '#FA8C16',
        userActions: [],
        adminActions: ['cancelRefund', 'completeRefund']
      }
    },
    
    // 转换定义
    transitions: {
      // 用户操作
      payOrder: {
        from: ORDER_STATUS.PENDING_PAYMENT,
        to: ORDER_STATUS.PAID,
        requiredFields: ['isPaid', 'payTime'],
        userFriendlyName: '支付订单'
      },
      cancelOrder: {
        from: [ORDER_STATUS.PENDING_PAYMENT],
        to: ORDER_STATUS.CANCELLED,
        requiredFields: ['cancelTime', 'cancelReason'],
        userFriendlyName: '取消订单'
      },
      confirmReceived: {
        from: ORDER_STATUS.DELIVERED,
        to: ORDER_STATUS.COMPLETED,
        requiredFields: ['completeTime'],
        userFriendlyName: '确认收货'
      },
      applyRefund: {
        from: [ORDER_STATUS.PAID, ORDER_STATUS.ACCEPTED, ORDER_STATUS.DELIVERING, ORDER_STATUS.DELIVERED],
        to: ORDER_STATUS.REFUNDING,
        requiredFields: ['refundingTime', 'refundReason'],
        userFriendlyName: '申请退款'
      },
      
      // 管理员操作
      acceptOrder: {
        from: ORDER_STATUS.PAID,
        to: ORDER_STATUS.ACCEPTED,
        requiredFields: ['acceptTime'],
        userFriendlyName: '接单'
      },
      startDelivery: {
        from: ORDER_STATUS.ACCEPTED,
        to: ORDER_STATUS.DELIVERING,
        requiredFields: ['deliverTime'],
        userFriendlyName: '开始配送'
      },
      completeDelivery: {
        from: ORDER_STATUS.DELIVERING,
        to: ORDER_STATUS.DELIVERED,
        requiredFields: ['deliveredTime'],
        userFriendlyName: '完成配送'
      },
      cancelOrderByAdmin: {
        from: [ORDER_STATUS.PAID, ORDER_STATUS.ACCEPTED, ORDER_STATUS.DELIVERING],
        to: ORDER_STATUS.CANCELLED,
        requiredFields: ['cancelTime', 'cancelReason', 'cancelOperator'],
        userFriendlyName: '取消订单'
      },
      refundOrder: {
        from: [ORDER_STATUS.PAID, ORDER_STATUS.ACCEPTED, ORDER_STATUS.DELIVERING, ORDER_STATUS.DELIVERED],
        to: ORDER_STATUS.REFUNDING,
        requiredFields: ['refundingTime', 'refundReason'],
        userFriendlyName: '退款'
      },
      cancelRefund: {
        from: ORDER_STATUS.REFUNDING,
        to: ORDER_STATUS.CANCELLED,
        requiredFields: ['cancelTime', 'cancelReason'],
        userFriendlyName: '取消退款'
      },
      completeRefund: {
        from: ORDER_STATUS.REFUNDING,
        to: ORDER_STATUS.CANCELLED,
        requiredFields: ['cancelTime', 'refundTime', 'refundAmount'],
        userFriendlyName: '完成退款'
      }
    }
  };

// 定义OrderStateMachine类
class OrderStateMachine {
  constructor() {
    // 将配置添加到实例
    this.ORDER_STATUS = ORDER_STATUS;
    this.STATUS_MAPPING = STATUS_MAPPING;
    this.STATUS_TRANSITIONS = STATUS_TRANSITIONS;
    this.REFUND_REQUIRED_TRANSITIONS = REFUND_REQUIRED_TRANSITIONS;
    this.FRIENDLY_MSG_WHEN_STATUS_CHANGE = FRIENDLY_MSG_WHEN_STATUS_CHANGE;
    this.states = ORDER_STATE_MACHINE.states;
    this.transitions = ORDER_STATE_MACHINE.transitions;
  }
  
  /**
   * 执行状态转换
   * @param {string} orderId - 订单ID
   * @param {string} transitionName - 转换名称
   * @param {Object} context - 上下文信息，包含操作者ID、备注等
   * @returns {Promise<Object>} 转换结果
   */
  async executeTransition(orderId, transitionName, context = {}) {
    logger.debug('开始执行状态转换', { 
      orderId, 
      transitionName, 
      operatorId: context.operatorId,
      isAdminOperation: !!context.isAdminOperation 
    });
    
    // 1. 获取订单当前状态
    const orderResult = await db.collection('orders').doc(orderId).get();
    if (!orderResult.data) {
      logger.error('订单不存在', { orderId, transitionName });
      throw new Error('订单不存在');
    }
    
    const order = orderResult.data;
    const currentState = order.status;
    
    // 2. 获取转换定义
    const transition = this.transitions[transitionName];
    if (!transition) {
      logger.error('未定义的转换', { transitionName, orderId });
      throw new Error(`未定义的转换: ${transitionName}`);
    }
    
    // 3. 检查当前状态是否可以执行此转换
    const fromStates = Array.isArray(transition.from) ? transition.from : [transition.from];
    if (!fromStates.includes(currentState)) {
      logger.error('当前状态无法执行此转换', { 
        currentState, 
        transitionName,
        allowedFromStates: fromStates,
        orderId
      });
      throw new Error(`无法从 ${this.getStatusText(currentState)} 状态执行 ${transition.userFriendlyName} 操作`);
    }
    
    // 4. 检查是否需要执行特殊业务逻辑
    if (transitionName === 'refundOrder' || transitionName === 'applyRefund') {
      // 这里可以添加特殊的退款前置检查
      await this.validateRefund(order, context);
    }
    
    const newState = transition.to;
    
    // 5. 准备更新数据
    const updateData = {
      status: newState,
      updateTime: db.serverDate()
    };
    
    // 6. 根据转换定义设置必要字段
    if (transition.requiredFields && transition.requiredFields.length > 0) {
      for (const field of transition.requiredFields) {
        if (field.endsWith('Time')) {
          // 自动设置时间字段
          updateData[field] = db.serverDate();
        } else if (field === 'cancelReason' && context.reason) {
          // 设置取消原因
          updateData[field] = context.reason;
        } else if (field === 'cancelOperator' && context.operatorId) {
          // 设置取消操作者
          updateData[field] = context.isAdminOperation ? '商家' : '用户';
        } else if (field === 'refundReason' && context.reason) {
          // 设置退款原因
          updateData[field] = context.reason;
        } else if (field === 'isPaid' && newState === ORDER_STATUS.PAID) {
          // 设置支付标志
          updateData[field] = true;
        }
      }
    }
    
    // 7. 获取友好提示消息
    const userFriendlyMessage = this.getFriendlyMessage(currentState, newState) || 
                               `订单状态已更新为${this.getStatusText(newState)}`;
    
    // 8. 开启事务
    const transaction = await db.startTransaction();
    
    try {
      // 9. 更新订单状态
      const updateResult = await transaction.collection('orders').doc(orderId).update({
        data: updateData
      });
      
      if (updateResult.stats.updated === 0) {
        await transaction.rollback();
        logger.error('更新订单状态失败', { orderId, transitionName, currentState, newState });
        throw new Error('更新订单状态失败');
      }
      
      // 10. 添加订单历史记录
      const historyData = {
        orderId,
        fromStatus: currentState,
        toStatus: newState,
        operator: context.isAdminOperation ? '商家' : context.operatorId === 'system' ? '系统' : '用户',
        operatorId: context.operatorId || 'system',
        statusText: this.getStatusText(newState),
        remark: context.remark || '',
        userFriendlyMessage,
        operationResult: 1,  // 成功标记
        createTime: db.serverDate()
      };
      
      await transaction.collection('order_history').add({
        data: historyData
      });
      
      // 11. 提交事务
      await transaction.commit();
      
      // 12. 记录业务日志
      logger.business('订单状态更新', '成功', {
        orderId,
        transitionName,
        fromStatus: currentState,
        toStatus: newState,
        operatorId: context.operatorId,
        isAdmin: !!context.isAdminOperation,
      });
      
      // 13. 返回成功结果
      return {
        success: true,
        data: {
          ...order,
          ...updateData,
          statusText: this.getStatusText(newState)
        },
        message: userFriendlyMessage
      };
    } catch (error) {
      // 事务错误处理
      await transaction.rollback();
      logger.error('执行状态转换事务失败:', { 
        orderId, 
        transitionName,
        fromStatus: currentState,
        toStatus: newState,
        error: error.message || String(error),
        stack: error.stack
      });
      
      throw error;
    }
  }

  /**
   * 获取状态文本
   * @param {string} status - 状态码
   * @returns {string} 状态文本
   */
  getStatusText(status) {
    return STATUS_MAPPING[status] || status;
  }
  
  /**
   * 获取友好提示消息
   * @param {string} fromStatus - 原状态
   * @param {string} toStatus - 目标状态
   * @returns {string|null} 友好提示消息
   */
  getFriendlyMessage(fromStatus, toStatus) {
    if (!fromStatus || !toStatus) return null;
    
    try {
      // 首先尝试从当前对象的引用获取
      if (FRIENDLY_MSG_WHEN_STATUS_CHANGE[fromStatus] && 
          FRIENDLY_MSG_WHEN_STATUS_CHANGE[fromStatus][toStatus]) {
        return FRIENDLY_MSG_WHEN_STATUS_CHANGE[fromStatus][toStatus];
      }
      
      // 如果未找到，返回默认消息
      return null;
    } catch (error) {
      logger.error('获取友好提示消息失败', {
        fromStatus,
        toStatus,
        error: error.message || String(error)
      });
      return null;
    }
  }

  async needsRefund(fromStatus, toStatus) {
    const transition = `${fromStatus}->${toStatus}`;
    return REFUND_REQUIRED_TRANSITIONS.includes(transition);
  }
  
  /**
   * 验证退款操作
   * @param {Object} order - 订单信息
   * @param {Object} context - 上下文信息
   */
  async validateRefund(order, context) {
    // 检查订单是否已支付
    if (!order.isPaid) {
      throw new Error('订单未支付，无法申请退款');
    }
    
    // 可以添加更多退款前置检查，如退款时间限制、退款次数等
    
    return true;
  }
  
  /**
   * 获取当前状态可用的操作
   * @param {string} status - 当前状态
   * @param {boolean} isAdmin - 是否为管理员
   * @returns {Array<Object>} 可用操作列表
   */
  getAvailableActions(status, isAdmin = false) {
    const stateDefinition = this.states[status];
    if (!stateDefinition) return [];
    
    const actions = isAdmin ? stateDefinition.adminActions : stateDefinition.userActions;
    
    return actions.map(actionName => {
      const transition = this.transitions[actionName];
      return {
        name: actionName,
        displayName: transition?.userFriendlyName || actionName,
        to: transition?.to
      };
    });
  }
  
  /**
   * 获取指定订单的可用操作列表
   * @param {Object} order - 订单对象
   * @param {boolean} isAdmin - 是否为管理员用户
   * @returns {Array<Object>} 可用操作列表
   */
  getOrderActions(order, isAdmin = false) {
    if (!order || !order.status) {
      return [];
    }
    
    const actions = this.getAvailableActions(order.status, isAdmin);
    
    // 根据业务规则过滤操作
    return actions.filter(action => {
      // 已申请退款的订单不允许普通用户确认收货
      if (!isAdmin && order.status === 'delivered' && order.refundApplied && action.name === 'CONFIRM_RECEIPT') {
        return false;
      }
      
      // 订单支付后超过特定时间不可退款（可配置）
      if (action.name === 'APPLY_REFUND' && order.paidTime) {
        const now = new Date();
        const paidTime = new Date(order.paidTime);
        const diffHours = (now - paidTime) / (1000 * 60 * 60);
        const maxRefundHours = 24; // 可从配置获取
        
        if (diffHours > maxRefundHours) {
          return false;
        }
      }
      
      return true;
    });
  }

  /**
   * 批量执行状态转换
   * @param {Array<string>} orderIds - 订单ID数组
   * @param {string} transitionName - 转换名称
   * @param {Object} context - 上下文信息，包含操作者ID、备注等
   * @returns {Promise<Object>} 批量转换结果
   */
  async executeBatchTransition(orderIds, transitionName, context = {}) {
    if (!orderIds || orderIds.length === 0) {
      return {
        success: false,
        error: '订单ID列表为空'
      };
    }
    
    logger.debug('开始批量执行状态转换', { 
      orderCount: orderIds.length, 
      transitionName, 
      operatorId: context.operatorId,
      isAdminOperation: !!context.isAdminOperation 
    });
    
    try {
      // 1. 获取转换定义
      const transition = this.transitions[transitionName];
      
      // 处理特殊情况：确认收货转换与其他转换的命名不同步问题
      let effectiveTransition = transition;
      if (!effectiveTransition && transitionName === 'CONFIRM_RECEIPT') {
        // 尝试使用confirmReceived转换（小写命名的转换）
        effectiveTransition = this.transitions['confirmReceived'];
        logger.info('尝试使用confirmReceived转换替代CONFIRM_RECEIPT', { found: !!effectiveTransition });
      }
      
      if (!effectiveTransition) {
        return {
          success: false,
          error: `未定义的转换: ${transitionName}`
        };
      }
      
      // 2. 获取所有订单信息
      const ordersResult = await db.collection('orders')
        .where({
          _id: db.command.in(orderIds)
        })
        .get();
      
      const orders = ordersResult.data;
      if (orders.length === 0) {
        return {
          success: false,
          error: '未找到指定订单'
        };
      }
      
      // 3. 筛选可以进行状态转换的订单
      const validOrders = this._filterValidOrdersForTransition(orders, effectiveTransition);
      
      if (validOrders.length === 0) {
        return {
          success: false,
          error: `没有订单可以执行 ${effectiveTransition.userFriendlyName || transitionName} 操作`
        };
      }
      
      // 4. 执行批量状态转换
      return await this._performBatchTransition(validOrders, effectiveTransition, context);
    } catch (error) {
      logger.error('批量执行状态转换失败', { 
        orderIds: orderIds.length, 
        transitionName, 
        error: error.message || String(error),
        stack: error.stack
      });
      
      return {
        success: false,
        error: '批量状态转换失败',
        details: error.message || String(error)
      };
    }
  }

  /**
   * 筛选可以进行状态转换的订单
   * @param {Array<Object>} orders - 订单列表
   * @param {Object} transition - 转换定义
   * @returns {Array<Object>} 有效的订单列表
   * @private
   */
  _filterValidOrdersForTransition(orders, transition) {
    return orders.filter(order => {
      const fromStates = Array.isArray(transition.from) ? transition.from : [transition.from];
      return fromStates.includes(order.status);
    });
  }

  /**
   * 执行批量状态转换事务
   * @param {Array<Object>} validOrders - 有效的订单列表
   * @param {Object} transition - 转换定义
   * @param {Object} context - 上下文信息
   * @returns {Promise<Object>} 转换结果
   * @private
   */
  async _performBatchTransition(validOrders, transition, context) {
    const validOrderIds = validOrders.map(order => order._id);
    const updateTime = db.serverDate();
    const newStatus = transition.to;
    const { operatorId, isAdminOperation, remark, reason } = context;
    
    // 1. 开启事务
    const transaction = await db.startTransaction();
    
    try {
      // 2. 准备更新数据
      const updateData = {
        status: newStatus,
        updateTime: updateTime
      };
      
      // 3. 使用状态机定义的必要字段进行设置
      if (transition.requiredFields && transition.requiredFields.length > 0) {
        for (const field of transition.requiredFields) {
          if (field.endsWith('Time')) {
            // 自动设置时间字段
            updateData[field] = updateTime;
          } else if (field === 'isPaid' && newStatus === ORDER_STATUS.PAID) {
            updateData[field] = true;
          } else if (field === 'cancelReason' && reason) {
            updateData[field] = reason;
          } else if (field === 'refundReason' && reason) {
            updateData[field] = reason;
          } else if (field === 'cancelOperator' && operatorId) {
            updateData[field] = isAdminOperation ? '商家' : '用户';
          }
        }
      }
      
      // 4. 批量更新订单状态
      await transaction.collection('orders')
        .where({
          _id: db.command.in(validOrderIds)
        })
        .update({
          data: updateData
        });
      
      // 5. 批量创建历史记录
      const historyBatchSize = 20; // 批量插入限制
      const operator = isAdminOperation ? '商家' : operatorId === 'system' ? '系统' : '用户';
      const statusText = this.getStatusText(newStatus);
      
      for (let i = 0; i < validOrders.length; i += historyBatchSize) {
        const batchOrders = validOrders.slice(i, i + historyBatchSize);
        const historyRecords = batchOrders.map(order => ({
          orderId: order._id,
          fromStatus: order.status,
          toStatus: newStatus,
          operator: operator,
          operatorId: operatorId || 'system',
          statusText: statusText,
          remark: remark || '',
          userFriendlyMessage: this.getFriendlyMessage(order.status, newStatus) || 
                             transition.userFriendlyName || 
                             '批量状态更新',
          operationResult: 1,  // 成功标记
          createTime: updateTime
        }));
        
        await transaction.collection('order_history').add({
          data: historyRecords
        });
      }
      
      // 6. 提交事务
      await transaction.commit();
      
      // 7. 记录业务日志
      logger.business('批量订单状态更新', '成功', {
        transitionName: transition.userFriendlyName || '状态更新',
        orderCount: validOrderIds.length,
        fromStatus: validOrders.map(o => o.status),
        toStatus: newStatus,
        operatorId,
        isAdmin: !!isAdminOperation,
      });
      
      // 8. 返回成功结果
      return {
        success: true,
        data: {
          updated: validOrderIds.length,
          orderIds: validOrderIds,
          skipped: validOrders.length - validOrderIds.length,
          statusText: statusText
        },
        message: `成功更新 ${validOrderIds.length} 个订单`
      };
    } catch (error) {
      // 事务错误处理
      await transaction.rollback();
      logger.error('批量更新订单状态事务失败:', { 
        error: error.message || String(error),
        stack: error.stack
      });
      
      throw error;
    }
  }
}

// 创建单例实例
const orderStateMachine = new OrderStateMachine();

// 导出单例实例和ORDER_STATUS常量
module.exports = {
  orderStateMachine,
  ORDER_STATUS
};