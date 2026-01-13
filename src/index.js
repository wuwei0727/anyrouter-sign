export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(main(env));
  },

  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname.includes("favicon.ico")) {
      return new Response(null, { status: 204 });
    }
    ctx.waitUntil(main(env));
    return new Response("Task started.", {
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  },
};

// 辅助工具：静默等待
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(env) {
  const BASE_URL = "https://anyrouter.top";
  const SIGN_IN_URL = `${BASE_URL}/api/user/sign_in`;
  const SELF_INFO_URL = `${BASE_URL}/api/user/self`;
  
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

  log(`* 正在尝试绕过阿里云 WAF...`); 

  if (!NEW_API_USER || !USER_COOKIE) {
    log("❌ 缺少环境变量 NEW_API_USER 或 COOKIE");
    return;
  }

  // ================= 1. WAF 绕过逻辑 =================
  let finalCookie = USER_COOKIE;
  
  const { cookie: wafCookie, error: wafError } = await getDynamicCookieStatic(SELF_INFO_URL, USER_AGENT, log);

  if (wafError) {
    log(`❌ WAF 算号失败: ${wafError}`);
  } else if (wafCookie && wafCookie !== 'ALREADY_PASS') {
    log(`✅ WAF Token 获取成功: ${wafCookie}`);
    finalCookie = `${wafCookie}; ${USER_COOKIE}`;
  } else {
    log("✅ 无需 WAF 验证或已通过");
  }

  const headers = {
    "Content-Type": "application/json",
    "New-Api-User": NEW_API_USER,
    "Cookie": finalCookie,
    "User-Agent": USER_AGENT,
    "Origin": BASE_URL,
    "Referer": BASE_URL + "/",
  };

  // 【核心修改】拿到 Token 后死等 3 秒，防止第一发请求被拦截
  await sleep(3000);

  // ================= 2. 执行业务 =================
  
  // 1. 签到前查询 (带一次重试机制)
  let preBalanceSuccess = await queryBalance("签到前", SELF_INFO_URL, headers, log, false); 
  if (!preBalanceSuccess) {
      // 如果第一次失败，静默等待 2 秒再试一次
      await sleep(2000);
      await queryBalance("签到前", SELF_INFO_URL, headers, log, true); // forceLog=true，强制输出结果
  }
  
  await sleep(2000); // 间隔

  // 2. 执行签到
  await signIn(SIGN_IN_URL, headers, log);
  
  await sleep(2000); // 间隔

  // 3. 签到后查询
  await queryBalance("签到后", SELF_INFO_URL, headers, log, true);

  await sendServerChan(SERVERCHAN_SENDKEY, logContent);
}

// ================= 业务函数 =================

/**
 * forceLog: 是否强制记录日志。
 * 第一遍尝试时如果失败不记录日志（防止出现红叉），重试时才记录。
 * 成功时永远记录。
 */
async function queryBalance(tag, url, headers, log, forceLog = true) {
  try {
    const resp = await fetch(url, { method: "GET", headers });
    const text = await resp.text();
    
    // WAF 拦截判断
    if (text.includes("acw_sc__v2") && text.includes("arg1")) {
         if (forceLog) log(`❌ ${tag} 被 WAF 拦截 (Cookie 无效)`);
         return false;
    }

    let data = null;
    try { data = JSON.parse(text); } catch {}

    if (data && data.success) {
        const quota = Number(data.data.quota);
        const balance = quota / 500000;
        // 成功时总是输出
        log(`💰 ${tag} Quota: ${quota}`);
        log(`💵 ${tag} 余额: $${balance.toFixed(2)}`);
        return true;
    } else {
        if (forceLog) {
            if (resp.status !== 200) {
                log(`⚠️ ${tag} 接口异常 (HTTP ${resp.status}): ${text.slice(0, 50)}`);
            }
        }
        return false;
    }
  } catch (e) {
    if (forceLog) log(`❌ ${tag} 请求异常: ${e?.message || e}`);
    return false;
  }
}

async function signIn(url, headers, log) {
  try {
    const resp = await fetch(url, { method: "POST", headers });
    const text = await resp.text();
    
    if (text.includes("acw_sc__v2") && text.includes("arg1")) {
        log(`❌ 签到请求被 WAF 拦截`);
        return;
    }

    let data = null;
    try { data = JSON.parse(text); } catch {}
    
    const msg = data?.message || "";

    if (msg === "" && resp.status === 200) {
      log("✅ 签到结果：签到成功 (无返回消息)");
    } else if (typeof msg === "string" && msg.includes("签到成功")) {
      log("✅ 签到结果：已签到");
    } else {
      // 包含“重复签到”等
      log(`⚠️ 签到结果：${msg || "未知状态"}`);
    }
  } catch (e) {
    log(`❌ 签到异常: ${e?.message || e}`);
  }
}

async function sendServerChan(key, logContent) {
  if (!key) return;
  const markdownLines = logContent.map(line => {
      if (line.includes("✅")) return `**${line}**`;
      if (line.includes("❌")) return `**${line}**`;
      if (line.includes("💰") || line.includes("💵")) return `\`${line}\``;
      return line;
  });

  const title = logContent.some(l => l.includes("✅") || l.includes("签到成功")) ? "AnyRouter 签到成功" : "AnyRouter 执行通知";
  const desp = markdownLines.join("\n\n");
  const params = new URLSearchParams({ title, desp });

  await fetch(`https://sctapi.ftqq.com/${key}.send`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  }).catch((e) => console.log("推送失败", e));
}

// ================= 核心：WAF 解密 (保持不变) =================

async function getDynamicCookieStatic(targetUrl, userAgent, log) {
  try {
    const challengeResp = await fetch(targetUrl, {
      method: 'GET',
      headers: { 'User-Agent': userAgent, 'Accept': 'text/html' },
    });
    const html = await challengeResp.text();
    if (!html.includes('acw_sc__v2') && !html.includes('arg1')) {
       return { cookie: 'ALREADY_PASS', error: null };
    }
    return solveWafSpecific(html, log);
  } catch (err) {
    return { cookie: null, error: String(err) };
  }
}

function solveWafSpecific(html, log) {
  try {
    const arg1Match = html.match(/var\s+arg1\s*=\s*['"]([^'"]+)['"]/);
    if (!arg1Match) return { cookie: null, error: 'Cannot find arg1' };
    const arg1 = arg1Match[1];
    const arrayBlockMatch = html.match(/var\s+N\s*=\s*\[([\s\S]*?)\];/);
    if (!arrayBlockMatch) return { cookie: null, error: 'Cannot find Array N' };
    const rawArrayStr = arrayBlockMatch[1];
    const stringArray = rawArrayStr.split(/,\s*(?=['"])/).map(s => s.replace(/^['"]|['"]$/g, '').trim());
    let arg2 = null;
    for (const encodedStr of stringArray) {
        try {
            const decoded = decodeBase64Obfuscated(encodedStr);
            if (decoded.length === 40 && /^[0-9a-fA-F]+$/.test(decoded) && decoded !== arg1) {
                arg2 = decoded;
                break;
            }
        } catch (e) {}
    }
    if (!arg2) {
        if (stringArray.length > 26) arg2 = decodeBase64Obfuscated(stringArray[26]);
    }
    if (!arg2) return { cookie: null, error: 'Cannot find decoded Key (arg2)' };
    const mappingMatch = html.match(/var\s+m\s*=\s*\[((?:\s*0x[0-9a-fA-F]+,?\s*)+)\]/);
    if (!mappingMatch) return { cookie: null, error: 'Cannot find mapping array m' };
    const mappingArray = mappingMatch[1].split(',').map(s => parseInt(s.trim()));
    let permutedStr = "";
    for (let i = 0; i < mappingArray.length; i++) {
        const index = mappingArray[i] - 1; 
        if (index >= 0 && index < arg1.length) permutedStr += arg1[index];
        else permutedStr += arg1[i] || "";
    }
    let result = "";
    for (let i = 0; i < permutedStr.length && i < arg2.length; i += 2) {
        const v1 = parseInt(permutedStr.slice(i, i + 2), 16);
        const v2 = parseInt(arg2.slice(i, i + 2), 16);
        const xorVal = v1 ^ v2;
        result += (xorVal < 16 ? '0' : '') + xorVal.toString(16);
    }
    return { cookie: `acw_sc__v2=${result}`, error: null };
  } catch (e) {
    return { cookie: null, error: 'Specific solve failed: ' + e.message };
  }
}

function decodeBase64Obfuscated(l) {
    const table = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';
    let n = '';
    let o = '';
    for (let q = 0, r, s, t = 0; (s = l.charAt(t++)); ) {
        s = table.indexOf(s);
        if (s === -1) continue;
        r = q % 4 ? r * 64 + s : s;
        if (q++ % 4) {
            const charCode = 255 & (r >> ((-2 * q) & 6));
            if (charCode !== 0) n += String.fromCharCode(charCode);
        }
    }
    for (let u = 0; u < n.length; u++) {
        let hex = n.charCodeAt(u).toString(16);
        if (hex.length < 2) hex = '0' + hex;
        o += '%' + hex;
    }
    try { return decodeURIComponent(o); } catch(e) { return n; }
}
