export default {
  // 定时触发器入口
  async scheduled(event, env, ctx) {
    ctx.waitUntil(this.monitorAndNotify(env));
  },

  // HTTP 触发器入口
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 路由：查看可视化节点（带二维码）
    if (url.pathname === '/view') {
      return await this.handleView(env);
    }
    // 路由：查看纯文本节点 (TXT)
    if (url.pathname === '/txt') {
      return await this.handleTxt(env);
    }

    // 默认路由：手动触发监控发信
    await this.monitorAndNotify(env, url.origin);
    return new Response("监控检测已执行，请查看微信是否收到推送。\n\n你也可以直接访问 " + url.origin + "/view 查看节点二维码和 TXT 文本。", { 
      status: 200, 
      headers: { 'content-type': 'text/plain;charset=UTF-8' } 
    });
  },

  // 核心：获取并解析节点
  async fetchNodes(env) {
    const subUrl = "https://SOS.CMLiussss.net/auto";
    try {
      const response = await fetch(subUrl, {
        headers: { "User-Agent": "v2rayN/6.23" }
      });
      if (!response.ok) return { error: `异常 (${response.status}): ${response.statusText}` };
      
      const text = await response.text();
      let nodeList = [];
      try {
        const decoded = atob(text);
        nodeList = decoded.split('\n').filter(line => line.trim().length > 1);
      } catch (e) {
        nodeList = text.split('\n').filter(line => line.trim().length > 1);
      }
      
      nodeList = nodeList.filter(line => {
        const l = line.trim();
        return l.includes('://') && !l.includes('<') && !l.includes('function') && !l.includes('{');
      });
      
      if (nodeList.length === 0) {
         return { error: "解析失败：未发现有效节点（可能被反爬验证拦截）" };
      }
      return { nodes: nodeList };
    } catch (e) {
      return { error: "请求超时或网络错误：" + e.message.substring(0, 50) };
    }
  },

  // 渲染二维码 HTML 页面
  async handleView(env) {
    const result = await this.fetchNodes(env);
    if (result.error) {
      return new Response(result.error, { headers: { 'content-type': 'text/plain;charset=UTF-8' } });
    }

    const nodes = result.nodes;
    let html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>节点订阅列表</title>
<script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>
<style>
  body { font-family: sans-serif; padding: 15px; background: #f5f5f5; margin: 0; }
  .container { max-width: 600px; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .btn { display: inline-block; padding: 8px 15px; background: #07c160; color: white; text-decoration: none; border-radius: 5px; font-size: 14px; }
  .node-card { background: white; padding: 15px; border-radius: 8px; margin-bottom: 15px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
  .node-title { font-weight: bold; margin-bottom: 10px; color: #333; }
  .qr-container { display: flex; justify-content: center; margin: 15px 0; }
  textarea { width: 100%; height: 60px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; resize: none; box-sizing: border-box; font-size: 12px; font-family: monospace; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h2>节点列表 (${nodes.length})</h2>
    <a href="/txt" class="btn">查看 TXT 格式</a>
  </div>
  <div id="nodes"></div>
</div>
<script>
  const nodes = ${JSON.stringify(nodes)};
  const container = document.getElementById('nodes');
  
  nodes.forEach((n, i) => {
    const card = document.createElement('div');
    card.className = 'node-card';
    
    const title = document.createElement('div');
    title.className = 'node-title';
    title.innerText = '节点 ' + (i + 1);
    
    const qrDiv = document.createElement('div');
    qrDiv.className = 'qr-container';
    
    const ta = document.createElement('textarea');
    ta.readOnly = true;
    ta.value = n;
    
    card.appendChild(title);
    card.appendChild(qrDiv);
    card.appendChild(ta);
    container.appendChild(card);
    
    new QRCode(qrDiv, {
      text: n,
      width: 200,
      height: 200,
      colorDark : "#000000",
      colorLight : "#ffffff",
      correctLevel : QRCode.CorrectLevel.L
    });
  });
</script>
</body>
</html>`;
    return new Response(html, { headers: { 'content-type': 'text/html;charset=UTF-8' } });
  },

  // 渲染纯文本 TXT
  async handleTxt(env) {
    const result = await this.fetchNodes(env);
    if (result.error) {
      return new Response(result.error, { headers: { 'content-type': 'text/plain;charset=UTF-8' } });
    }
    return new Response(result.nodes.join('\n'), { headers: { 'content-type': 'text/plain;charset=UTF-8' } });
  },

  async monitorAndNotify(env, origin = null) {
    const result = await this.fetchNodes(env);
    
    let status = "正常";
    let detail = "";
    let countStr = "0";

    if (result.error) {
      status = "获取异常";
      detail = result.error;
    } else {
      countStr = result.nodes.length.toString();
      // 这里只需要发一条汇总消息，不需要发几十条了！
      detail = `成功获取 ${result.nodes.length} 个节点，请点击本卡片直接查看二维码或 TXT 文本！`;
    }

    const token = await this.getWechatToken(env);
    if (!token) {
      console.error("无法获取微信 Token，可能是环境变量未正确配置。");
      return;
    }

    // 如果是通过访问链接触发，自动拿到 worker 域名。如果是定时任务触发，则依赖环境变量 WORKER_DOMAIN
    const workerDomain = origin || env.WORKER_DOMAIN;
    let clickUrl = "https://SOS.CMLiussss.net/auto";
    if (workerDomain) {
      const base = workerDomain.endsWith('/') ? workerDomain.slice(0, -1) : workerDomain;
      clickUrl = base + "/view";
    }

    await this.sendWechatMessageWithToken(env, token, status, countStr, detail, clickUrl);
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

      const payload = {
        touser: openId,
        template_id: templateId,
        url: subUrl, // 点击微信卡片直接跳转我们的二维码网页！
        data: {
          status: { value: status, color: status.includes("正常") ? "#008000" : "#FF0000" },
          count: { value: count, color: "#173177" },
          detail: { value: detail, color: "#173177" },
          time: { value: timeStr, color: "#173177" }
        }
      };

      await fetch(sendUrl, {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" }
      });
    } catch (err) {
      console.error("微信推送异常:", err);
    }
  }
};
