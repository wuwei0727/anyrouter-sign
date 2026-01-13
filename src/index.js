export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(main(env));
  },

  // 手动触发入口
  async fetch(req, env, ctx) {
    ctx.waitUntil(main(env));
    return new Response("Task started. Check ServerChan for results.");
  },
};

async function main(env) {
  const BASE_URL = "https://anyrouter.top";
  const SIGN_IN_URL = `${BASE_URL}/api/user/sign_in`;
  const SELF_INFO_URL = `${BASE_URL}/api/user/self`;
  // 保持 UA 一致，这对于过 WAF 很重要
  const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  const NEW_API_USER = env.NEW_API_USER;
  const USER_COOKIE = env.COOKIE;
  const SERVERCHAN_SENDKEY = env.SERVERCHAN_SENDKEY;

  const logContent = [];
  const log = (s) => {
    console.log(s);
    logContent.push(String(s));
  };

  log(`⏰ 北京时间: ${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`);
  log("--------------------");

  if (!NEW_API_USER || !USER_COOKIE) {
    log("❌ 缺少环境变量 NEW_API_USER 或 COOKIE");
    await sendServerChan(SERVERCHAN_SENDKEY, logContent);
    return;
  }

  // ================= 1. WAF 绕过逻辑开始 =================
  log("[*] 正在尝试绕过阿里云 WAF...");
  let finalCookie = USER_COOKIE;
  
  // 尝试获取 WAF cookie
  const { cookie: wafCookie, error: wafError } = await getDynamicCookie(SELF_INFO_URL, USER_AGENT);

  if (wafError) {
    log(`❌ WAF 验证失败: ${wafError}`);
    // 如果 WAF 失败，根据情况决定是否终止。通常拿不到 WAF cookie 后续必挂，但也可能运气好直接通了。
    // 这里选择记录错误但继续尝试（使用原始 cookie）
  } else if (wafCookie && wafCookie !== 'ALREADY_PASS') {
    log(`✅ WAF Token 获取成功: ${wafCookie.substring(0, 15)}...`);
    // 合并 Cookie
    finalCookie = `${wafCookie}; ${USER_COOKIE}`;
  } else {
    log("✅ 无需 WAF 验证或已通过");
  }
  // ================= WAF 绕过逻辑结束 =================

  const headers = {
    "Content-Type": "application/json",
    "New-Api-User": NEW_API_USER,
    "Cookie": finalCookie, // 使用合并后的 Cookie
    "User-Agent": USER_AGENT,
    "Origin": BASE_URL,
    "Referer": BASE_URL + "/",
  };

  await queryBalance("签到前", SELF_INFO_URL, headers, log);
  log("--------------------");
  await signIn(SIGN_IN_URL, headers, log);
  log("--------------------");
  await queryBalance("签到后", SELF_INFO_URL, headers, log);

  await sendServerChan(SERVERCHAN_SENDKEY, logContent);
}

// ================= 业务函数 =================

async function queryBalance(tag, url, headers, log) {
  try {
    const resp = await fetch(url, { method: "GET", headers });
    log(`${tag} HTTP ${resp.status}`);
    
    // 如果返回 405/403，说明 WAF 可能没过
    if (resp.status === 405 || resp.status === 403) {
      const text = await resp.text();
      log(`❌ ${tag} 被拦截 (WAF?): ${text.slice(0, 50)}`);
      return;
    }

    const data = await resp.json().catch(() => null);
    if (!data?.success) {
      log(`⚠️ ${tag} 接口未成功: ${data?.message || "未知错误"}`);
      return;
    }
    const quota = Number(data.data.quota);
    const balance = quota / 500000;
    log(`💰 ${tag} Quota: ${quota}`);
    log(`💵 ${tag} 余额: $${balance.toFixed(2)}`);
  } catch (e) {
    log(`❌ ${tag} 查询异常: ${e?.message || e}`);
  }
}

async function signIn(url, headers, log) {
  try {
    const resp = await fetch(url, { method: "POST", headers });
    const text = await resp.text();
    log(`签到 HTTP ${resp.status}`);
    let data = null;
    try { data = JSON.parse(text); } catch {}
    
    // 优先取 message，如果没有则截取部分 body
    const msg = data?.message ?? text?.slice(0, 80);
    log(`ℹ️ 签到返回：${msg}`);
  } catch (e) {
    log(`❌ 签到异常: ${e?.message || e}`);
  }
}

async function sendServerChan(key, logContent) {
  if (!key) return;
  // 简单的 Markdown 格式化
  const markdownLines = logContent.map(line => {
      if (line.includes("✅")) return `**${line}**`;
      if (line.includes("❌")) return `**${line}**`;
      if (line.includes("💰") || line.includes("💵")) return `\`${line}\``;
      return line;
  });

  const title = logContent.some(l => l.includes("✅ 签到")) ? "AnyRouter 签到成功" : "AnyRouter 通知";
  const desp = markdownLines.join("\n\n");
  const params = new URLSearchParams({ title, desp });

  await fetch(`https://sctapi.ftqq.com/${key}.send`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  }).catch((e) => console.log("推送失败", e));
}

// ================= WAF 解密核心逻辑 (移植版) =================

async function getDynamicCookie(targetUrl, userAgent) {
  try {
    const challengeResp = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    // 如果直接请求成功（200且是JSON），说明没盾，或者是API数据
    // 注意：有时候 WAF 也会返回 200，但 Content-Type 是 html
    const contentType = challengeResp.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        return { cookie: 'ALREADY_PASS', error: null };
    }

    const html = await challengeResp.text();
    if (!html.includes('<script')) {
       // 没有脚本，可能是已经过了或者报错
       return { cookie: 'ALREADY_PASS', error: null };
    }
    return extractCookieFromHtml(html, userAgent);
  } catch (err) {
    return { cookie: null, error: String(err) };
  }
}

function extractCookieFromHtml(html, userAgent) {
  const scriptRegex = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi;
  const scripts = [...html.matchAll(scriptRegex)];
  
  if (!scripts.length) return { cookie: null, error: 'no inline <script> tags found' };

  let lastError = null;
  for (const match of scripts) {
    const scriptContent = match[1];
    // 阿里云 WAF 特征
    if (scriptContent.includes('arg1') || scriptContent.includes('eval') || scriptContent.length > 500) {
        const { cookie, error } = executeScriptForCookie(scriptContent, userAgent);
        if (cookie) return { cookie, error: null };
        lastError = error;
    }
  }
  return { cookie: null, error: lastError || 'no cookie produced' };
}

function executeScriptForCookie(scriptContent, userAgent) {
  let cookieValue = null;
  
  // 模拟浏览器环境
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
      userAgent: userAgent, 
      appVersion: '5.0 (Windows)', 
      webdriver: false 
  };
  const screenMock = { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040, colorDepth: 24 };

  try {
    // 使用 new Function 执行 WAF 混淆代码
    const run = new Function('window', 'document', 'location', 'navigator', 'screen', `
      try { 
        ${scriptContent} 
      } catch(e) { }
    `);
    
    // 绑定 Mock 对象
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
