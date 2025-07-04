// 引入图片处理工具类
const imageUtils = require('../../utils/imageUtils');
// 引入基础页面类
const basePage = require('../../utils/basePage');
// 引入价格工具类
const PriceUtils = require('../../utils/priceUtils');

// 商品管理页面配置
const pageConfig = {
  data: {
    allProducts: [], // 所有商品
    currentProducts: [], // 当前分类的商品
    categories: [],
    currentCategory: 0,
    isAddingProduct: false,
    isEditingProduct: false,
    formData: {
      name: '',
      price: '',
      description: '',
      category: 0,
      stock: '',
      imageURL: ''
    },
    uploadProgress: 0,
    isUploading: false,
    uploadFailed: false,
    tempImagePath: '', // 用于保存临时图片路径，方便重试上传
    selectedCategoryName: '请选择分类',
    // 分页相关
    currentPage: 1,
    pageSize: 20,
    totalPages: 0,
    hasMore: true,
    isLoading: false
  },

  onLoad: function() {
    // 🔒 检查管理员权限
    this.$checkAdminPermission()
      .then(() => {
        // 初始化Canvas 2D上下文（不阻塞）
        this.initCanvas();
        
        // 延迟加载，避免阻塞页面初始化
        setTimeout(() => {
          this.loadCategories();
        }, 100);
      })
      .catch(() => {
        // 🔒 无权限，跳转回首页
        this.$showError('您没有管理员权限');
        setTimeout(() => {
          wx.switchTab({
            url: '/pages/index/index'
          });
        }, 1500);
      });
  },

  // 页面初次渲染完成后确保数据加载
  onReady: function() {
    // 如果categories还未加载，确保加载
    if (!this.data.categories || this.data.categories.length === 0) {
      this.loadCategories();
    }
  },

  // 初始化Canvas 2D上下文
  initCanvas: function() {
    // 等待页面渲染完成后再获取Canvas节点
    wx.nextTick(() => {
      const query = wx.createSelectorQuery();
      query.select('#imageCompressCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (res && res[0] && res[0].node) {
            console.log('Canvas 2D节点初始化成功');
          } else {
            console.error('Canvas 2D节点初始化失败，可能会影响图片压缩功能');
          }
        });
    });
  },

  onShow: function() {
    this.loadProducts();
  },
  
  onHide: function() {
    // 页面隐藏时清理一些可能的临时资源
    console.log('商品管理页面隐藏');
  },

  // 加载商品分类
  loadCategories: function() {
    this.$callCloudFunction('product', {
      type: 'getCategories',
      page: 1,
      pageSize: 50
    }, {
      loadingText: '加载分类...',
      errorTitle: '获取分类失败',
      pageName: '查看分类'
    }).then(result => {
      const { list } = result.data;
      
      console.log('获取到分类数据:', list);
      
      if (list && list.length > 0) {
        const defaultCategoryId = list[0]._id;
        const defaultCategoryName = list[0].name;
        console.log('设置默认分类ID:', defaultCategoryId);
        
        this.setData({ 
          categories: list,
          'formData.category': defaultCategoryId,
          currentCategory: defaultCategoryId,
          selectedCategoryName: defaultCategoryName
        });
      } else {
        // 如果没有分类数据，设置默认分类
        this.setData({
          categories: [{_id: '0', name: '默认分类'}],
          'formData.category': '0',
          currentCategory: '0',
          selectedCategoryName: '默认分类'
        });
      }
      // 加载分类后加载商品
      this.loadProducts(true);
    }).catch(err => {
      console.error('获取分类失败:', err);
      // 出错时也设置默认值
      this.setData({
        categories: [{_id: '0', name: '默认分类'}],
        'formData.category': '0',
        currentCategory: '0',
        selectedCategoryName: '默认分类'
      });
      
      this.$showError('获取分类失败');
      
      // 加载分类后加载商品
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

  // 加载商品列表
  loadProducts: function(isRefresh = false) {
    if (this.data.isLoading) return;
    
    this.setData({ isLoading: true });
    
    // 构建查询参数
    const params = {
      type: 'getProducts',
      page: this.data.currentPage,
      pageSize: this.data.pageSize
    };
    
    // 如果有分类筛选，添加分类ID
    if (this.data.currentCategory) {
      params.categoryId = this.data.currentCategory;
    }
    
    this.$callCloudFunction('product', params, {
      loadingText: isRefresh ? '刷新中...' : '加载中...',
      errorTitle: '获取商品失败',
      pageName: '查看商品',
      showLoading: isRefresh // 仅在刷新时显示loading
    }).then(result => {
      const { list, pagination } = result.data;
      
      // 添加格式化价格字段
      const products = list.map(product => ({
        ...product,
        formattedPrice: PriceUtils.centToYuan(product.price)
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
      
      // 出错时设置空数组
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
  
  // 按分类筛选商品
  filterProductsByCategory: function(products, categoryId) {
    return products.filter(product => product.categoryId === categoryId);
  },
  
  // 切换分类
  switchCategory: function(e) {
    console.log('switchCategory被调用，事件数据:', e);
    const categoryId = e.currentTarget.dataset.id;  // 直接使用字符串类型的ID
    const categoryIndex = Number(e.currentTarget.dataset.index);
    console.log('切换到分类ID:', categoryId, '索引:', categoryIndex);
    
    // 确保分类ID存在且不为空
    if (!categoryId) {
      console.error('分类ID为空或未定义:', e.currentTarget.dataset.id);
      return;
    }
    
    // 切换分类时重置分页状态
    this.setData({
      currentCategory: categoryId,  // 使用字符串类型的分类ID
      currentPage: 1,
      hasMore: true
    });
    
    // 重新加载商品
    this.loadProducts(true);
  },

  // 显示添加商品表单
  showAddForm: function() {
    // 检查categories是否有效
    let defaultCategoryId = this.data.currentCategory;
    
    // 查找默认分类名称
    const defaultCategory = this.data.categories.find(c => c._id === defaultCategoryId);
    const defaultCategoryName = defaultCategory ? defaultCategory.name : '请选择分类';
      
    // 重置表单数据
    this.setData({
      isAddingProduct: true,
      isEditingProduct: false,
      selectedCategoryName: defaultCategoryName,
      formData: {
        name: '',
        price: '',
        description: '',
        category: defaultCategoryId,
        stock: '',
        imageURL: ''
      }
    });
  },

  // 显示编辑商品表单
  showEditForm: function(e) {
    const { id } = e.currentTarget.dataset;
    
    // 确保products数组存在
    if (!this.data.allProducts || !Array.isArray(this.data.allProducts)) {
      this.$showToast('商品数据无效');
      return;
    }
    
    const product = this.data.allProducts.find(item => item && item._id === id);
    
    if (product) {
      // 查找商品分类名称
      const categoryId = product.categoryId || this.data.currentCategory;
      const category = this.data.categories.find(c => c._id === categoryId);
      const categoryName = category ? category.name : '请选择分类';
      
      // 将价格从分单位转为元单位用于显示
      const priceInYuan = product.price ? Number(PriceUtils.centToYuan(product.price)) : '';
      
      // 确保所有必要的属性都有默认值
      this.setData({
        isAddingProduct: false,
        isEditingProduct: true,
        currentProduct: product,
        selectedCategoryName: categoryName,
        formData: {
          name: product.name || '',
          price: priceInYuan, // 使用元单位显示
          description: product.description || '',
          category: product.categoryId || this.data.currentCategory,
          stock: product.stock || '',
          imageURL: product.imageURL || ''
        }
      });
    } else {
      this.$showToast('未找到商品');
    }
  },

  // 关闭表单（仅用于取消操作）
  closeForm: function() {
    // 如果是添加商品操作且已上传了图片，则需要删除云存储中的图片
    if (this.data.isAddingProduct && this.data.formData.imageURL && 
        this.data.formData.imageURL !== '/images/default-product.png' && 
        this.data.formData.imageURL.includes('cloud://')) {
      console.log('取消添加商品，删除已上传图片:', this.data.formData.imageURL);
      
      // 删除已上传的图片
      imageUtils.deleteCloudFile(this.data.formData.imageURL)
        .then(success => {
          console.log('删除图片结果:', success ? '成功' : '失败');
        })
        .catch(err => {
          console.error('删除图片出错:', err);
        });
    }
    
    // 重置表单状态
    this.resetFormState();
  },
  
  // 重置表单状态（提取公共方法）
  resetFormState: function() {
    this.setData({
      isAddingProduct: false,
      isEditingProduct: false,
      tempImagePath: '', // 清除临时图片路径
      isUploading: false,
      uploadProgress: 0,
      uploadFailed: false
    });
  },
  
  // 防止点击表单内部时关闭表单
  preventClose: function(e) {
    // 阻止事件冒泡
    return false;
  },

  // 表单输入处理
  onInput: function(e) {
    const { field } = e.currentTarget.dataset;
    let value = e.detail.value;
    
    // 对价格字段进行特殊处理，限制最多两位小数
    if (field === 'price' && value) {
      // 确保输入的是有效数字
      if (!/^[0-9]*\.?[0-9]*$/.test(value)) {
        return; // 非有效数字格式，不更新
      }
      
      // 处理小数位数超过2位的情况
      if (value.includes('.')) {
        const parts = value.split('.');
        if (parts[1] && parts[1].length > 2) {
          // 截断为两位小数
          value = parts[0] + '.' + parts[1].substr(0, 2);
        }
      }
    }
    
    this.setData({
      [`formData.${field}`]: value
    });
  },

  // 处理分类选择器变更
  onCategoryChange: function(e) {
    const index = Number(e.detail.value);
    if (!isNaN(index) && this.data.categories && this.data.categories[index]) {
      const categoryId = this.data.categories[index]._id;
      const categoryName = this.data.categories[index].name;
      this.setData({
        'formData.category': categoryId,
        selectedCategoryName: categoryName
      });
    }
  },

  // 选择图片
  chooseImage: function() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: res => {
        const tempFilePath = res.tempFilePaths[0];
        
        // 简单的路径验证
        if (!tempFilePath) {
          this.$showToast('图片选择失败，请重试');
          return;
        }
        
        console.log('选择的图片路径:', tempFilePath);
        
        // 保存原始图片路径用于重试
        this.setData({
          tempImagePath: tempFilePath
        });
        
        // 先压缩图片，再上传
        this.compressAndUploadImage(tempFilePath);
      },
      fail: err => {
        console.error('选择图片失败:', err);
        this.$showToast('选择图片失败');
      }
    });
  },
  
  // 压缩并上传图片
  compressAndUploadImage: function(filePath) {
    wx.showLoading({ title: '准备上传...' });
    
    // 重置上传状态
    this.setData({
      isUploading: true,
      uploadProgress: 0,
      uploadFailed: false
    });
    
    // 先压缩图片
    imageUtils.compressImage(filePath)
      .then(compressedPath => {
        console.log('压缩后的图片路径:', compressedPath);
        // 上传压缩后的图片
        this.uploadImage(compressedPath);
      })
      .catch(err => {
        console.error('图片压缩失败:', err);
        
        // 显示用户友好的错误提示
        if (err.message && err.message.includes('无效')) {
          wx.hideLoading();
          this.setData({
            isUploading: false,
            uploadFailed: true
          });
          this.$showToast('所选图片无效，请重新选择');
        } else {
          // 压缩失败时使用原图
          console.log('压缩失败，使用原图上传');
          this.uploadImage(filePath);
        }
      });
  },
  
  // 上传图片到云存储
  uploadImage: function(filePath) {
    const extension = imageUtils.getFileExtension(filePath);
    const cloudPath = imageUtils.generateCloudPath('product', extension);
    
    console.log('准备上传图片:', {
      原始路径: filePath,
      文件扩展名: extension,
      云存储路径: cloudPath
    });
    
    // 使用带重试功能的上传方法
    imageUtils.uploadImageWithRetry(
      filePath, 
      cloudPath, 
      (res) => {
        // 进度回调
        const progress = res.progress;
        this.setData({
          uploadProgress: progress
        });
      }
    )
    .then(result => {
      // 使用imageUtils确保fileID有效
      const fileID = result.fileID;
      
      console.log('图片上传成功:', {
        文件ID: fileID,
        云存储路径: cloudPath
      });
      
      // 直接使用fileID
      this.setData({
        'formData.imageURL': fileID,
        isUploading: false,
        uploadFailed: false
      });
      
      wx.hideLoading();
      this.$showSuccess('上传成功');
    })
    .catch(err => {
      console.error('图片上传失败:', err);
      this.setData({
        isUploading: false,
        uploadFailed: true
      });
      wx.hideLoading();
      this.$showError('上传失败');
    });
  },
  
  // 重试上传
  retryUpload: function() {
    if (this.data.tempImagePath) {
      this.compressAndUploadImage(this.data.tempImagePath);
    } else {
      this.$showToast('没有可重试的图片');
    }
  },

  // 提交商品表单
  submitForm: function() {
    const formData = this.data.formData;
    
    // 验证表单数据
    if (!formData.name || !formData.name.trim()) {
      this.$showToast('请输入商品名称');
      return;
    }
    
    // 基本价格验证
    if (!formData.price || isNaN(Number(formData.price)) || Number(formData.price) <= 0) {
      this.$showToast('请输入有效的商品价格');
      return;
    }
    
    // 使用价格工具类验证价格精度
    if (!PriceUtils.validatePricePrecision(formData.price)) {
      this.$showToast('价格最多只能精确到分（两位小数）');
      return;
    }
    
    // 获取当前选中的分类ID
    const selectedCategoryId = formData.category;
    const selectedCategory = this.data.categories.find(c => c._id === selectedCategoryId);
    
    if (!selectedCategory) {
      this.$showToast('请选择有效的商品分类');
      return;
    }
    
    // 转换价格为分单位
    const priceInCent = Math.round(Number(formData.price) * 100);
    
    // 构建提交数据
    const submitData = {
      name: formData.name.trim(),
      price: priceInCent, // 使用分作为单位
      description: formData.description ? formData.description.trim() : '',
      categoryId: selectedCategory._id,  // 使用分类ID
      stock: formData.stock ? Number(formData.stock) : 999,
      imageURL: formData.imageURL || ''  // 使用imageURL字段名
    };
    
    console.log('提交的商品数据:', submitData);
    
    // 根据操作类型调用不同的云函数
    if (this.data.isAddingProduct) {
      this.addProduct(submitData);
    } else if (this.data.isEditingProduct) {
      this.updateProduct(submitData);
    }
  },

  // 删除商品
  deleteProduct: function(e) {
    const { id, name, image } = e.currentTarget.dataset;
    
    this.$showConfirm('确认删除', `确定要删除商品"${name}"吗？`, () => {
      this.$callCloudFunction('product', {
        type: 'deleteProduct',
        id
      }, {
        loadingText: '删除中...',
        errorTitle: '删除失败',
        pageName: '删除商品'
      }).then(result => {
        this.$showSuccess(result.message || '删除成功');
        
        // 如果有图片且不是默认图片，删除云存储中的图片
        if (image && image !== '/images/default-product.png' && image.includes('cloud://')) {
          console.log('删除商品图片:', image);
          imageUtils.deleteCloudFile(image)
            .then(success => {
              console.log('删除商品图片结果:', success ? '成功' : '失败');
            })
            .catch(err => {
              console.error('删除商品图片出错:', err);
            });
        }
        
        // 刷新商品列表
        this.loadProducts();
      }).catch(err => {
        console.error('删除商品失败:', err);
        
        // 检查是否是已售出商品的错误
        if (err && err.message && err.message.includes('已有订单记录')) {
          // 提示用户只能下架不能删除
          this.$showConfirm('无法删除', '该商品已有订单记录，不能删除，是否改为下架操作？', () => {
            // 用户确认，执行下架操作
            this.$callCloudFunction('product', {
              type: 'updateProduct',
              id,
              isOnSale: false
            }, {
              loadingText: '下架中...',
              errorTitle: '下架失败',
              pageName: '下架商品'
            }).then(result => {
              this.$showSuccess('已下架');
              // 刷新商品列表
              this.loadProducts();
            }).catch(downErr => {
              this.$showError('下架失败');
            });
          });
        } else {
          // 其他错误，显示通用错误提示
          this.$showError('删除失败');
        }
      });
    });
  },

  // 切换商品上下架状态
  toggleProductStatus: function(e) {
    const { id, status } = e.currentTarget.dataset;
    const newStatus = !status;
    
    this.$callCloudFunction('product', {
      type: 'updateProduct',
      id,
      isOnSale: newStatus
    }, {
      loadingText: newStatus ? '上架中...' : '下架中...',
      errorTitle: '操作失败',
      pageName: newStatus ? '上架商品' : '下架商品'
    }).then(result => {
      this.$showSuccess(newStatus ? '已上架' : '已下架');
      
      // 刷新商品列表
      this.loadProducts();
    }).catch(err => {
      this.$showError('操作失败');
    });
  },

  // 取消表单
  cancelForm: function() {
    // 调用closeForm方法，并传入false表示是取消操作
    this.closeForm();
  },

  // 添加商品
  addProduct: function(productData) {
    // 构建请求数据
    const requestData = {
      type: 'addProduct',
      ...productData
    };
    
    // 调用云函数
    this.$callCloudFunction('product', requestData, {
      loadingText: '添加商品中...',
      errorTitle: '添加失败',
      pageName: '添加商品'
    }).then(result => {
      this.$showSuccess('添加成功');
      
      // 重置表单状态并刷新商品列表
      this.resetFormState();
      this.loadProducts();
    }).catch(err => {
      console.error('添加商品失败:', err);
      this.$showError('添加失败');
    });
  },
  
  // 更新商品
  updateProduct: function(productData) {
    // 构建请求数据
    const requestData = {
      type: 'updateProduct',
      id: this.data.currentProduct._id,
      ...productData
    };
    
    // 调用云函数
    this.$callCloudFunction('product', requestData, {
      loadingText: '更新商品中...',
      errorTitle: '更新失败',
      pageName: '编辑商品'
    }).then(result => {
      this.$showSuccess('更新成功');
      
      // 重置表单状态并刷新商品列表
      this.resetFormState();
      this.loadProducts();
    }).catch(err => {
      console.error('更新商品失败:', err);
      this.$showError('更新失败');
    });
  },
};

// 使用基础页面创建页面实例
Page(basePage.createPage('pages/product/product', pageConfig)); 