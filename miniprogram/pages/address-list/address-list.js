// 引入基础页面类
const basePage = require('../../utils/basePage');
// 引入认证工具类
const auth = require('../../utils/auth');

// 创建页面配置
const pageConfig = {
  data: {
    addressList: [],
    isLoggedIn: false,
    loading: true,
    isEmpty: false
  },

  onLoad: function(options) {
    // 从本地存储恢复登录状态
    if (auth.isLoggedIn()) {
      this.setData({ isLoggedIn: true });
      this.loadAddressList();
    } else {
      // 检查用户登录状态
      this.$checkLoginStatus(this.handleLoginStatus, '地址管理');
    }
    
    // 记录是否从选择页面进入
    this.isFromSelect = options.select === 'true';
  },
  
  onShow: function() {
    // 每次显示页面时刷新地址列表
    if (this.data.isLoggedIn) {
      this.loadAddressList();
    }
  },
  
  // 处理登录状态变化
  handleLoginStatus: function(isLoggedIn, userData) {
    if (isLoggedIn) {
      this.setData({ isLoggedIn: true });
      this.loadAddressList();
    } else {
      this.setData({ 
        isLoggedIn: false, 
        addressList: [],
        loading: false,
        isEmpty: true
      });
    }
  },
  
  // 加载地址列表
  loadAddressList: function() {
    this.setData({ loading: true });
    
    this.$callCloudFunction('address', {
      type: 'getAddressList'
    }, {
      loadingText: '加载中...',
      errorTitle: '获取地址失败',
      pageName: '地址管理'
    }).then(result => {
      // 检查返回结果格式
      console.log('获取地址列表结果:', result);
      
      if (!result.success) {
        throw new Error(result.error || '获取地址列表失败');
      }
      
      // 根据云函数返回格式获取地址列表
      const addressList = result.data ? result.data : [];
      
      this.setData({
        addressList: addressList,
        loading: false,
        isEmpty: addressList.length === 0
      });
    }).catch(err => {
      console.error('获取地址列表失败:', err);
      this.setData({ 
        loading: false,
        isEmpty: true
      });
    });
  },
  
  // 新增地址
  addAddress: function() {
    wx.navigateTo({
      url: '/pages/address-edit/address-edit'
    });
  },
  
  // 编辑地址
  editAddress: function(e) {
    const addressId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/address-edit/address-edit?id=${addressId}`
    });
  },
  
  // 删除地址
  deleteAddress: function(e) {
    const addressId = e.currentTarget.dataset.id;
    
    this.$showConfirm('提示', '确定要删除该地址吗？', () => {
      this.$callCloudFunction('address', {
        type: 'deleteAddress',
        addressId: addressId
      }, {
        loadingText: '删除中...',
        errorTitle: '删除地址失败',
        pageName: '地址管理'
      }).then(result => {
        this.$showSuccess('地址已删除');
        // 刷新地址列表
        this.loadAddressList();
      }).catch(err => {
        console.error('删除地址失败:', err);
      });
    });
  },
  
  // 设为默认地址
  setAsDefault: function(e) {
    const addressId = e.currentTarget.dataset.id;
    
    this.$callCloudFunction('address', {
      type: 'setDefaultAddress',
      addressId: addressId
    }, {
      loadingText: '设置中...',
      errorTitle: '设置默认地址失败',
      pageName: '地址管理'
    }).then(result => {
      this.$showSuccess('已设为默认地址');
      // 刷新地址列表
      this.loadAddressList();
    }).catch(err => {
      console.error('设置默认地址失败:', err);
    });
  },
  
  // 选择地址并返回
  selectAddress: function(e) {
    if (!this.isFromSelect) return;
    
    const address = e.currentTarget.dataset.address;
    // 选择地址并返回
    const pages = getCurrentPages();
    const prevPage = pages[pages.length - 2];
    
    // 设置上一页的地址信息
    if (prevPage.route === 'pages/checkout/checkout') {
      // 返回到订单确认页面
      prevPage.setData({
        selectedAddress: address
      });
    } else {
      // 返回到其他页面
      prevPage.setData({
        'address.contactName': address.contactName,
        'address.contactPhone': address.contactPhone,
        'address.street': address.street || '',
        'address.detailAddress': address.detailAddress,
        region: [address.province, address.city, address.district]
      });
    }
    
    wx.navigateBack();
  }
};

// 使用基础页面类创建页面
Page(basePage.createPage('pages/address-list/address-list', pageConfig)); 