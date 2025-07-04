// 引入基础页面类
const basePage = require('../../utils/basePage');
// 引入价格工具类
const PriceUtils = require('../../utils/priceUtils');

// 创建页面配置
const pageConfig = {
  data: {
    categories: [],
    currentCategory: 0,
    allProducts: [],
    currentProducts: [],
    cartItemCount: 0,
    isLoggedIn: false,
    // 购物车按钮位置（调整为右下角偏上）
    cartButtonPosition: {
      x: 750 - 120 - 30, // 右侧位置（屏幕宽度 - 按钮宽度 - 边距）
      y: 240             // 距离底部更高的位置
    },
    // 分页相关
    currentPage: 1,
    pageSize: 10,
    totalPages: 0,
    hasMore: true,
    isLoading: false
  },

  onLoad: function(options) {
    // 延迟加载数据，避免阻塞页面初始化
    setTimeout(() => {
      // 串行加载，避免并发压力
      this.loadCategories();
      // 登录检查延迟更久，优先级较低
      setTimeout(() => {
        this.checkLoginStatus();
      }, 200);
    }, 100);
  },
  
  onShow: function() {
    // 每次显示页面时刷新商品数据和购物车数量
    this.loadProducts()
    if (this.data.isLoggedIn) {
      this.getCartItemCount()
    }
  },
  
  // 检查用户登录状态
  checkLoginStatus: function() {
    this.$checkLoginStatus((isLoggedIn, userData) => {
      if (isLoggedIn) {
        this.getCartItemCount();
      }
    }, '首页');
  },
  
  // 获取购物车商品数量
  getCartItemCount: function() {
    this.$callCloudFunction('cart', {
      type: 'getCartItems'
    }, {
      loadingText: '加载购物车...',
      errorTitle: '获取购物车失败',
      pageName: '首页',
      showLoading: false
    }).then(result => {
      // 统计不同商品的数量，而不是总数量
      const uniqueItemCount = result.data ? result.data.items.length : 0;
      
      this.setData({
        cartItemCount: uniqueItemCount
      });
    }).catch(err => {
      console.error('获取购物车数量失败:', err);
    });
  },
  
  // 跳转到购物车页面
  navigateToCart: function() {
    try {
      if (!this.data.isLoggedIn) {
        wx.showModal({
          title: '提示',
          content: '请先登录再查看购物车',
          success(res) {
            if (res.confirm) {
              wx.switchTab({
                url: '/pages/profile/profile'
              });
            }
          }
        });
        return;
      }
      
      console.log('正在跳转到购物车页面...');
      wx.navigateTo({
        url: '/pages/cart/cart',
        success: function() {
          console.log('跳转到购物车页面成功');
        },
        fail: function(err) {
          console.error('跳转到购物车页面失败:', err);
          wx.showToast({
            title: '跳转失败',
            icon: 'none'
          });
        }
      });
    } catch (error) {
      console.error('navigateToCart函数执行错误:', error);
      wx.showToast({
        title: '操作失败',
        icon: 'none'
      });
    }
  },
  
  // 加载分类
  loadCategories: function() {
    this.$callCloudFunction('product', {
      type: 'getCategories',
      page: 1,
      pageSize: 50
    }, {
      loadingText: '加载分类...',
      errorTitle: '获取分类失败',
      pageName: '首页',
      showLoading: false
    }).then(result => {
      const { list } = result.data;
      
      this.setData({ 
        categories: list,
        currentCategory: 0
      }, () => {
        // 分类加载完成后再加载商品
        this.loadProducts(true);
      });
    }).catch(err => {
      console.error('获取分类失败:', err);
      this.$showError('获取分类失败');
      // 即使分类加载失败，也尝试加载商品
      this.loadProducts(true);
    });
  },

  // 下拉刷新
  onPullDownRefresh: function() {
    this.refreshProducts();
  },
  
  // 上拉加载更多
  onReachBottom: function() {
    this.loadMoreProducts();
  },
  
  // 刷新商品列表（重置到第一页）
  refreshProducts: function() {
    this.setData({
      currentPage: 1,
      allProducts: [],
      currentProducts: [],
      hasMore: true
    });
    this.loadProducts(true);
  },
  
  // 加载更多商品
  loadMoreProducts: function() {
    if (!this.data.hasMore || this.data.isLoading) {
      return;
    }
    
    this.setData({
      currentPage: this.data.currentPage + 1
    });
    this.loadProducts(false);
  },

  // 加载商品
  loadProducts: function(isRefresh = false) {
    if (this.data.isLoading) return;
    
    this.setData({ isLoading: true });
    
    // 构建查询参数
    const params = {
      type: 'getProducts',
      page: this.data.currentPage,
      pageSize: this.data.pageSize,
      isOnSale: true // 只获取在售商品
    };
    
    // 如果有分类筛选，添加分类ID
    if (this.data.currentCategory !== 0 && this.data.categories && this.data.categories.length > 0) {
      params.categoryId = this.data.categories[this.data.currentCategory]._id;
    }
    
    this.$callCloudFunction('product', params, {
      loadingText: isRefresh ? '刷新中...' : '加载中...',
      errorTitle: '获取商品失败', 
      pageName: '首页',
      showLoading: isRefresh // 仅在刷新时显示loading
    }).then(result => {
      const { list, pagination } = result.data;
      
      // 处理商品数据，添加数量和格式化价格
      const products = list.map(item => ({
        ...item,
        quantity: 1,
        // 添加格式化价格，确保price字段是以分为单位的整数
        formattedPrice: PriceUtils.centToYuan(item.price)
      }));
      
      // 更新商品列表
      let newAllProducts;
      if (isRefresh || this.data.currentPage === 1) {
        // 刷新或第一页，替换数据
        newAllProducts = products;
      } else {
        // 追加数据
        newAllProducts = [...this.data.allProducts, ...products];
      }
      
      // 过滤当前分类的商品
      const newCurrentProducts = this.filterProductsByCategory(newAllProducts, this.data.currentCategory);
      
      this.setData({ 
        allProducts: newAllProducts,
        currentProducts: newCurrentProducts,
        totalPages: pagination.totalPages,
        hasMore: pagination.current < pagination.totalPages,
        isLoading: false
      });
      
      // 停止下拉刷新
      if (wx.stopPullDownRefresh) {
        wx.stopPullDownRefresh();
      }
    }).catch(err => {
      console.error('获取商品失败:', err);
      this.setData({
        isLoading: false
      });
      
      this.$showError('获取商品失败');
      
      // 停止下拉刷新
      if (wx.stopPullDownRefresh) {
        wx.stopPullDownRefresh();
      }
    });
  },

  switchCategory: function(e) {
    const index = e.currentTarget.dataset.index
    
    // 切换分类时重置分页状态
    this.setData({
      currentCategory: index,
      currentPage: 1,
      hasMore: true
    });
    
    // 重新加载商品
    this.loadProducts(true);
  },

  filterProductsByCategory: function(products, categoryIndex) {
    // 安全检查：确保categories数组存在且指定索引的分类存在
    if (!this.data.categories || !this.data.categories[categoryIndex]) {
      console.log('分类数据未就绪或索引无效，返回所有商品');
      return products; // 如果分类数据未就绪，返回所有商品
    }
    
    // 使用categoryId字段与分类_id匹配
    return products.filter(product => product.categoryId === this.data.categories[categoryIndex]._id);
  },

  // 增加商品数量
  increaseQuantity: function(e) {
    const { id } = e.currentTarget.dataset;
    
    // 更新全部商品数据
    const allProducts = this.data.allProducts.map(item => {
      if (item._id === id) {
        return { ...item, quantity: item.quantity + 1 }
      }
      return item
    });
    
    // 更新当前显示的商品数据
    const currentProducts = this.data.currentProducts.map(item => {
      if (item._id === id) {
        return { ...item, quantity: item.quantity + 1 }
      }
      return item
    });
    
    this.setData({ 
      allProducts,
      currentProducts
    });
  },
  
  // 减少商品数量
  decreaseQuantity: function(e) {
    const { id } = e.currentTarget.dataset;
    
    // 更新全部商品数据
    const allProducts = this.data.allProducts.map(item => {
      if (item._id === id && item.quantity > 1) {
        return { ...item, quantity: item.quantity - 1 }
      }
      return item
    });
    
    // 更新当前显示的商品数据
    const currentProducts = this.data.currentProducts.map(item => {
      if (item._id === id && item.quantity > 1) {
        return { ...item, quantity: item.quantity - 1 }
      }
      return item
    });
    
    this.setData({ 
      allProducts,
      currentProducts
    });
  },
  
  // 加入购物车
  addToCart: function(e) {
    const { id } = e.currentTarget.dataset;
    const product = this.data.currentProducts.find(item => item._id === id);
    
    // 检查登录状态并添加到购物车
    this.$checkLoginStatus((isLoggedIn, userData) => {
      if (!isLoggedIn) {
        this.$showConfirm('提示', '请先登录再操作', () => {
          wx.switchTab({
            url: '/pages/profile/profile'
          });
        });
        return;
      }
      
      // 已登录，添加到购物车
      this.$callCloudFunction('cart', {
        type: 'addToCart',
        productId: id,
        quantity: product.quantity
      }, {
        loadingText: '添加中...',
        errorTitle: '添加购物车失败',
        pageName: '首页'
      }).then(result => {
        this.$showSuccess('添加成功');
        // 刷新购物车数量
        this.getCartItemCount();
      }).catch(err => {
        console.error('添加到购物车失败:', err);
      });
    }, '首页');
  },
  
  // 立即购买
  onBuyNow: function(e) {
    const { id } = e.currentTarget.dataset;
    const product = this.data.currentProducts.find(item => item._id === id);
    
    // 检查登录状态
    this.$checkLoginStatus((isLoggedIn, userData) => {
      if (!isLoggedIn) {
        this.$showConfirm('需要登录', '购买商品需要先登录，是否前往登录？', () => {
          wx.switchTab({
            url: '/pages/profile/profile'
          });
        });
        return;
      }
      
      // 已登录，跳转到结算页面
      const checkoutData = {
        items: [{
          _id: product._id,
          productId: product._id,
          productName: product.name,
          imageURL: product.imageURL || '/images/default-product.png',
          price: product.price, // 确保这里的price字段是以分为单位的整数
          quantity: product.quantity,
          selected: true,
          formattedPrice: PriceUtils.centToYuan(product.price) // 添加格式化价格显示
        }],
        source: 'buyNow' // 标识数据来源
      };
      
      // 跳转到结算页面
      wx.navigateTo({
        url: '/pages/checkout/checkout',
        success: function (res) {
          // 通过eventChannel传递数据
          res.eventChannel.emit('checkoutData', checkoutData);
        },
        fail: function() {
          wx.showToast({
            title: '跳转失败',
            icon: 'none'
          });
        }
      });
    }, '首页');
  },
  
  // 购物车拖动开始
  onCartTouchStart: function(e) {
    this.startX = e.touches[0].clientX;
    this.startY = e.touches[0].clientY;
    this.btnStartX = this.data.cartButtonPosition.x;
    this.btnStartY = this.data.cartButtonPosition.y;
    this.touchStartTime = Date.now();
    this.hasMoved = false;
  },
  
  // 购物车拖动中
  onCartTouchMove: function(e) {
    this.hasMoved = true;
    // 获取手指移动的距离
    const moveX = e.touches[0].clientX - this.startX;
    const moveY = e.touches[0].clientY - this.startY;
    
    // 如果移动很小，可能是点击，不处理拖动
    if (Math.abs(moveX) < 5 && Math.abs(moveY) < 5) {
      return;
    }
    
    // 计算新的位置（以rpx为单位）
    const deviceWidth = wx.getSystemInfoSync().windowWidth;
    const deviceHeight = wx.getSystemInfoSync().windowHeight;
    
    // 转换像素到rpx (750rpx = 设计稿宽度)
    const rpxRatio = 750 / deviceWidth;
    
    // 只允许垂直方向拖动，保持X轴位置不变
    const newY = this.btnStartY + moveY * rpxRatio;
    
    // 限制垂直范围
    const btnSize = 120; // 按钮尺寸(rpx)
    const minY = 120; // 距离顶部最小距离
    const maxY = deviceHeight * rpxRatio - btnSize - 30; // 距离底部最小距离
    
    const limitedY = Math.max(minY, Math.min(newY, maxY));
    
    // 更新按钮位置
    this.setData({
      cartButtonPosition: {
        x: 750 - 120 - 30, // 保持X轴位置不变
        y: limitedY
      }
    });
  },
  
  // 拖动结束，添加吸附效果
  onCartTouchEnd: function(e) {
    // 如果是短时间触摸且没有明显移动，认为是点击
    const touchEndTime = Date.now();
    const touchDuration = touchEndTime - this.touchStartTime;
    
    if (touchDuration < 200 && !this.hasMoved) {
      // 触发点击购物车事件
      this.navigateToCart();
      return;
    }
    
    // 拖动结束后，恢复到固定位置
    this.setData({
      cartButtonPosition: {
        x: 750 - 120 - 30, // 右侧位置
        y: 240             // 距离底部更高的位置
      }
    });
  },

  // 页面初次渲染完成后确保数据加载
  onReady: function() {
    // 如果categories还未加载，确保加载
    if (!this.data.categories || this.data.categories.length === 0) {
      this.loadCategories();
    }
  },

  // 阻止事件冒泡
  stopPropagation: function(e) {
    // 阻止点击事件冒泡
    return;
  },
  
  // 跳转到商品详情页
  navigateToProduct: function(e) {
    const productId = e.currentTarget.dataset.id;
    if (!productId) return;
    
    wx.navigateTo({
      url: `/pages/product/product?id=${productId}`,
      fail: (err) => {
        console.error('跳转到商品详情页失败:', err);
        wx.showToast({
          title: '跳转失败',
          icon: 'none'
        });
      }
    });
  },

};

// 使用基础页面类创建页面
Page(basePage.createPage('pages/index/index', pageConfig)); 