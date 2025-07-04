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
    // 新增分类相关数据
    categorizedItems: {},
    categories: [],
    categorySelectStatus: {},
    selectAll: false,
    totalItems: 0,
    isLoggedIn: false,
    isLoading: false,
    navigating: false,
    totalFee: 0, // 🔧 使用分单位
    formattedTotalPrice: '0.00', // 🔧 格式化后的显示价格
    allSelected: false,
    hasSelectedItems: false,
    showEmpty: false
  },
  
  onLoad: function() {
    // 检查用户登录状态
    this.checkLoginStatus();
  },
  
  onShow: function() {
    // 每次显示页面时检查登录状态并获取购物车数据
    this.checkLoginStatus();
    if (this.data.isLoggedIn) {
      this.getCartData();
    }
  },
  
  // 检查用户登录状态
  checkLoginStatus: function() {
    this.$checkLoginStatus((isLoggedIn, userData) => {
      if (isLoggedIn) {
        this.getCartData();
      }
    }, '购物车');
  },
  
  // 获取购物车数据
  getCartData: function() {
    this.setData({ isLoading: true });
    
    this.$callCloudFunction('cart', {
      type: 'getCartItems'
    }, {
      loadingText: '加载中...',
      errorTitle: '获取购物车失败',
      pageName: '购物车'
    }).then(result => {
      this.setData({ isLoading: false });
      
      console.log('原始购物车数据:', result.data);
      
      // 使用公共方法清理和验证购物车数据
      const cartItems = dataUtils.cleanCartItems(result.data.items || []);
      
      // 🔧 使用统一的价格格式化方法
      const formattedCartItems = PriceUtils.formatItemsPriceDisplay(
        cartItems, 
        'price', 
        'formattedPrice', 
        '购物车商品'
      );
      
      console.log('清理后的购物车数据:', formattedCartItems);

      // 按类别分组商品
      this.categorizCartItems(formattedCartItems);
      
      this.setData({
        cartItems: formattedCartItems
      }, () => {
        this.calculateTotal();
      });
    }).catch(err => {
      this.setData({ isLoading: false });
      console.error('获取购物车失败:', err);
    });
  },

  // 按类别分组购物车商品
  categorizCartItems: function(cartItems) {
    const categorizedItems = {};
    const categories = [];
    const categorySelectStatus = {};
    
    // 为未分类的商品设置默认分类
    cartItems.forEach(item => {
      if (!item.categoryId) {
        item.categoryId = 'uncategorized';
        item.categoryName = '未分类';
      }
      
      // 按分类分组
      if (!categorizedItems[item.categoryId]) {
        categorizedItems[item.categoryId] = {
          id: item.categoryId,
          name: item.categoryName,
          items: []
        };
        categories.push({
          id: item.categoryId,
          name: item.categoryName
        });
        categorySelectStatus[item.categoryId] = true; // 默认全选
      }
      
      // 添加到分类时保持原有的选中状态
      categorizedItems[item.categoryId].items.push({...item});
    });
    
    // 检查每个分类的全选状态
    categories.forEach(category => {
      const categoryItems = categorizedItems[category.id].items;
      categorySelectStatus[category.id] = categoryItems.every(item => item.selected);
    });
    
    this.setData({
      categorizedItems,
      categories,
      categorySelectStatus
    });
  },
  
  // 🔧 计算总价和总数量（精度安全版）
  calculateTotal: function() {
    console.log('计算总价，购物车数据:', this.data.cartItems);
    
    // 🔧 使用精度安全的价格计算
    const { totalFee, totalItems } = PriceUtils.calculateCartTotal(this.data.cartItems, true);
    
    console.log('计算结果:', { totalFee, totalItems, displayPrice: PriceUtils.centToYuan(totalFee) });
    
    // 检查是否全选
    const allSelected = this.data.cartItems.length > 0 && 
                       this.data.cartItems.every(item => item.selected);
    
    // 检查是否有选中的商品
    const hasSelectedItems = this.data.cartItems.some(item => item.selected);
    
    this.setData({
      totalFee: totalFee,
      formattedTotalPrice: PriceUtils.centToYuan(totalFee),
      totalItems: totalItems,
      selectAll: allSelected,
      hasSelectedItems: hasSelectedItems
    });
  },
  
  // 切换商品选中状态
  toggleSelect: function(e) {
    const { id } = e.currentTarget.dataset;
    
    // 先找到当前商品并获取新的选中状态
    let newSelected = false;
    const cartItems = this.data.cartItems.map(item => {
      if (item._id === id) {
        newSelected = !item.selected;
        return {
          ...item,
          selected: newSelected
        };
      }
      return item;
    });
    
    // 同步更新categorizedItems中的商品选中状态
    const categorizedItems = {...this.data.categorizedItems};
    for (const categoryId in categorizedItems) {
      categorizedItems[categoryId].items = categorizedItems[categoryId].items.map(item => {
        if (item._id === id) {
          return {
            ...item,
            selected: newSelected
          };
        }
        return item;
      });
    }
    
    this.setData({ 
      cartItems,
      categorizedItems
    }, () => {
      // 更新分类状态
      this.updateCategorySelectStatus();
      this.calculateTotal();
    });
    
    // 更新数据库中的选中状态（使用新的选中状态）
    this.$callCloudFunction('cart', {
      type: 'updateCartItem',
      cartId: id,
      selected: newSelected
    }, {
      showLoading: false,
      showErrorToast: false
    }).catch(err => {
      console.error('更新购物车失败:', err);
    });
  },

  // 更新分类的选中状态
  updateCategorySelectStatus: function() {
    const { cartItems, categorizedItems, categorySelectStatus } = this.data;
    const categories = this.data.categories;
    
    // 更新每个分类的选中状态
    categories.forEach(category => {
      const categoryItems = categorizedItems[category.id].items;
      categorySelectStatus[category.id] = categoryItems.every(item => {
        const cartItem = cartItems.find(cart => cart._id === item._id);
        return cartItem && cartItem.selected;
      });
    });
    
    this.setData({ categorySelectStatus });
  },
  
  // 切换分类全选状态
  toggleCategorySelect: function(e) {
    const { categoryId } = e.currentTarget.dataset;
    const newSelected = !this.data.categorySelectStatus[categoryId];
    
    // 更新UI状态，提前显示效果
    this.setData({
      [`categorySelectStatus.${categoryId}`]: newSelected
    });
    
    // 找到该分类下的所有商品并更新本地数据的选中状态
    const categoryItems = this.data.categorizedItems[categoryId].items;
    const cartItems = this.data.cartItems.map(item => {
      if (categoryItems.some(catItem => catItem._id === item._id)) {
        return {
          ...item,
          selected: newSelected
        };
      }
      return item;
    });
    
    // 更新categorizedItems中商品的选中状态
    const categorizedItems = {...this.data.categorizedItems};
    categorizedItems[categoryId].items = categorizedItems[categoryId].items.map(item => {
      return {
        ...item,
        selected: newSelected
      };
    });
    
    this.setData({ 
      cartItems,
      categorizedItems
    }, () => {
      this.calculateTotal();
    });
    
    // 使用新的批量更新云函数
    this.$callCloudFunction('cart', {
      type: 'updateCategorySelect',
      categoryId: categoryId,
      selected: newSelected
    }, {
      showLoading: false,
      showErrorToast: true,
      errorTitle: '更新分类商品失败',
      pageName: '购物车分类操作'
    }).catch(err => {
      console.error('更新分类选中状态失败:', err);
      // 更新失败时回滚本地数据
      this.getCartData();
    });
  },
  
  // 切换全选状态
  toggleSelectAll: function() {
    const selectAll = !this.data.selectAll;
    
    // 更新UI状态，提前显示效果
    const cartItems = this.data.cartItems.map(item => ({
      ...item,
      selected: selectAll
    }));
    
    // 更新所有分类的选择状态
    const categorySelectStatus = {};
    this.data.categories.forEach(category => {
      categorySelectStatus[category.id] = selectAll;
    });
    
    // 同步更新categorizedItems中所有商品的选中状态
    const categorizedItems = {...this.data.categorizedItems};
    for (const categoryId in categorizedItems) {
      categorizedItems[categoryId].items = categorizedItems[categoryId].items.map(item => ({
        ...item,
        selected: selectAll
      }));
    }
    
    this.setData({
      selectAll,
      cartItems,
      categorySelectStatus,
      categorizedItems
    }, () => {
      this.calculateTotal();
    });
    
    // 使用新的全选/取消全选云函数
    this.$callCloudFunction('cart', {
      type: 'updateSelectAll',
      selected: selectAll
    }, {
      showLoading: false,
      showErrorToast: true,
      errorTitle: selectAll ? '全选失败' : '取消全选失败',
      pageName: '购物车全选操作'
    }).catch(err => {
      console.error('更新全选状态失败:', err);
      // 更新失败时回滚本地数据
      this.getCartData();
    });
  },
  
  // 增加商品数量
  increaseQuantity: function(e) {
    const { id } = e.currentTarget.dataset;
    
    // 先找到对应的商品
    const targetItem = this.data.cartItems.find(item => item._id === id);
    if (!targetItem) return;
    
    const newQuantity = targetItem.quantity + 1;
    
    const cartItems = this.data.cartItems.map(item => {
      if (item._id === id) {
        return {
          ...item,
          quantity: newQuantity
        };
      }
      return item;
    });
    
    // 直接调用categorizCartItems以更新分类数据
    this.setData({ cartItems }, () => {
      this.categorizCartItems(this.data.cartItems);
      this.calculateTotal();
    });
    
    // 更新数据库中的数量（使用正确的新数量）
    this.$callCloudFunction('cart', {
      type: 'updateCartItem',
      cartId: id,
      quantity: newQuantity
    }, {
      showLoading: false,
      showErrorToast: false
    }).catch(err => {
      console.error('更新购物车失败:', err);
      // 更新失败时回滚本地数据
      this.getCartData();
    });
  },
  
  // 减少商品数量
  decreaseQuantity: function(e) {
    const { id } = e.currentTarget.dataset;
    
    // 先找到对应的商品
    const targetItem = this.data.cartItems.find(item => item._id === id);
    if (!targetItem || targetItem.quantity <= 1) return;
    
    const newQuantity = targetItem.quantity - 1;
    
    const cartItems = this.data.cartItems.map(item => {
      if (item._id === id) {
        return {
          ...item,
          quantity: newQuantity
        };
      }
      return item;
    });
    
    // 直接调用categorizCartItems以更新分类数据
    this.setData({ cartItems }, () => {
      this.categorizCartItems(this.data.cartItems);
      this.calculateTotal();
    });
    
    // 更新数据库中的数量（使用正确的新数量）
    this.$callCloudFunction('cart', {
      type: 'updateCartItem',
      cartId: id,
      quantity: newQuantity
    }, {
      showLoading: false,
      showErrorToast: false
    }).catch(err => {
      console.error('更新购物车失败:', err);
      // 更新失败时回滚本地数据
      this.getCartData();
    });
  },
  
  // 删除购物车商品
  removeCartItem: function(e) {
    const { id } = e.currentTarget.dataset;
    
    this.$showConfirm(
      '确认删除',
      '确定要从购物车中删除这件商品吗？',
      () => {
        this.$callCloudFunction('cart', {
          type: 'removeCartItem',
          cartId: id
        }, {
          loadingText: '删除中...',
          errorTitle: '删除失败',
          pageName: '购物车删除'
        }).then(() => {
          this.$showSuccess('删除成功');
          this.getCartData();
        }).catch(err => {
          console.error('删除购物车商品失败:', err);
        });
      }
    );
  },
  
  // 批量删除选中商品
  removeSelectedItems: function() {
    const selectedItems = this.data.cartItems.filter(item => item.selected);
    if (selectedItems.length === 0) {
      this.$showToast('请先选择要删除的商品');
      return;
    }
    
    const cartIds = selectedItems.map(item => item._id);
    
    this.$showConfirm(
      '确认删除',
      `确定要删除选中的 ${selectedItems.length} 件商品吗？`,
      () => {
        this.$callCloudFunction('cart', {
          type: 'removeMultipleItems',
          cartIds: cartIds
        }, {
          loadingText: '删除中...',
          errorTitle: '批量删除失败',
          pageName: '购物车批量删除'
        }).then(() => {
          this.$showSuccess('删除成功');
          this.getCartData();
        }).catch(err => {
          console.error('批量删除购物车商品失败:', err);
        });
      }
    );
  },
  
  // 清空购物车
  clearCart: function() {
    if (this.data.cartItems.length === 0) {
      this.$showToast('购物车已经是空的');
      return;
    }
    
    this.$showConfirm(
      '确认清空',
      '确定要清空购物车吗？此操作不可恢复。',
      () => {
        this.$callCloudFunction('cart', {
          type: 'clearCart'
        }, {
          loadingText: '清空中...',
          errorTitle: '清空失败',
          pageName: '购物车清空'
        }).then(() => {
          this.$showSuccess('购物车已清空');
          this.getCartData();
        }).catch(err => {
          console.error('清空购物车失败:', err);
        });
      }
    );
  },
  
  // 结算
  checkout: function() {
    if (!this.data.hasSelectedItems) {
      this.$showToast('请先选择商品');
      return;
    }
    
    // 判断是否正在跳转
    if (this.data.navigating) {
      return;
    }
    
    this.setData({ navigating: true });
    
    // 获取选中的商品
    const selectedItems = this.data.cartItems.filter(item => item.selected);
    
    // 准备传递到结算页面的数据
    const checkoutData = {
      items: selectedItems,
      source: 'cart' // 标识数据来源为购物车
    };
    
    console.log('准备传递到结算页面的数据:', checkoutData);
    
    // 跳转到结算页面
    wx.navigateTo({
      url: '/pages/checkout/checkout',
      success: (res) => {
        this.setData({ navigating: false });
        // 通过eventChannel传递数据
        res.eventChannel.emit('checkoutData', checkoutData);
      },
      fail: (err) => {
        console.error('跳转结算页面失败:', err);
        this.setData({ navigating: false });
        this.$showToast('跳转失败');
      }
    });
  },

  // 查看商品详情
  viewProductDetail: function(e) {
    const { id } = e.currentTarget.dataset;
    if (!id) return;
    
    wx.navigateTo({
      url: `/pages/product-detail/product-detail?id=${id}`
    });
  },
  
  // 继续购物
  continueShopping: function() {
    wx.switchTab({
      url: '/pages/index/index'
    });
  },
  
  // 格式化价格显示
  formatPrice: function(price) {
    return priceUtils.formatPrice(price);
  }
};

// 使用基础页面类创建页面
Page(basePage.createPage('pages/cart/cart', pageConfig)); 