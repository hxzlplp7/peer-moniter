export default {
  // 定时触发器入口 (Cron Triggers)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(this.monitorAndNotify(env));
  },

  // HTTP 触发器入口 (方便直接访问 Worker 网址来测试发信)
  async fetch(request, env, ctx) {
    await this.monitorAndNotify(env);
    return new Response("监控检测已执行，请查看微信是否收到推送。", { 
      status: 200, 
      headers: { 'content-type': 'text/plain;charset=UTF-8' } 
    });
  },

  async monitorAndNotify(env) {
    const subUrl = "https://SOS.CMLiussss.net/auto";
    let status = "获取失败";
    let nodeCount = 0;
    let detail = "";
    let nodeList = [];

    try {
      const response = await fetch(subUrl, {
        headers: {
          // 伪装成常见的订阅客户端（如 v2rayN 或 Clash），有些节点池对浏览器 UA 限制很严或被频繁拉取导致 429
          "User-Agent": "v2rayN/6.23"
        }
      });

      if (response.ok) {
        status = "正常";
        const text = await response.text();
        
        try {
          const decoded = atob(text);
          nodeList = decoded.split('\n').filter(line => line.trim().length > 1);
        } catch (e) {
          nodeList = text.split('\n').filter(line => line.trim().length > 1);
        }
        
        // --- 核心修复：过滤掉反爬虫页面的 HTML/JS 代码 ---
        // 真正的节点通常包含 "://" (如 vmess://, vless://)，且不会包含 HTML 标签或 JS 关键字
        nodeList = nodeList.filter(line => {
          const l = line.trim();
          return l.includes('://') && !l.includes('<') && !l.includes('function') && !l.includes('{');
        });
        
        nodeCount = nodeList.length;
        if (nodeCount > 0) {
          detail = `成功获取 ${nodeCount} 个节点，即将逐条发送...`;
        } else {
          // 如果解析后没有节点，说明获取到的是防爬虫验证页面（CF五盾）
          status = "被反爬拦截";
          detail = "获取失败：链接返回的是网页验证代码（可能触发了防机器人验证），无法解析出有效节点。";
        }
      } else {
        status = `异常 (${response.status})`;
        detail = response.statusText;
      }
    } catch (error) {
      status = "请求超时或网络错误";
      detail = error.message.substring(0, 50); 
    }

    // 1. 获取微信 Access Token（避免在循环中重复获取）
    const token = await this.getWechatToken(env);
    if (!token) {
      console.error("无法获取微信 Token，可能是环境变量未正确配置。");
      return;
    }

    // 2. 先发送一条汇总结果消息
    await this.sendWechatMessageWithToken(env, token, status, nodeCount.toString(), detail, subUrl);

    // 3. 将节点逐条发送过来
    if (nodeList.length > 0) {
      // 限制每次最多只发前 80 个节点，防止节点过多导致微信消息轰炸或 Cloudflare 运行超时
      const maxSend = Math.min(nodeList.length, 80);
      for (let i = 0; i < maxSend; i++) {
        const nodeStr = nodeList[i];
        await this.sendWechatMessageWithToken(
          env, 
          token, 
          `推送节点 ${i + 1}/${maxSend}`, 
          "-", 
          nodeStr, 
          subUrl
        );
        // 等待 50 毫秒，防止由于并发太高触发微信接口限流
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
  },

  async getWechatToken(env) {
    const appId = env.WECHAT_APPID;
    const appSecret = env.WECHAT_APPSECRET;
    if (!appId || !appSecret) return null;

    try {
      const tokenUrl = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`;
      const tokenRes = await fetch(tokenUrl);
      const tokenData = await tokenRes.json();
      return tokenData.access_token || null;
    } catch (err) {
      console.error("获取 Access Token 异常:", err);
      return null;
    }
  },

  async sendWechatMessageWithToken(env, token, status, count, detail, subUrl) {
    const openId = env.WECHAT_OPENID;
    const templateId = env.WECHAT_TEMPLATE_ID;

    if (!openId || !templateId) return;

    try {
      const sendUrl = `https://api.weixin.qq.com/cgi-bin/message/template/send?access_token=${token}`;
      const timeStr = new Date(new Date().getTime() + 8 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 19);

      // 如果单条节点超级长，为了兼容微信接口对字符长度的限制，适当截断
      const safeDetail = detail.length > 200 ? detail.substring(0, 200) + "..." : detail;

      const payload = {
        touser: openId,
        template_id: templateId,
        url: subUrl,
        data: {
          status: { value: status, color: status.includes("正常") ? "#008000" : "#FF0000" },
          count: { value: count, color: "#173177" },
          detail: { value: safeDetail, color: "#173177" },
          time: { value: timeStr, color: "#173177" }
        }
      };

      await fetch(sendUrl, {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" }
      });
    } catch (err) {
      console.error("微信单条推送异常:", err);
    }
  }
};
