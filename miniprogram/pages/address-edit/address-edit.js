// 引入基础页面类
const basePage = require('../../utils/basePage');
const dataUtils = require('../../utils/dataUtils');

// 创建页面配置
const pageConfig = {
  data: {
    address: {
      contactName: '',
      contactPhone: '',
      province: '',
      city: '',
      district: '',
      street: '',
      detailAddress: '',
      isDefault: false,
      tag: '家'
    },
    region: ['请选择', '请选择', '请选择'],
    tags: ['家', '公司', '学校', '其他'],
    isEdit: false,
    addressId: '',
    formErrors: {
      contactName: '',
      contactPhone: '',
      region: '',
      detailAddress: ''
    }
  },

  onLoad: function(options) {
    if (options.id) {
      // 编辑模式
      this.setData({
        isEdit: true,
        addressId: options.id
      });
      this.loadAddressDetail(options.id);
    }
  },
  
  // 加载地址详情
  loadAddressDetail: function(addressId) {
    wx.showLoading({ title: '加载中...' });
    
    this.$callCloudFunction('address', {
      type: 'getAddressDetail',
      addressId: addressId
    }, {
      showLoading: false,
      errorTitle: '获取地址详情失败',
      pageName: '地址编辑'
    }).then(result => {
      const address = result.data;
      
      this.setData({
        address: address,
        region: [address.province, address.city, address.district]
      });
      
      wx.hideLoading();
    }).catch(err => {
      console.error('获取地址详情失败:', err);
      wx.hideLoading();
      
      wx.showToast({
        title: '获取地址失败',
        icon: 'none'
      });
      
      // 返回上一页
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
    });
  },
  
  // 表单输入处理
  onInput: function(e) {
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    
    this.setData({
      [`address.${field}`]: value,
      [`formErrors.${field}`]: ''
    });
  },
  
  // 地区选择
  bindRegionChange: function(e) {
    const region = e.detail.value;
    
    this.setData({
      region: region,
      'address.province': region[0],
      'address.city': region[1],
      'address.district': region[2],
      'formErrors.region': ''
    });
  },
  
  // 设置默认地址
  toggleDefault: function() {
    this.setData({
      'address.isDefault': !this.data.address.isDefault
    });
  },
  
  // 选择标签
  selectTag: function(e) {
    const tag = e.currentTarget.dataset.tag;
    
    this.setData({
      'address.tag': tag
    });
  },
  
  // 表单验证
  validateForm: function() {
    const { address, region } = this.data;
    const errors = {};
    
    // 验证联系人
    if (!address.contactName || address.contactName.trim().length < 2) {
      errors.contactName = '请输入正确的联系人姓名';
    }
    
    // 验证手机号
    if (!address.contactPhone || !dataUtils.validatePhone(address.contactPhone)) {
      errors.contactPhone = '请输入正确的手机号';
    }
    
    // 验证地区和街道
    if (region[0] === '请选择' || region[1] === '请选择' || region[2] === '请选择' || !address.street) {
      errors.region = '请选择完整的地址信息';
    }
    
    // 验证详细地址
    if (!address.detailAddress || address.detailAddress.trim().length < 5) {
      errors.detailAddress = '请输入详细地址（至少5个字符）';
    }
    
    this.setData({
      formErrors: errors
    });
    
    return Object.keys(errors).length === 0;
  },
  
  // 保存地址
  saveAddress: function() {
    // 表单验证
    if (!this.validateForm()) {
      const firstError = Object.values(this.data.formErrors).find(err => err);
      if (firstError) {
        wx.showToast({
          title: firstError,
          icon: 'none'
        });
      }
      return;
    }
    
    wx.showLoading({ title: '保存中...' });
    
    const { address, isEdit, addressId } = this.data;
    
    const cloudFnData = {
      type: isEdit ? 'updateAddress' : 'addAddress',
      address: {
        contactName: address.contactName,
        contactPhone: address.contactPhone,
        province: address.province,
        city: address.city,
        district: address.district,
        street: address.street,
        detailAddress: address.detailAddress,
        isDefault: address.isDefault,
        tag: address.tag
      }
    };
    
    // 如果是编辑模式，添加地址ID
    if (isEdit) {
      cloudFnData.addressId = addressId;
    }
    
    this.$callCloudFunction('address', cloudFnData, {
      showLoading: false,
      errorTitle: isEdit ? '更新地址失败' : '添加地址失败',
      pageName: '地址编辑'
    }).then(result => {
      wx.hideLoading();
      
      wx.showToast({
        title: isEdit ? '地址已更新' : '地址已添加',
        icon: 'success'
      });
      
      // 返回上一页
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
    }).catch(err => {
      console.error(isEdit ? '更新地址失败:' : '添加地址失败:', err);
      wx.hideLoading();
    });
  },
  
  // 选择地址
  chooseLocation: function() {
    // 使用位置选择API
    wx.chooseLocation({
      success: (res) => {
        console.log('位置选择结果:', res);
        
        // 解析地址，更新省市区信息
        this.parseLocationAddress(res.address, res.name);
        
        // 更新街道信息
        this.setData({
          'address.street': res.name, // 使用位置名称作为街道信息
          'formErrors.region': '' // 清除地区错误提示
        });
      },
      fail: (err) => {
        console.error('选择位置失败:', err);
        
        // 判断是否是用户取消操作
        if (err.errMsg.indexOf('cancel') === -1) {
          wx.showToast({
            title: '获取位置失败，请检查定位权限',
            icon: 'none'
          });
        }
      }
    });
  },
  
  // 解析位置地址，提取省市区信息
  parseLocationAddress: function(address, name) {
    if (!address) return;
    
    console.log('解析地址:', address);
    
    // 尝试从地址中解析省市区
    // 常见的格式如: "福建省宁德市福安市城北街道荣兴路402号"
    const provinceCityRegex = /(.*?(省|自治区|直辖市|特别行政区))?(.*?(市|自治州|地区|区划))(.*?(区|县|市|自治县|旗|海域|林区))?/;
    const matches = address.match(provinceCityRegex);
    
    let province = '', city = '', district = '';
    
    if (matches) {
      province = matches[1] || '';
      city = matches[3] || '';
      district = matches[5] || '';
      
      // 处理直辖市特殊情况
      if (!province && city && ['北京市', '上海市', '天津市', '重庆市'].includes(city)) {
        province = city;
        city = city;
        district = matches[5] || '';
      }
      
      // 移除结尾的 "省"、"市"、"区" 等后缀
      province = province.replace(/(省|自治区|直辖市|特别行政区)$/, '');
      city = city.replace(/(市|自治州|地区|区划)$/, '');
      district = district.replace(/(区|县|市|自治县|旗|海域|林区)$/, '');
      
      console.log('解析结果:', { province, city, district });
      
      // 如果解析成功，更新地址信息
      if (province && city) {
        const region = [province, city, district];
        
        this.setData({
          region: region,
          'address.province': province,
          'address.city': city,
          'address.district': district
        });
      }
    } else {
      console.log('地址解析失败，无法匹配省市区');
    }
  },
  
  // 返回上一页
  goBack: function() {
    wx.navigateBack();
  }
};

// 使用基础页面类创建页面
Page(basePage.createPage('pages/address-edit/address-edit', pageConfig)); 