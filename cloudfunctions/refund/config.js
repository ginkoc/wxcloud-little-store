/**
 * refund 云函数配置
 */

const cloudConfig = {
  // 微信商户号配置
  sub_mch_id: '1900000110', // 这里需要替换为实际的子商户号
  envId: 'cloud1-6grvv2t6d0f32080', // 云开发环境ID
  refundCallbackFunction: 'refundCallback' // 退款回调云函数
};

module.exports = cloudConfig; 