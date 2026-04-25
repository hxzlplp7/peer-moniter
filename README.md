# 节点订阅微信监控推送脚本

利用 Cloudflare Workers 的 Cron Triggers（定时触发器）结合微信测试公众号的模板消息接口，实现定时、主动向微信推送节点订阅监控状态。

## 部署流程

### 第一步：微信测试号准备工作

1. **申请微信测试号**：前往 [微信公众平台接口测试帐号申请](https://mp.weixin.qq.com/debug/cgi-bin/sandbox?t=sandbox/login)，扫码登录。
2. **获取凭证**：在页面上方找到 `appID` 和 `appsecret`，保存备用。
3. **获取你的 OpenID**：在页面下方找到“测试号二维码”，用你的微信扫码关注。关注后，右侧的用户列表里会显示你的微信号和对应的 `OpenID`（一长串字符），保存备用。
4. **新增测试模板**：
   - 找到“模板消息接口”，点击“新增测试模板”。
   - 模板标题可以填：`节点订阅监控提醒`
   - 模板内容**严格按照以下格式**填写（注意换行和花括号）：
     ```text
     订阅状态：{{status.DATA}}
     节点数量：{{count.DATA}}
     详情说明：{{detail.DATA}}
     监控时间：{{time.DATA}}
     ```
   - 提交后，你会获得一个 `模板 ID` (Template ID)，保存备用。

### 第二步：Cloudflare Workers 部署

1. 登录 Cloudflare 控制台，进入 **Workers & Pages**，点击 **Create Application** -> **Create Worker**。
2. 为你的 Worker 取个名字（如 `sub-monitor`），点击 Deploy。
3. 点击 **Edit code**，将本项目中的 `worker.js` 的所有代码复制并替换进去。点击右上角的 **Deploy**。
4. 点击左上角返回该 Worker 的管理详情页。

### 第三步：配置环境变量和定时触发器

1. **设置环境变量**：
   - 导航到 **Settings** -> **Variables and Secrets**。
   - 点击 **Add Variable**，添加以下四个变量（Type 选 `Text` 即可）：
     - `WECHAT_APPID` : 填入测试号的 appID
     - `WECHAT_APPSECRET` : 填入测试号的 appsecret
     - `WECHAT_OPENID` : 填入你的 OpenID
     - `WECHAT_TEMPLATE_ID` : 填入模板 ID
   - 保存部署。

2. **初步测试**：
   - 回到 Worker 详情页上方，找到 `https://xxxx.workers.dev` 形式的链接，直接在浏览器中访问它。
   - 如果页面返回“监控检测已执行...”，此时你的微信应该已经收到了一条测试公众号推送的消息！

3. **设置定时触发 (Cron Triggers)**：
   - 导航到 **Triggers** 选项卡。
   - 找到 **Cron Triggers**，点击 **Add Cron Trigger**。
   - 选择你需要执行监控的频率，例如：
     - `0 8 * * *` （每天早上 8 点触发一次）
     - `0 */4 * * *` （每 4 小时触发一次）
   - 点击 Add 保存即可完成全部配置！
