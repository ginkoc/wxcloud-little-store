// 引入基础页面类
const basePage = require('../../utils/basePage');

// 管理员消息通知页面配置
const pageConfig = {
  data: {
    // 消息列表
    noticeList: [],
    unreadCount: 0,
    
    // 分页信息
    currentPage: 1,
    pageSize: 20,
    hasMore: true,
    loading: false,
    
    // 筛选条件
    statusOptions: [
      { label: '全部', value: '' },
      { label: '未读', value: 'UNREAD' },
      { label: '已读', value: 'read' }
    ],
    statusIndex: 0,
    
    levelOptions: [
      { label: '全部', value: '' },
      { label: '错误', value: 'ERROR' },
      { label: '警告', value: 'WARNING' },
      { label: '信息', value: 'INFO' }
    ],
    levelIndex: 0,
    
    // 批量选择
    selectedNotices: [],
    
    // 弹窗相关
    showDetailModal: false,
    selectedNotice: null,
    
    // 标签映射
    statusLabels: {
      'UNREAD': '未读',
      'read': '已读'
    },
    levelLabels: {
      'ERROR': '错误',
      'WARNING': '警告',  
      'INFO': '信息'
    },
    
    // 开发调试
    showTechnicalInfo: false
  },

  onLoad(options) {
    console.log('消息通知页面加载')
    
    // 🔒 检查管理员权限
    this.$checkAdminPermission()
      .then(() => {
        this.loadNotices()
        this.loadUnreadCount()
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

  onShow() {
    // 每次显示页面时刷新未读数量
    this.loadUnreadCount()
  },

  onPullDownRefresh() {
    this.onRefresh()
    wx.stopPullDownRefresh()
  },

  onReachBottom() {
    this.loadMore()
  },

  /**
   * 加载消息通知列表
   */
  async loadNotices(reset = false) {
    if (this.data.loading) return
    
    this.setData({ loading: true })
    
    try {
      const page = reset ? 1 : this.data.currentPage
      const status = this.data.statusOptions[this.data.statusIndex].value
      const level = this.data.levelOptions[this.data.levelIndex].value
      
      const result = await this.$callCloudFunction('notice', {
        type: 'getNotices',
        page: page,
        pageSize: this.data.pageSize,
        status: status,
        level: level
      }, {
        loadingText: '加载中...',
        errorTitle: '加载失败',
        pageName: '消息通知'
      })
      
      const { list, pagination } = result.data
      
      list.forEach(item => {
        // 格式化所有时间字段
        const timeFields = {
          createTime: item.createTime,
          updateTime: item.updateTime,
          expireTime: item.expireTime,
          readTime: item.readTime
        };

        // 格式化存在的时间字段
        Object.keys(timeFields).forEach(field => {
          if (timeFields[field]) {
            item[field] = this.$formatTime(timeFields[field]);
          }
        });
      })

      this.setData({
        noticeList: reset ? list : [...this.data.noticeList, ...list],
        currentPage: pagination.current,
        hasMore: pagination.current < pagination.totalPages,
        loading: false
      })
    } catch (error) {
      console.error('加载消息通知失败:', error)
      this.setData({ loading: false })
    }
  },

  /**
   * 加载未读消息数量
   */
  async loadUnreadCount() {
    try {
      const result = await this.$callCloudFunction('notice', {
        type: 'getUnreadCount'
      }, {
        showLoading: false,
        showError: false,
        pageName: '消息通知'
      })
      
      this.setData({
        unreadCount: result.data.unreadCount
      })
    } catch (error) {
      console.error('加载未读数量失败:', error)
    }
  },

  /**
   * 状态筛选改变
   */
  onStatusChange(e) {
    this.setData({
      statusIndex: parseInt(e.detail.value),
      currentPage: 1
    })
    this.loadNotices(true)
  },

  /**
   * 级别筛选改变
   */
  onLevelChange(e) {
    this.setData({
      levelIndex: parseInt(e.detail.value),
      currentPage: 1
    })
    this.loadNotices(true)
  },

  /**
   * 刷新
   */
  onRefresh() {
    this.setData({ 
      currentPage: 1,
      selectedNotices: []
    })
    this.loadNotices(true)
    this.loadUnreadCount()
  },

  /**
   * 加载更多
   */
  loadMore() {
    if (!this.data.hasMore || this.data.loading) return
    
    this.setData({
      currentPage: this.data.currentPage + 1
    })
    this.loadNotices()
  },

  /**
   * 点击消息项
   */
  onNoticeClick(e) {
    const notice = e.currentTarget.dataset.notice
    this.setData({
      selectedNotice: notice,
      showDetailModal: true
    })
    
    // 如果是未读消息，自动标记为已读
    if (notice.status === 'UNREAD') {
      this.markAsReadFromModal(notice._id)
    }
  },

  /**
   * 切换选择状态
   */
  onToggleSelect(e) {
    const noticeId = e.currentTarget.dataset.noticeId
    const selectedNotices = [...this.data.selectedNotices]
    const index = selectedNotices.indexOf(noticeId)
    
    if (index > -1) {
      selectedNotices.splice(index, 1)
    } else {
      selectedNotices.push(noticeId)
    }
    
    this.setData({ selectedNotices })
  },

  /**
   * 从模态框标记为已读（不显示toast）
   */
  async markAsReadFromModal(noticeId) {
    try {
      await this.$callCloudFunction('notice', {
        type: 'markAsRead',
        noticeIds: [noticeId]
      }, {
        showLoading: false,
        showError: false,
        pageName: '消息通知'
      })
      
      // 更新本地数据
      const noticeList = this.data.noticeList.map(notice => {
        if (notice._id === noticeId) {
          return {
            ...notice,
            status: 'read',
            isRead: true,
            readTime: new Date().toLocaleString()
          }
        }
        return notice
      })
      
      // 同时更新选中的消息
      if (this.data.selectedNotice && this.data.selectedNotice._id === noticeId) {
        this.setData({
          selectedNotice: {
            ...this.data.selectedNotice,
            status: 'read',
            isRead: true,
            readTime: new Date().toLocaleString()
          }
        })
      }
      
      this.setData({ noticeList })
      this.loadUnreadCount()
    } catch (error) {
      console.error('标记已读失败:', error)
    }
  },

  /**
   * 标记单个消息为已读
   */
  async markAsRead(e) {
    const noticeId = e.currentTarget.dataset.noticeId
    
    try {
      await this.$callCloudFunction('notice', {
        type: 'markAsRead',
        noticeIds: [noticeId]
      }, {
        loadingText: '处理中...',
        errorTitle: '操作失败',
        pageName: '消息通知'
      })
      
      // 更新本地数据
      const noticeList = this.data.noticeList.map(notice => {
        if (notice._id === noticeId) {
          return {
            ...notice,
            status: 'read',
            isRead: true,
            readTime: new Date().toLocaleString()
          }
        }
        return notice
      })
      
      this.setData({ noticeList })
      this.loadUnreadCount()
      
      this.$showSuccess('已标记为已读')
    } catch (error) {
      console.error('标记已读失败:', error)
    }
  },

  /**
   * 批量标记已读
   */
  async batchMarkAsRead() {
    if (this.data.selectedNotices.length === 0) {
      this.$showToast('请选择消息')
      return
    }
    
    try {
      await this.$callCloudFunction('notice', {
        type: 'markAsRead',
        noticeIds: this.data.selectedNotices
      }, {
        loadingText: '处理中...',
        errorTitle: '操作失败',
        pageName: '消息通知'
      })
      
      // 更新本地数据
      const noticeList = this.data.noticeList.map(notice => {
        if (this.data.selectedNotices.includes(notice._id)) {
          return {
            ...notice,
            status: 'read',
            isRead: true,
            readTime: new Date().toLocaleString()
          }
        }
        return notice
      })
      
      this.setData({ 
        noticeList,
        selectedNotices: []
      })
      this.loadUnreadCount()
      
      this.$showSuccess('批量标记成功')
    } catch (error) {
      console.error('批量标记已读失败:', error)
    }
  },

  /**
   * 删除单个消息
   */
  async deleteNotice(e) {
    const noticeId = e.currentTarget.dataset.noticeId
    
    const confirmed = await this.$showConfirm('确认删除', '确定要删除这条消息吗？')
    if (!confirmed) return
    
    try {
      await this.$callCloudFunction('notice', {
        type: 'deleteNotices',
        noticeIds: [noticeId]
      }, {
        loadingText: '删除中...',
        errorTitle: '删除失败',
        pageName: '消息通知'
      })
      
      // 从本地数据中移除
      const noticeList = this.data.noticeList.filter(notice => notice._id !== noticeId)
      const selectedNotices = this.data.selectedNotices.filter(id => id !== noticeId)
      
      this.setData({ 
        noticeList,
        selectedNotices
      })
      
      this.$showSuccess('删除成功')
    } catch (error) {
      console.error('删除消息失败:', error)
    }
  },

  /**
   * 批量删除
   */
  async batchDelete() {
    if (this.data.selectedNotices.length === 0) {
      this.$showToast('请选择消息')
      return
    }
    
    const confirmed = await this.$showConfirm('确认删除', `确定要删除选中的${this.data.selectedNotices.length}条消息吗？`)
    if (!confirmed) return
    
    try {
      await this.$callCloudFunction('notice', {
        type: 'deleteNotices',
        noticeIds: this.data.selectedNotices
      }, {
        showLoading: false,
        showError: false,
        pageName: '消息通知'
      })
      
      // 从本地数据中移除
      const noticeList = this.data.noticeList.filter(
        notice => !this.data.selectedNotices.includes(notice._id)
      )
      
      this.setData({ 
        noticeList,
        selectedNotices: []
      })
      
      this.$showSuccess('批量删除成功')
    } catch (error) {
      console.error('批量删除失败:', error)
    }
  },

  /**
   * 点击相关链接
   */
  onLinkClick(e) {
    const url = e.currentTarget.dataset.url
    
    if (url.startsWith('http')) {
      // 外部链接，复制到剪贴板
      wx.setClipboardData({
        data: url,
        success: () => {
          this.$showSuccess('链接已复制')
        }
      })
    } else {
      // 内部链接，导航到对应页面
      wx.navigateTo({
        url: url
      }).catch(() => {
        this.$showToast('页面暂不可用')
      })
    }
  },

  /**
   * 跳转到订单详情
   */
  goToOrder(e) {
    const orderId = e.currentTarget.dataset.orderId
    
    wx.navigateTo({
      url: `/pages/order-manage-detail/order-manage-detail?orderId=${orderId}`
    }).catch(() => {
      this.$showToast('无法打开订单详情')
    })
  },

  /**
   * 关闭详情弹窗
   */
  closeDetailModal() {
    this.setData({
      showDetailModal: false,
      selectedNotice: null
    })
  },

  /**
   * 阻止弹窗关闭
   */
  preventClose() {
    // 阻止事件冒泡，防止点击弹窗内容时关闭弹窗
  },
};

// 使用基础页面类创建页面
Page(basePage.createPage('pages/notices/notices', pageConfig)); 