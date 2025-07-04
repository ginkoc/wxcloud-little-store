// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }) 

const db = cloud.database()
const _ = db.command

// 退款状态常量
const REFUND_STATUS = {
  PROCESSING: 'processing',
  FAILED: 'failed',
  SUCCESS: 'success'
};

// 云函数入口函数
exports.main = async (event, context) => {
  console.log('开始执行退款状态恢复检查');
  
  try {
    const recoveryResults = {
      incompleteRefunds: 0,
      inconsistentStates: 0,
      recovered: 0,
      failed: 0
    };
    
    // 获取待处理的退款数量，用于动态调整批处理大小
    const pendingCounts = await getPendingCounts();
    console.log('待处理退款统计:', pendingCounts);
    
    // 1. 优先处理长时间未完成的退款（高优先级）
    await processHighPriorityRefunds(recoveryResults);
    
    // 2. 处理一般未完成的退款
    await processIncompleteRefunds(recoveryResults, pendingCounts);
    
    // 3. 处理状态不一致的情况
    await processInconsistentStates(recoveryResults, pendingCounts);
    
    // 4. 处理需要恢复的退款回调错误
    await processRecoveryTasks(recoveryResults, pendingCounts);
    
    console.log('退款恢复任务完成:', recoveryResults);
    
    // 记录执行结果
    await db.collection('system_errors').add({
      data: {
        source: 'refundRecovery',
        context: 'task_completed',
        data: recoveryResults,
        timestamp: db.serverDate()
      }
    });
    
    return {
      success: true,
      results: recoveryResults
    };
  } catch (error) {
    console.error('退款恢复任务出错:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// 获取各类待处理退款数量
async function getPendingCounts() {
  try {
    // 超过1小时的退款中记录
    const oneHourAgo = new Date();
    oneHourAgo.setHours(oneHourAgo.getHours() - 1);
    
    // 超过24小时的退款中记录（高优先级）
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    
    // 获取长时间未完成的退款数量
    const longPendingCount = await db.collection('refunds')
      .where({
        status: REFUND_STATUS.PROCESSING,
        createTime: _.lt(oneDayAgo)
      })
      .count();
    
    // 获取一般未完成的退款数量
    const normalPendingCount = await db.collection('refunds')
      .where({
        status: REFUND_STATUS.PROCESSING,
        createTime: _.lt(oneHourAgo).and(_.gte(oneDayAgo))
      })
      .count();
    
    // 获取需要恢复的任务数量
    const recoveryTasksCount = await db.collection('system_errors')
      .where({
        needRecovery: true,
        context: 'recovery_needed'
      })
      .count();
    
    return {
      longPending: longPendingCount.total || 0,
      normalPending: normalPendingCount.total || 0,
      recoveryTasks: recoveryTasksCount.total || 0,
      // 计算动态批处理大小
      batchSizes: {
        highPriority: Math.min(20, longPendingCount.total || 0),
        normal: calculateBatchSize(normalPendingCount.total || 0),
        inconsistent: 10, // 状态不一致的处理保持10条
        recovery: calculateBatchSize(recoveryTasksCount.total || 0)
      }
    };
  } catch (error) {
    console.error('获取待处理退款数量出错:', error);
    // 出错时返回默认值
    return {
      longPending: 0,
      normalPending: 0,
      recoveryTasks: 0,
      batchSizes: {
        highPriority: 10,
        normal: 10,
        inconsistent: 10,
        recovery: 10
      }
    };
  }
}

// 根据待处理数量计算批处理大小
function calculateBatchSize(count) {
  if (count > 100) return 20;
  if (count > 50) return 15;
  return 10;
}

// 处理高优先级退款（长时间未完成的）
async function processHighPriorityRefunds(results) {
  // 超过24小时的退款中记录
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);
  
  const pendingRefunds = await db.collection('refunds')
    .where({
      status: REFUND_STATUS.PROCESSING,
      createTime: _.lt(oneDayAgo)
    })
    .limit(20) // 高优先级处理更多记录
    .get();
  
  if (pendingRefunds.data.length > 0) {
    console.log(`发现${pendingRefunds.data.length}条高优先级待处理退款`);
  }
  
  results.highPriorityRefunds = pendingRefunds.data.length;
  
  for (const refund of pendingRefunds.data) {
    try {
      // 查询微信退款状态
      const wxRefundStatus = await queryWxRefundStatus(refund.refundId);
      
      if (wxRefundStatus.success) {
        if (wxRefundStatus.status === 'SUCCESS') {
          // 退款实际已成功，同步状态
          await syncRefundSuccess(refund);
          results.recovered++;
        } else if (wxRefundStatus.status === 'FAIL') {
          // 退款实际已失败，同步状态
          await syncRefundFailed(refund);
          results.recovered++;
        }
        // 如果退款状态为PROCESSING，无需操作，等待后续处理
      } else {
        results.failed++;
        await logRecoveryError('查询微信退款状态失败', refund, wxRefundStatus.error);
      }
    } catch (error) {
      results.failed++;
      await logRecoveryError('处理高优先级未完成退款出错', refund, error);
    }
  }
}

// 处理一般未完成的退款
async function processIncompleteRefunds(results, pendingCounts) {
  // 超过1小时但不到24小时的退款中记录
  const oneHourAgo = new Date();
  oneHourAgo.setHours(oneHourAgo.getHours() - 1);
  
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);
  
  const batchSize = pendingCounts ? pendingCounts.batchSizes.normal : 10;
  
  const pendingRefunds = await db.collection('refunds')
    .where({
      status: REFUND_STATUS.PROCESSING,
      createTime: _.lt(oneHourAgo).and(_.gte(oneDayAgo))
    })
    .limit(batchSize)
    .get();
  
  results.incompleteRefunds = pendingRefunds.data.length;
  
  for (const refund of pendingRefunds.data) {
    try {
      // 查询微信退款状态
      const wxRefundStatus = await queryWxRefundStatus(refund.refundId);
      
      if (wxRefundStatus.success) {
        if (wxRefundStatus.status === 'SUCCESS') {
          // 退款实际已成功，同步状态
          await syncRefundSuccess(refund);
          results.recovered++;
        } else if (wxRefundStatus.status === 'FAIL') {
          // 退款实际已失败，同步状态
          await syncRefundFailed(refund);
          results.recovered++;
        }
        // 如果退款状态为PROCESSING，无需操作，等待后续处理
      } else {
        results.failed++;
        await logRecoveryError('查询微信退款状态失败', refund, wxRefundStatus.error);
      }
    } catch (error) {
      results.failed++;
      await logRecoveryError('处理未完成退款出错', refund, error);
    }
  }
}

// 处理状态不一致的情况
async function processInconsistentStates(results, pendingCounts) {
  try {
    const batchSize = pendingCounts ? pendingCounts.batchSizes.inconsistent : 10;
    
    // 1. 退款成功但订单不是cancelled状态
    const successfulRefunds = await db.collection('refunds')
      .where({
        status: REFUND_STATUS.SUCCESS
      })
      .limit(batchSize)
      .get();
    
    for (const refund of successfulRefunds.data) {
      const orderRes = await db.collection('orders').doc(refund.orderId).get();
      if (orderRes.data && orderRes.data.status !== 'cancelled') {
        results.inconsistentStates++;
        await syncOrderStatus(refund, orderRes.data);
        results.recovered++;
      }
    }
    
    // 2. 订单已取消但退款记录不是成功状态
    const cancelledOrders = await db.collection('orders')
      .where({
        status: 'cancelled',
        refundId: _.exists(true) // 存在退款ID字段
      })
      .limit(batchSize)
      .get();
    
    for (const order of cancelledOrders.data) {
      if (!order.refundId) continue;
      
      const refundQuery = await db.collection('refunds').doc(order.refundId).get();
      
      if (refundQuery.data) {
        const refund = refundQuery.data;
        if (refund.status !== REFUND_STATUS.SUCCESS) {
          results.inconsistentStates++;
          await syncRefundStatus(refund);
          results.recovered++;
        }
      }
    }
  } catch (error) {
    console.error('处理状态一致性检查出错:', error);
    results.failed++;
  }
}

// 处理需要恢复的任务
async function processRecoveryTasks(results, pendingCounts) {
  const batchSize = pendingCounts ? pendingCounts.batchSizes.recovery : 10;
  
  // 查找标记为需要恢复的错误记录
  const recoveryTasks = await db.collection('system_errors')
    .where({
      needRecovery: true,
      context: 'recovery_needed'
    })
    .limit(batchSize)
    .get();
  
  for (const task of recoveryTasks.data) {
    try {
      const { refundId, orderId } = task.data;
      if (!refundId || !orderId) continue;
      
      // 查询退款记录
      const refundRecord = await db.collection('refunds')
        .where({ refundId })
        .get();
        
      if (refundRecord.data && refundRecord.data.length > 0) {
        const refund = refundRecord.data[0];
        
        // 查询微信退款状态
        const wxRefundStatus = await queryWxRefundStatus(refundId);
        
        if (wxRefundStatus.success) {
          if (wxRefundStatus.status === 'SUCCESS') {
            await syncRefundSuccess(refund);
            results.recovered++;
          } else if (wxRefundStatus.status === 'FAIL') {
            await syncRefundFailed(refund);
            results.recovered++;
          }
        }
      }
      
      // 标记任务已处理
      await db.collection('system_errors').doc(task._id).update({
        data: {
          needRecovery: false,
          recoveredAt: db.serverDate()
        }
      });
    } catch (error) {
      console.error('处理恢复任务出错:', error);
      results.failed++;
    }
  }
}

// 查询微信退款状态
async function queryWxRefundStatus(refundId) {
  try {
    const result = await cloud.callFunction({
      name: 'refund',
      data: {
        type: 'queryRefund',
        refundId
      }
    });
    
    if (result.result && result.result.success) {
      return {
        success: true,
        status: result.result.data.status || 'PROCESSING'
      };
    }
    
    return {
      success: false,
      error: result.result?.error || '查询失败'
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || '查询异常'
    };
  }
}

// 同步退款成功状态
async function syncRefundSuccess(refund) {
  const transaction = await db.startTransaction();
  try {
    // 更新订单状态
    await transaction.collection('orders').doc(refund.orderId).update({
      data: {
        status: 'cancelled',
        cancelTime: db.serverDate(),
        updateTime: db.serverDate()
      }
    });
    
    // 更新退款记录
    await transaction.collection('refunds').doc(refund._id).update({
      data: {
        status: REFUND_STATUS.SUCCESS,
        completeTime: db.serverDate(),
        updateTime: db.serverDate(),
        recoveredBy: 'system_recovery'
      }
    });
    
    // 添加订单历史
    await transaction.collection('order_history').add({
      data: {
        orderId: refund.orderId,
        fromStatus: 'refunding',
        toStatus: 'cancelled',
        operator: '系统',
        operatorId: 'recovery_system',
        statusText: '已中止(状态恢复)',
        remark: `系统恢复: 退款成功 [退款单号:${refund.refundId}]`,
        userFriendlyMessage: '退款成功',
        operationResult: 1,
        createTime: db.serverDate()
      }
    });
    
    await transaction.commit();
    return true;
  } catch (error) {
    await transaction.rollback();
    await logRecoveryError('同步退款成功状态失败', refund, error);
    throw error;
  }
}

// 同步退款失败状态
async function syncRefundFailed(refund) {
  const transaction = await db.startTransaction();
  try {
    // 更新退款记录
    await transaction.collection('refunds').doc(refund._id).update({
      data: {
        status: REFUND_STATUS.FAILED,
        completeTime: db.serverDate(),
        updateTime: db.serverDate(),
        recoveredBy: 'system_recovery'
      }
    });
    
    // 添加订单历史
    await transaction.collection('order_history').add({
      data: {
        orderId: refund.orderId,
        fromStatus: 'refunding',
        toStatus: 'paid', // 退款失败，状态恢复到已支付
        operator: '系统',
        operatorId: 'recovery_system',
        statusText: '退款失败(状态恢复)',
        remark: `系统恢复: 退款失败 [退款单号:${refund.refundId}]`,
        userFriendlyMessage: '退款处理失败，请联系客服',
        operationResult: 0,
        createTime: db.serverDate()
      }
    });
    
    await transaction.commit();
    return true;
  } catch (error) {
    await transaction.rollback();
    await logRecoveryError('同步退款失败状态失败', refund, error);
    throw error;
  }
}

// 同步订单状态
async function syncOrderStatus(refund, order) {
  const transaction = await db.startTransaction();
  try {
    // 更新订单状态
    await transaction.collection('orders').doc(order._id).update({
      data: {
        status: 'cancelled',
        cancelTime: db.serverDate(),
        updateTime: db.serverDate()
      }
    });
    
    // 添加订单历史
    await transaction.collection('order_history').add({
      data: {
        orderId: order._id,
        fromStatus: order.status,
        toStatus: 'cancelled',
        operator: '系统',
        operatorId: 'recovery_system',
        statusText: '已中止(状态一致性恢复)',
        remark: `系统恢复: 退款与订单状态不一致 [退款单号:${refund.refundId}]`,
        userFriendlyMessage: '订单已退款',
        operationResult: 1,
        createTime: db.serverDate()
      }
    });
    
    await transaction.commit();
    return true;
  } catch (error) {
    await transaction.rollback();
    await logRecoveryError('同步订单状态失败', refund, error);
    throw error;
  }
}

// 同步退款状态
async function syncRefundStatus(refund) {
  const transaction = await db.startTransaction();
  try {
    // 更新退款记录
    await transaction.collection('refunds').doc(refund._id).update({
      data: {
        status: REFUND_STATUS.SUCCESS,
        completeTime: db.serverDate(),
        updateTime: db.serverDate(),
        recoveredBy: 'system_recovery'
      }
    });
    
    await transaction.commit();
    return true;
  } catch (error) {
    await transaction.rollback();
    await logRecoveryError('同步退款状态失败', refund, error);
    throw error;
  }
}

// 记录恢复错误
async function logRecoveryError(context, refund, error) {
  try {
    await db.collection('system_errors').add({
      data: {
        source: 'refundRecovery',
        context,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : null,
        data: {
          refundId: refund.refundId,
          orderId: refund.orderId
        },
        timestamp: db.serverDate()
      }
    });
  } catch (logError) {
    console.error('记录恢复错误失败:', logError);
  }
} 