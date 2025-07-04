/**
 * 云函数配置文件
 * 与小程序端的配置保持同步
 */

const cloudConfig = {
  // 店铺基本信息
  storeName: '我的小店',          // 店铺名称
  
  // 支付描述前缀（用于微信支付）
  paymentPrefix: '我的小店',
  
  // 联系信息
  servicePhone: '400-123-4567',   // 客服电话
  
  //  微信支付统一配置
  wechatPay: {
    subMchId: '1900000109',        // 子商户号
    envId: 'cloud1-6grvv2t6d0f32080', // 云开发环境ID
    spbillCreateIp: '127.0.0.1',   // 客户端IP
    payCallbackFunction: 'payCallback',      // 支付回调云函数
  }
};

module.exports = cloudConfig; 