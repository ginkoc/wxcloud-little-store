const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

/**
 * 自动确认超时订单的定时任务云函数
 * 每天执行一次，将超过配置天数未确认的订单自动确认为已完成
 * 使用状态机实现，提高系统可维护性和稳定性
 */
exports.main = async (event, context) => {
  console.log('自动确认订单定时任务开始执行...');
  
  try {
    // 调用订单云函数的自动确认功能
    const result = await cloud.callFunction({
      name: 'order',
      data: {
        type: 'autoConfirmOrders'
      }
    });
    
    const response = result.result;
    
    if (response.success) {
      if (response.data && response.data.updated) {
        console.log(`自动确认订单任务执行完成: 成功处理 ${response.data.updated} 个订单`);
        console.log('处理结果:', response.data);
      } else {
        console.log('自动确认订单任务执行完成:', response.message);
      }
    } else {
      console.error('自动确认订单任务执行失败:', response.error);
    }
    
    return response;
  } catch (error) {
    console.error('自动确认订单任务执行异常:', error);
    return {
      success: false,
      error: error.message || '自动确认任务执行异常',
      stack: error.stack
    };
  }
}; 