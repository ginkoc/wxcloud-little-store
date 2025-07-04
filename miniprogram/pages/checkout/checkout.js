// 引入基础页面类
const basePage = require('../../utils/basePage');
// 引入价格计算工具类
const priceUtils = require('../../utils/priceUtils');
// 引入数据处理工具类
const dataUtils = require('../../utils/dataUtils');
// 🆕 引入精度安全的价格工具类
const PriceUtils = require('../../utils/priceUtils');

// 创建页面配置
const pageConfig = {
  data: {
    cartItems: [],
    address: {
      contactName: '',
      contactPhone: '',
      province: '',
      city: '',
      district: '',
      street: '',
      detailAddress: ''
    },
    remark: '', // 订单备注信息
    region: ['', '', ''],
    totalFee: 0, // 🔧 使用分单位
    formattedTotalPrice: '0.00', // 🔧 格式化后的显示价格
    originalFee: 0, // 🔧 原价（分单位）
    formattedOriginalPrice: '0.00', // 🔧 格式化后的原价
    discountFee: 0, // 🔧 折扣（分单位）
    formattedDiscountAmount: '0.00', // 🔧 格式化后的折扣
    totalItems: 0,
    source: 'cart', // 来源：cart（购物车）或 product（商品详情）
    // 表单验证
    formErrors: {
      contactPhone: '',
      detailAddress: ''
    },
    isSubmitting: false,
    hasDefaultAddress: false // 是否有默认地址
  },
  
  onLoad: function(options) {
    console.log('结算页面加载');
    
    // 从上一页面通过eventChannel获取数据
    const eventChannel = this.getOpenerEventChannel();
    if (eventChannel) {
      eventChannel.on('checkoutData', (data) => {
        console.log('获取到商品数据:', data);
        
        // 🔧 使用统一的价格格式化方法
        const formattedItems = PriceUtils.formatItemsPriceDisplay(
          data.items || [], 
          'price', 
          'formattedPrice', 
          '结算商品'
        );
        
        this.setData({
          cartItems: formattedItems,
          source: data.source || 'cart' // 设置数据来源
        });
        this.calculatePrices();
        
        // 加载默认地址
        this.loadDefaultAddress();
      });
    } else {
      console.error('无法获取商品数据');
      wx.showToast({
        title: '数据获取失败',
        icon: 'none'
      });
      
      // 返回上一页
      setTimeout(() => {
        wx.navigateBack({
          fail: () => {
            wx.switchTab({
              url: '/pages/index/index'
            });
          }
        });
      }, 1500);
    }
  },
  
  onShow: function() {
    // 每次页面显示时检查是否有从地址选择页面带回的地址
    const pages = getCurrentPages();
    const currPage = pages[pages.length - 1];
    
    if (currPage.data.selectedAddress) {
      this.setData({
        address: currPage.data.selectedAddress,
        region: [
          currPage.data.selectedAddress.province || '',
          currPage.data.selectedAddress.city || '',
          currPage.data.selectedAddress.district || ''
        ],
        hasDefaultAddress: true
      });
      // 清除临时数据
      currPage.data.selectedAddress = null;
    }
  },
  
  // 加载默认地址
  loadDefaultAddress: function() {
    this.$callCloudFunction('address', {
      type: 'getDefaultAddress'
    }, {
      showLoading: false,
      showError: false,
      pageName: '加载默认地址'
    }).then(result => {
      console.log('获取默认地址结果:', result);
      if (!result.success 
        || !result.data 
        || result.data.defaultAddress === null
        || result.data.defaultAddress === undefined) {
        console.log('没有默认地址');
        return;
      }
      
      const defaultAddress = result.data.defaultAddress;
      console.log('使用默认地址:', defaultAddress);
      this.setData({
        address: defaultAddress,
        region: [
          defaultAddress.province || '',
          defaultAddress.city || '',
          defaultAddress.district || ''
        ],
        hasDefaultAddress: true
      });
    }).catch(err => {
      console.error('获取默认地址失败:', err);
    });
  },
  
  // 导航到地址选择页面
  navigateToAddressSelect: function() {
    wx.navigateTo({
      url: '/pages/address-list/address-list?select=true'
    });
  },
  
  // 🔧 计算价格（精度安全版）
  calculatePrices: function() {
    // 使用精度安全的价格计算
    const { totalFee, originalFee, discountFee, totalItems } = PriceUtils.calculateCheckoutTotal(this.data.cartItems);
    
    console.log('价格计算结果:', { totalFee, originalFee, discountFee, totalItems });
    
    this.setData({
      totalFee: totalFee,
      formattedTotalPrice: PriceUtils.centToYuan(totalFee),
      originalFee: originalFee,
      formattedOriginalPrice: PriceUtils.centToYuan(originalFee),
      discountFee: discountFee,
      formattedDiscountAmount: PriceUtils.centToYuan(discountFee),
      totalItems: totalItems
    });
  },
  
  // 输入处理
  onInput: function(e) {
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    
    this.setData({
      [`address.${field}`]: value,
      [`formErrors.${field}`]: '' // 清除错误提示
    });
  },
  
  // 🆕 详细地址输入
  inputDetailAddress: function(e) {
    this.setData({
      'address.detailAddress': e.detail.value,
      'formErrors.detailAddress': ''
    });
  },
  
  // 🆕 联系人姓名输入
  inputContactName: function(e) {
    this.setData({
      'address.contactName': e.detail.value,
      'formErrors.contactName': ''
    });
  },
  
  // 🆕 联系电话输入
  inputContactPhone: function(e) {
    this.setData({
      'address.contactPhone': e.detail.value,
      'formErrors.contactPhone': ''
    });
  },
  
  // 地区选择
  onRegionChange: function(e) {
    this.setData({
      region: e.detail.value
    });
  },
  
  // 🆕 地区选择（WXML中绑定的方法名）
  bindRegionChange: function(e) {
    this.setData({
      region: e.detail.value,
      'formErrors.region': '' // 清除错误提示
    });
  },
  
  // 表单验证
  validateForm: function() {
    const { address, cartItems } = this.data;
    const errors = {};
    
    // 验证地址信息
    if (!address || !address.contactName) {
      wx.showToast({
        title: '请选择收货地址',
        icon: 'none'
      });
      return false;
    }
    
    // 验证购物车
    if (!cartItems || cartItems.length === 0) {
      errors.cart = '购物车为空';
    }
    
    this.setData({
      formErrors: errors
    });
    
    return Object.keys(errors).length === 0;
  },
  
  // 提交订单
  submitOrder: function() {
    console.log('开始提交订单');
    
    // 验证表单
    if (!this.validateForm()) {
      return;
    }
    
    this.setData({ isSubmitting: true });
    wx.showLoading({ title: '提交订单中...' });
    
    const { address, cartItems, source, remark } = this.data;
    
    // 构建完整地址
    const fullAddress = `${address.province} ${address.city} ${address.district} ${address.street} ${address.detailAddress}`;
    
    // 调试购物车商品数据
    console.log('提交前商品数据:', cartItems);
    console.log('订单来源:', source);
    
    // 🆕 根据数据来源选择合适的云函数方法
    if (source === 'buyNow' && cartItems.length === 1) {
      // 单个商品购买，使用createOrder方法
      const item = cartItems[0];
      this.$callCloudFunction('order', {
        type: 'createOrder',
        productId: item.productId,
        quantity: item.quantity,
        address: fullAddress,
        contactName: address.contactName,
        contactPhone: address.contactPhone,
        remark: remark
      }, {
        showLoading: false,
        errorTitle: '下单失败',
        pageName: '下单'
      }).then(result => {
        const orderId = result.data.orderId;
        this.handleOrderSuccess(orderId);
      }).catch(err => {
        this.handleOrderError(err);
      });
    } else {
      // 多个商品或从购物车来的订单，使用createOrderFromCart方法
      const orderInfo = {
        address: fullAddress,
        contactName: address.contactName,
        contactPhone: address.contactPhone,
        remark: remark,
        // 只传递必需的字段：productId 和 quantity
        // 商品信息由云函数从数据库重新获取，确保数据准确性
        // 总价由云函数根据实时商品价格计算，确保价格准确性
        items: cartItems.map(item => {
          return {
            productId: item.productId,
            quantity: item.quantity
          };
        })
      };
      
      this.$callCloudFunction('order', {
        type: 'createOrderFromCart',
        orderInfo: orderInfo
      }, {
        showLoading: false,
        errorTitle: '下单失败',
        pageName: '下单'
      }).then(result => {
        const orderId = result.data.orderId;
        
        // 🆕 只有从购物车来的订单才需要清空购物车
        if (source === 'cart') {
          this.clearSelectedCartItems();
        }
        
        this.handleOrderSuccess(orderId);
      }).catch(err => {
        this.handleOrderError(err);
      });
    }
  },
  
  // 🆕 处理订单成功
  handleOrderSuccess: function(orderId) {
    wx.hideLoading();
    this.$showSuccess('下单成功');
    
    // 跳转到订单详情页
    this.$setTimeout(() => {
      wx.redirectTo({
        url: `/pages/order-detail/order-detail?orderId=${orderId}`
      });
    }, 1500);
  },
  
  // 🆕 处理订单失败
  handleOrderError: function(err) {
    wx.hideLoading();
    this.$showError('下单失败');
    console.error('下单失败:', err);
    this.setData({ isSubmitting: false });
  },
  
  // 清空已选择的购物车商品
  clearSelectedCartItems: function() {
    const selectedItemIds = this.data.cartItems.map(item => item._id);
    
    if (selectedItemIds.length === 0) {
      return;
    }
    
    this.$callCloudFunction('cart', {
      type: 'removeMultipleItems',
      cartIds: selectedItemIds
    }, {
      showLoading: false,
      showError: false
    }).catch(err => {
      console.error('清空购物车失败:', err);
    });
  },
  
  // 使用微信地址
  useWechatAddress: function() {
    wx.chooseAddress({
      success: (res) => {
        // 填充地址表单
        this.setData({
          'address.detailAddress': res.detailInfo,
          'address.contactName': res.userName,
          'address.contactPhone': res.telNumber,
          'address.street': res.streetName || '',
          region: [res.provinceName, res.cityName, res.countyName],
          hasDefaultAddress: true
        });
      }
    });
  },
  
  // 格式化价格显示
  formatPrice: function(price) {
    return priceUtils.formatPrice(price);
  },

  // 返回购物车
  goBack: function() {
    wx.navigateBack();
  },

  // 🆕 订单备注输入处理函数
  inputRemark: function(e) {
    this.setData({
      remark: e.detail.value // 更新订单备注
    });
  }
};

// 使用基础页面类创建页面
Page(basePage.createPage('pages/checkout/checkout', pageConfig)); 