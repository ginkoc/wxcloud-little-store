/**
 * 订单状态管理器
 * 用于统一前后端状态管理逻辑
 */

const OrderStateManager = {
  // 配置缓存
  config: null,
  
  // 初始化或刷新配置
  async init() {
    try {
      console.log('开始初始化订单状态配置');
      
      const { result } = await wx.cloud.callFunction({
        name: 'order',
        data: { type: 'getOrderStateMachineConfig' }
      });
      
      if (!result || !result.success) {
        console.error('获取订单状态配置异常', result?.error || '未知错误');
        this.tryLoadFromCache();
        return false;
      }
      
      // 保存配置
      this.config = result.data;
      
      // 写入本地缓存，下次可直接使用
      wx.setStorageSync('orderStateConfig', {
        data: this.config,
        updateTime: result.updateTime || Date.now()
      });
      
      console.log('订单状态配置初始化成功');
      return true;
    } catch (err) {
      console.error('获取订单状态配置失败', err);
      
      // 尝试从缓存恢复
      return this.tryLoadFromCache();
    }
  },
  
  // 尝试从缓存加载配置
  tryLoadFromCache() {
    try {
      const cachedConfig = wx.getStorageSync('orderStateConfig');
      if (cachedConfig && cachedConfig.data) {
        this.config = cachedConfig.data;
        console.log('从缓存加载订单状态配置成功', {
          updateTime: new Date(cachedConfig.updateTime).toLocaleString()
        });
        return true;
      }
    } catch (e) {
      console.error('从缓存加载订单状态配置失败', e);
    }
    return false;
  },
  
  // 获取状态文本
  getStatusText(status) {
    if (!this.config && !this.tryLoadFromCache()) {
      return status;
    }
    return this.config.STATUS_MAPPING?.[status] || status;
  },
  
  // 获取可执行操作
  getAvailableActions(status, isAdmin = false) {
    if (!this.config && !this.tryLoadFromCache()) {
      return [];
    }
    
    const stateDefinition = this.config.states?.[status];
    if (!stateDefinition) {
      return [];
    }
    
    // 直接返回状态机中定义的操作，不再进行额外映射
    return isAdmin ? stateDefinition.adminActions || [] : stateDefinition.userActions || [];
  },
  
  // 获取操作按钮配置
  getActionButtons(status, isAdmin = false) {
    const actions = this.getAvailableActions(status, isAdmin);
    if (!actions || actions.length === 0) {
      return [];
    }
    
    // 将操作转换为按钮配置
    return actions.map(action => {
      switch (action) {
        // 用户操作
        case 'cancelOrder':
          return { action: 'cancel', text: '取消订单', type: 'default' };
        case 'payOrder':
          return { action: 'pay', text: '立即支付', type: 'primary' };
        case 'confirmReceived':
          return { action: 'confirm', text: '确认收货', type: 'primary' };
        case 'applyRefund':
          return { action: 'refund', text: '申请退款', type: 'default' };
          
        // 管理员操作
        case 'acceptOrder':
          return { action: 'accept', text: '接单', type: 'primary' };
        case 'startDelivery':
          return { action: 'deliver', text: '开始配送', type: 'primary' };
        case 'completeDelivery':
          return { action: 'complete_delivery', text: '配送完成', type: 'primary' };
        case 'refundOrder':
          return { action: 'refund', text: '申请退款', type: 'default' };
        case 'cancelRefund':
          return { action: 'cancel_refund', text: '取消退款', type: 'default' };
        case 'completeRefund':
          return { action: 'complete_refund', text: '完成退款', type: 'primary' };
          
        default:
          return { action: action, text: action, type: 'default' };
      }
    });
  },
  
  // 检查状态转换是否合法
  canTransition(fromStatus, toStatus) {
    if (!this.config && !this.tryLoadFromCache()) {
      return false;
    }
    
    const allowedTransitions = this.config.STATUS_TRANSITIONS?.[fromStatus] || [];
    return allowedTransitions.includes(toStatus);
  },
  
  // 获取状态颜色
  getStatusColor(status) {
    if (!this.config && !this.tryLoadFromCache()) {
      return '#8e8e93'; // 默认灰色
    }
    
    const stateConfig = this.config.states?.[status];
    return stateConfig?.color || '#8e8e93';
  },
  
  // 获取友好提示消息
  getFriendlyMessage(fromStatus, toStatus) {
    if (!this.config && !this.tryLoadFromCache()) {
      return null;
    }
    
    try {
      const messages = this.config.FRIENDLY_MSG_WHEN_STATUS_CHANGE || {};
      return messages[fromStatus]?.[toStatus] || null;
    } catch (e) {
      console.error('获取友好提示消息失败', e);
      return null;
    }
  },
  
  // 执行订单状态转换操作
  async executeTransition(orderId, transitionName, context = {}) {
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'order',
        data: { 
          type: 'updateOrderStatus',
          orderId,
          transition: transitionName,
          ...context
        }
      });
      
      return result;
    } catch (err) {
      console.error('执行订单状态转换失败', err);
      return {
        success: false,
        error: err.message || '执行操作失败，请重试'
      };
    }
  }
};

// 导出订单状态管理器
module.exports = OrderStateManager; 