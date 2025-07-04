/**
 * 应用配置文件
 * 这里可以配置店铺的基本信息，方便不同商家定制
 */

const appConfig = {
  // 店铺基本信息
  storeName: '我的小店',          // 店铺名称
  storeVersion: 'v1.0.0',        // 版本号
  storeSlogan: '优质商品，贴心服务', // 店铺标语
  
  // 联系信息
  servicePhone: '400-123-4567',   // 客服电话
  
  // 支付描述前缀（用于微信支付）
  paymentPrefix: '我的小店',
  
  // 页面标题配置
  pageTitles: {
    home: '首页',
    profile: '我的',
    cart: '购物车',
    orders: '我的订单',
    orderDetail: '订单详情',
    checkout: '结算',
    productManage: '商品管理',
    orderManage: '订单管理'
  },
  
  // 默认图片路径
  defaultImages: {
    avatar: '/images/default-avatar.png',
    product: '/images/default-product.png'
  },
  
  // 业务配置
  business: {
    maxCartItems: 99,              // 购物车最大商品数量
    orderTimeout: 30,              // 订单超时时间（分钟）
    maxProductStock: 9999          // 商品最大库存
  }
};

module.exports = appConfig; 