/**
 * AnyRouter 自动签到脚本 (Node.js 版)
 * 功能：自动过阿里云 WAF 盾 -> 查询余额 -> 签到 -> 推送消息
 */

const fs = require('fs');

// ================= 配置区 =================
const BASE_URL = "https://anyrouter.top";
const SIGN_IN_URL = `${BASE_URL}/api/user/sign_in`;
const SELF_INFO_URL = `${BASE_URL}/api/user/self`;

// 必须保持一致的 User-Agent
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 环境变量
const NEW_API_USER = process.env.NEW_API_USER;
const USER_COOKIE = process.env.COOKIE;
const WXPUSHER_APP_TOKEN = process.env.WXPUSHER_APP_TOKEN;
const WXPUSHER_UID = process.env.WXPUSHER_UID;

// 日志存储
const logContent = [];

function log(content) {
  console.log(content);
  logContent.push(content);
}

// ================= 主逻辑 =================

async function main() {
  log(`⏰ 北京时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
  log("-".repeat(20));

  // 1. 检查环境变量
  if (!NEW_API_USER || !USER_COOKIE) {
    log("❌ 错误：未检测到环境变量 NEW_API_USER 或 COOKIE");
    await sendWxPusherNotification();
    process.exit(1);
  }

  try {
    // 2. 获取 WAF 动态 Cookie
    log("[*] 正在绕过 WAF 盾获取动态 Token...");
    const { cookie: wafCookie, error } = await getDynamicCookie(SELF_INFO_URL);
    
    if (!wafCookie) {
      log(`❌ WAF 验证失败: ${error}`);
      await sendWxPusherNotification();
      process.exit(1);
    }
    log(`✅ WAF Token 获取成功: ${wafCookie.split(';')[0]}`);

    // 3. 构造通用 Headers
    // 将 WAF cookie 和 用户登录 cookie 合并
    const finalCookie = `${wafCookie}; ${USER_COOKIE}`;
    
    const headers = {
        "Content-Type": "application/json",
        "New-Api-User": NEW_API_USER,
        "Cookie": finalCookie,
        "User-Agent": USER_AGENT,
        "Origin": BASE_URL,
        "Referer": BASE_URL + "/"
    };

    // 4. 执行业务流程
    await queryBalance("签到前", headers);
    log("-".repeat(20));
    await signIn(headers);
    log("-".repeat(20));
    await queryBalance("签到后", headers);

  } catch (e) {
    log(`❌ 脚本执行发生未捕获异常: ${e.message}`);
    console.error(e);
  } finally {
    // 5. 发送通知
    await sendWxPusherNotification();
  }
}

// ================= 业务函数 =================

async function queryBalance(tag, headers) {
  try {
    const resp = await fetch(SELF_INFO_URL, { method: "GET", headers });
    
    if (!resp.ok) {
      log(`❌ ${tag} 请求失败: HTTP ${resp.status}`);
      return;
    }

    const data = await resp.json();
    if (!data.success) {
      log(`❌ ${tag} 接口返回错误: ${data.message || "未知错误"}`);
      return;
    }

    const quota = parseInt(data.data.quota);
    const balance = quota / 500000;

    log(`💰 ${tag} Quota: ${quota}`);
    log(`💵 ${tag} 余额: $${balance.toFixed(2)}`);

  } catch (e) {
    log(`❌ ${tag} 查询异常: ${e.message}`);
  }
}

async function signIn(headers) {
  try {
    const resp = await fetch(SIGN_IN_URL, { method: "POST", headers });
    
    if (!resp.ok) {
      log(`❌ 签到请求失败: HTTP ${resp.status}`);
      return;
    }

    const text = await resp.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      log(`❌ 签到响应非 JSON: ${text.substring(0, 50)}`);
      return;
    }

    const msg = data.message || "";
    if (typeof msg === "string" && msg.includes("签到成功")) {
      log("✅ 签到结果：已签到");
    } else if (msg === "") {
      log("⚠️ 签到结果：可能已签到 (无返回消息)");
    } else {
      log(`ℹ️ 签到结果：${msg}`);
    }

  } catch (e) {
    log(`❌ 签到请求异常: ${e.message}`);
  }
}

async function sendWxPusherNotification() {
  if (!WXPUSHER_APP_TOKEN || !WXPUSHER_UID) {
    console.log("⚠️ 未配置 WxPusher 参数，跳过推送");
    return;
  }

  // 格式化 HTML 内容
  const linesHtml = logContent.map(line => {
    if (line.includes("✅")) return `<span style="color:green;">${line}</span>`;
    if (line.includes("❌")) return `<span style="color:red;">${line}</span>`;
    if (line.includes("💰") || line.includes("💵")) return `<span style="color:orange;">${line}</span>`;
    return line;
  });

  const body = {
    appToken: WXPUSHER_APP_TOKEN,
    content: linesHtml.join("<br>"),
    summary: "AnyRouter 签到结果通知",
    contentType: 2, // HTML
    uids: [WXPUSHER_UID]
  };

  try {
    const resp = await fetch("http://wxpusher.zjiecode.com/api/send/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const resJson = await resp.json();
    if (resJson.code === 1000) {
      console.log("✅ WxPusher 推送发送成功");
    } else {
      console.log(`❌ WxPusher 发送失败: ${resJson.msg}`);
    }
  } catch (e) {
    console.log(`❌ 发送通知异常: ${e.message}`);
  }
}

// ================= WAF 解密逻辑 =================

async function getDynamicCookie(targetUrl) {
  try {
    // 第一次请求，获取含混淆JS的HTML
    const challengeResp = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    const html = await challengeResp.text();
    
    // 如果没有 script 且是 JSON，说明可能不需要盾
    if (!html.includes('<script')) {
       return { cookie: 'ALREADY_PASS', error: null };
    }

    return extractCookieFromHtml(html);
  } catch (err) {
    return { cookie: null, error: String(err) };
  }
}

function extractCookieFromHtml(html) {
  // 匹配内联 script
  const scriptRegex = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi;
  const scripts = [...html.matchAll(scriptRegex)];
  
  if (!scripts.length) return { cookie: null, error: 'no inline <script> tags found' };

  let lastError = null;
  for (const match of scripts) {
    const scriptContent = match[1];
    // 阿里云 WAF 特征：包含 arg1 或 eval
    if (scriptContent.includes('arg1') || scriptContent.includes('eval') || scriptContent.length > 500) {
        const { cookie, error } = executeScriptForCookie(scriptContent);
        if (cookie) return { cookie, error: null };
        lastError = error;
    }
  }
  return { cookie: null, error: lastError || 'no cookie produced' };
}

function executeScriptForCookie(scriptContent) {
  let cookieValue = null;

  // --- 模拟浏览器环境 ---
  // Node.js 没有 window/document，必须手动 Mock 
  // 这里的对象属性是根据 WAF 脚本的检测点反推出来的
  const windowMock = {};
  const documentMock = {
    _cookie: '',
    set cookie(val) {
      if (val.includes('acw_sc__v2')) {
        cookieValue = val.split(';')[0];
      }
    },
    get cookie() { return this._cookie; },
    location: { reload() {}, href: 'http://anyrouter.top/', protocol: 'http:', host: 'anyrouter.top' },
    addEventListener: () => {},
    attachEvent: () => {},
  };
  const navigatorMock = { 
      userAgent: USER_AGENT, 
      appVersion: '5.0 (Windows)', 
      webdriver: false 
  };
  const screenMock = { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040, colorDepth: 24 };

  try {
    // 使用 new Function 创建沙箱环境
    // 注意：我们将 Mock 对象作为参数传入，模拟全局变量
    const run = new Function('window', 'document', 'location', 'navigator', 'screen', `
      try { 
        ${scriptContent} 
      } catch(e) { 
        // 忽略脚本执行中的非关键错误
      }
    `);
    
    // 处理循环引用
    windowMock.window = windowMock;
    windowMock.document = documentMock;
    windowMock.location = documentMock.location;
    windowMock.navigator = navigatorMock;
    windowMock.screen = screenMock;

    run(windowMock, documentMock, documentMock.location, navigatorMock, screenMock);
  } catch (err) {
    return { cookie: null, error: 'Eval error: ' + String(err) };
  }

  if (cookieValue) {
    return { cookie: cookieValue, error: null };
  }
  return { cookie: null, error: 'script executed but cookie not set' };
}

// 启动
main();
