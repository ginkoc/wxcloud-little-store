# 🏪 我的小店 - 微信小程序电商模板

一个完整的微信小程序电商解决方案，支持商品管理、购物车、订单管理、用户管理、支付和退款功能。项目经过全面优化，具备生产级别的代码质量和性能表现。

## ✨ 主要特性

### 🛠️ 完整功能
- **商品管理**：分类管理、商品增删改查、上下架管理
- **购物车**：商品选择、数量修改、批量操作
- **订单管理**：订单创建、状态跟踪、详情查看
- **用户系统**：登录注册、权限管理、个人中心
- **支付系统**：微信支付集成、支付状态查询
- **退款功能**：退款申请、状态跟踪、自动处理
- **自动化处理**：订单7天自动确认、游标分页处理大数据量

### 🎯 模板化设计
- **配置化**：店铺信息完全可配置，支持快速定制
- **组件化**：高度复用的基础组件和工具类
- **标准化**：统一的代码规范和开发模式
- **文档化**：完整的配置说明和使用指南


## 🚀 快速开始

### 1. 环境准备
- 微信开发者工具
- Node.js 环境
- 微信小程序账号
- 微信云开发环境

### 2. 项目配置

#### 店铺信息配置
编辑 `miniprogram/config/appConfig.js`：
```javascript
const appConfig = {
  storeName: '您的店铺名称',        // 修改为您的店铺名称
  servicePhone: '您的客服电话',     // 修改为您的客服电话
  // ... 其他配置
};
```

编辑 `cloudfunctions/order/config.js`：
```javascript
const cloudConfig = {
  storeName: '您的店铺名称',        // 保持与小程序端一致
  paymentPrefix: '您的店铺名称',    // 微信支付描述前缀
  // ... 其他配置
};
```

### 3. 部署步骤

#### 🏗️ 第一步：环境设置
```bash
# 1. 在微信开发者工具中打开项目
# 2. 确保已开通云开发服务
# 3. 选择或创建云开发环境
```

#### ☁️ 第二步：部署云函数
```bash
# 在微信开发者工具中：
# 1. 右键点击 cloudfunctions 文件夹
# 2. 选择"上传并部署：云端安装依赖"
# 3. 等待所有云函数部署完成
```

#### 🕐 第二步补充：配置定时任务（可选）

为了实现订单7天自动确认功能，需要配置定时触发器：

1. **在云开发控制台配置定时触发器**：
   - 打开微信开发者工具 → 云开发 → 定时触发器
   - 点击"新建"按钮
   - 触发器名称：`autoConfirmOrders`
   - 触发周期：`0 2 * * *`（每天凌晨2点执行）
   - 云函数名称：`autoConfirmOrders`

2. **触发器配置说明**：
   ```
   Cron表达式：0 2 * * *
   含义：每天凌晨2点自动执行
   功能：自动确认超过7天未确认的订单
   ```

3. **手动测试定时任务**：
   ```javascript
   // 在云开发控制台 → 云函数 → autoConfirmOrders → 测试
   // 输入测试参数：{}
   // 点击运行测试
   ```

**注意**：autoConfirmOrders云函数现已优化为支持游标分页处理，可以处理大量订单数据而不会超时。

#### 🗄️ 第三步：初始化数据库
数据库初始化有两种方式，推荐使用方式一：

**方式一：使用 systemInit 云函数（推荐）**

⚠️ **重要提示**：不能在微信开发者工具中直接测试云函数，因为无法获取真实的 openid。请使用以下两种方法之一：

📝 **自定义商品分类（可选）**

如果需要修改默认的商品分类（类型1、类型2...其他），请在初始化前进行以下配置：

1. **修改 systemInit 云函数配置**：
   编辑 `cloudfunctions/systemInit/index.js` 文件，找到 `DEFAULT_CONFIG.categories` 部分：

```javascript
// 当前默认配置：
categories: [
  { 
    name: '类型1', 
    order: 1, 
    description: '类型1'
  },
  { 
    name: '类型2', 
    order: 2, 
    description: '类型2'
  },
  { 
    name: '类型3', 
    order: 3, 
    description: '类型3'
  },
  { 
    name: '类型4', 
    order: 4, 
    description: '类型4'
  },
  { 
    name: '其他', 
    order: 5, 
    description: '其他'
  }
]

// 自定义示例（根据您的业务修改）：
categories: [
  { 
    name: '水果', 
    order: 1, 
    description: '新鲜水果'
  },
  { 
    name: '蔬菜', 
    order: 2, 
    description: '有机蔬菜'
  },
  { 
    name: '零食', 
    order: 3, 
    description: '休闲零食'
  },
  { 
    name: '饮料', 
    order: 4, 
    description: '各类饮品'
  },
  { 
    name: '其他', 
    order: 5, 
    description: '其他商品'
  }
]
```

2. **重新部署 systemInit 云函数**：
   - 在微信开发者工具中右键点击 `cloudfunctions/systemInit`
   - 选择"上传并部署：云端安装依赖"
   - 等待部署完成

3. **然后按照下面的方法调用初始化**

**方法 A：在微信开发者工具的 Console 中调用（推荐）**

1. **打开微信开发者工具的控制台**：
   - 在微信开发者工具中打开项目
   - 点击菜单栏"工具" → "调试器"
   - 在调试器中切换到"Console"标签页

2. **在 Console 中执行以下代码**：

```javascript
wx.cloud.callFunction({
  name: 'systemInit',
  data: {
    type: 'all'
  }
}).then(res => {
  console.log('初始化成功:', res);
}).catch(err => {
  console.error('初始化失败:', err);
});
```

📋 **type 参数说明**：

| type 值 | 功能说明 | 适用场景 |
|---------|----------|----------|
| `'all'` | 执行完整初始化（推荐） | 首次部署，创建所有集合+分类+管理员 |
| `'collections'` | 仅创建数据库集合 | 只需要创建空的数据库表结构 |
| `'categories'` | 仅初始化商品分类 | 已有数据库，只需要添加/更新分类 |
| `'admin'` | 仅设置管理员权限 | 为当前用户添加管理员权限 |
| `'info'` | 获取数据库信息 | 查看当前数据库状态（调试用） |

3. **按回车执行**：
   - 等待云函数执行完成
   - 查看控制台输出结果

**方法 B：在小程序中调用**

1. **临时添加初始化按钮**：
   在 `miniprogram/pages/index/index.wxml` 中临时添加：

```xml
<!-- 临时初始化按钮，初始化完成后可删除 -->
<view class="init-button" bindtap="initSystem" style="position: fixed; top: 10px; right: 10px; background: red; color: white; padding: 10px; z-index: 9999;">
  初始化数据库
</view>
```

2. **在对应的 js 文件中添加方法**：

```javascript
// 临时初始化方法，初始化完成后可删除
initSystem: function() {
  wx.showLoading({ title: '初始化中...' });
  
  this.$callCloudFunction('systemInit', {
    type: 'all'
  }, {
    loadingText: '初始化数据库中...',
    errorTitle: '初始化失败',
    pageName: '数据库初始化'
  }).then(result => {
    wx.hideLoading();
    console.log('初始化结果:', result);
    wx.showModal({
      title: '初始化完成',
      content: JSON.stringify(result, null, 2),
      showCancel: false
    });
  }).catch(err => {
    wx.hideLoading();
    console.error('初始化失败:', err);
    wx.showModal({
      title: '初始化失败',
      content: err.message || '初始化过程中发生错误',
      showCancel: false
    });
  });
}
```

3. **执行初始化**：
   - 在小程序预览中点击"初始化数据库"按钮
   - 等待初始化完成
   - **完成后删除临时代码**

**方式二：手动创建（备选方案）**

如果云函数方式失败，可以手动创建：

1. **进入云开发控制台**：
   - 打开微信开发者工具
   - 点击"云开发" → "数据库"

2. **创建以下集合**：
   ```
   users        # 用户信息表
   products     # 商品信息表  
   categories   # 商品分类表
   orders       # 订单信息表
   cart         # 购物车表
   refunds      # 退款记录表
   order_history # 订单历史表
   notices      # 消息通知表
   addresses    # 地址表
   ```

3. **手动添加商品分类**：
   在 `categories` 集合中添加以下记录：
   ```json
   [
     {"name": "类型1", "order": 1, "description": "类型1", "status": "active"},
     {"name": "类型2", "order": 2, "description": "类型2", "status": "active"},
     {"name": "类型3", "order": 3, "description": "类型3", "status": "active"},
     {"name": "类型4", "order": 4, "description": "类型4", "status": "active"},
     {"name": "其他", "order": 5, "description": "其他", "status": "active"}
   ]
   ```

4. **设置管理员权限**：
   在 `users` 集合中为您的账号添加记录：
   ```json
   {
     "_openid": "您的openid",
     "isAdmin": true,
     "nickName": "管理员",
     "createTime": "当前时间"
   }
   ```

#### 💳 第四步：配置支付参数（可选）
如需使用支付功能：
1. 在云开发控制台配置微信支付
2. 修改 `cloudfunctions/order/config.js` 中的支付参数
3. 设置支付回调地址

#### 🚀 第五步：预览和发布
```bash
# 1. 点击微信开发者工具的"预览"按钮
# 2. 使用手机微信扫码测试
# 3. 确认功能正常后，点击"上传"发布版本
```

#### 🖼️ 第六步：云存储图片域名配置

如果遇到商品图片显示 **403错误** 或提示 `不在以下 request 合法域名列表中`，请按以下方法解决：

**方法1：开发工具设置（推荐用于开发阶段）**

1. 打开微信开发者工具
2. 在工具栏中找到"详情"按钮并点击，或使用快捷键 `Ctrl/Cmd + Shift + D`
3. 在"本地设置"标签页中，勾选以下选项：
   ```
   ☑️ 不校验合法域名、web-view（业务域名）、TLS版本以及HTTPS证书
   ```
4. 重新预览/编译小程序

**方法2：小程序后台配置（用于正式发布）**

1. **登录小程序管理后台**：
   - 访问 [微信公众平台](https://mp.weixin.qq.com/)
   - 使用小程序管理员账号登录

2. **添加request合法域名**：
   - 进入"开发" → "开发管理" → "开发设置"
   - 找到"服务器域名"部分
   - 在"request合法域名"中添加以下域名：
     ```
     https://servicewechat.com
     https://tcb-api.tencentcloudapi.com
     https://您的云环境ID.tcb.qcloud.la
     ```

3. **获取您的云环境域名**：
   - 在微信开发者工具中打开"云开发控制台"
   - 查看云存储中任意一张图片的URL
   - 复制域名部分（例如：`https://636c-cloud1-6grvv2t6d0f32080-1362327916.tcb.qcloud.la`）

4. **保存配置**：
   - 点击"保存并提交"
   - 等待配置生效（通常需要几分钟）

## 📁 项目结构

```
susie-store/
├── miniprogram/                 # 小程序前端
│   ├── config/                  # 🆕 配置文件
│   │   └── appConfig.js        # 应用配置
│   ├── pages/                   # 页面文件
│   │   ├── index/              # 首页
│   │   ├── profile/            # 个人中心
│   │   ├── cart/               # 购物车
│   │   ├── checkout/           # 结算页面
│   │   ├── my-orders/          # 我的订单
│   │   ├── order-detail/       # 订单详情
│   │   ├── product/            # 商品管理
│   │   ├── order-manage/       # 订单管理
│   │   ├── order-manage-detail/ # 订单管理详情
│   │   ├── address-list/       # 地址列表
│   │   ├── address-edit/       # 地址编辑
│   │   └── notices/            # 消息通知
│   └── utils/                   # 工具类
│       ├── basePage.js         # 🆕 基础页面类
│       ├── timeUtils.js        # 🆕 时间工具类
│       ├── errorHandler.js     # 错误处理
│       ├── eventManager.js     # 事件管理
│       ├── dataUtils.js        # 数据处理
│       ├── priceUtils.js       # 价格计算
│       └── imageUtils.js       # 图片处理
├── cloudfunctions/              # 云函数
│   ├── cart/                   # 购物车云函数
│   ├── user/                   # 用户云函数
│   ├── product/                # 商品云函数
│   ├── order/                  # 订单云函数
│   │   └── config.js          # 🆕 云函数配置
│   ├── refund/                 # 退款云函数
│   ├── payCallback/            # 支付回调
│   ├── refundCallback/         # 退款回调
│   ├── systemInit/             # 系统初始化
│   ├── autoConfirmOrders/      # 自动确认订单
│   ├── address/                # 地址管理
│   └── notice/                 # 消息通知
```

## 🔧 技术架构

### 前端技术
- **框架**：微信小程序原生框架
- **架构模式**：基础页面类 + 组件化开发
- **状态管理**：页面级状态管理
- **工具类**：统一的工具函数库

### 后端技术
- **云开发**：微信云开发
- **数据库**：微信云数据库
- **文件存储**：微信云存储
- **云函数**：Node.js + wx-server-sdk
## ⚠️ 重要：云函数返回格式说明

### 📋 微信小程序云函数返回值机制

**核心要点**：微信小程序会自动为云函数返回值添加包装层，开发者无需手动包装！

#### ✅ 正确的云函数返回格式

**在云函数中返回**：
```javascript
// 云函数直接返回数据
return {
  success: true,
  data: someData,
  message: '操作成功'
};
```

**微信框架自动包装为**：
```javascript
// 前端接收到的格式
{
  errMsg: "cloud.callFunction:ok",
  result: {                    // ← 微信自动添加的包装层
    success: true,
    data: someData,
    message: '操作成功'
  },
  requestID: "requestId..."
}
```

#### ❌ 错误的云函数返回格式

**千万不要这样返回**：
```javascript
// ❌ 错误：手动添加 result 包装
return {
  result: {                   // ← 这会导致双重包装！
    success: true,
    data: someData
  }
};
```

这会导致双重包装，前端访问 `res.result.success` 时会得到 `undefined`。

#### 📖 前端正确访问方式

```javascript
wx.cloud.callFunction({
  name: 'yourCloudFunction',
  data: { /* 参数 */ }
}).then(res => {
  // ✅ 正确访问方式
  if (res.result.success) {
    console.log('数据:', res.result.data);
    console.log('消息:', res.result.message);
  } else {
    console.error('错误:', res.result.error);
  }
}).catch(err => {
  console.error('调用失败:', err);
});
```

## ⚠️ 重要：日志管理机制说明

### 📋 开发环境 vs 生产环境日志差异

微信云开发在开发环境和生产环境下的日志管理机制完全不同，了解这一点对项目部署和维护非常重要！

#### 🖥️ 开发环境日志机制

```javascript
const devEnvironment = {
  日志存储位置: "本地开发者工具 WeappLog 目录",
  存储路径: "C:\\Users\\用户名\\AppData\\Local\\微信开发者工具\\User Data\\WeappLog",
  问题原因: "本地日志文件过大导致 fs.appendFile 操作失败",
  错误提示: "log appendFile err fs_appendFile:fail the maximum size of the file storage limit is exceeded",
  解决方案: "清除开发者工具缓存（工具 → 清除缓存 → 全部清除）",
  影响范围: "仅影响开发者本人，不影响其他开发者"
};
```

#### 🌍 生产环境日志机制

```javascript
const productionEnvironment = {
  日志存储位置: "微信云开发服务器端",
  自动管理: "每条日志最长存储30天后自动清理",
  清理方式: "系统完全自动化管理，无需人工干预",
  存储限制: "不会出现存储超限问题",
  高级日志: "可开启高级日志服务进行分析和检索",
  费用说明: "高级日志服务在基础套餐外额外收费"
};
```

## 🔍 常见问题

**Q: 为什么我的时间显示不正确？**
A: 最新版本已优化时区处理。确保您使用的是最新代码，并且后端不再对时间进行格式化处理，让前端负责时区转换。

**Q: 自动确认订单功能会处理多少数据？**
A: 新版自动确认订单功能使用游标分页处理，理论上可以处理任意数量的订单数据，不会受到单次执行时间限制。


**Q: 云函数调用成功但前端获取不到数据？**
A: 请检查云函数返回格式是否符合规范，避免双重包装result字段。详见"云函数返回格式说明"章节。