export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(main(env));
  },

  async fetch(req, env, ctx) {
    ctx.waitUntil(main(env));
    return new Response("Task started. Check ServerChan for results.");
  },
};

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

  log(`⏰ 北京时间: ${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`);
  log("--------------------");

  if (!NEW_API_USER || !USER_COOKIE) {
    log("❌ 缺少环境变量 NEW_API_USER 或 COOKIE");
    return;
  }

  // ================= 1. WAF 绕过逻辑 (Base64 解混淆版) =================
  log("[*] 正在尝试绕过阿里云 WAF...");
  let finalCookie = USER_COOKIE;
  
  const { cookie: wafCookie, error: wafError } = await getDynamicCookieStatic(SELF_INFO_URL, USER_AGENT, log);

  if (wafError) {
    log(`❌ WAF 算号失败: ${wafError}`);
  } else if (wafCookie && wafCookie !== 'ALREADY_PASS') {
    log(`✅ WAF Token 获取成功: ${wafCookie.substring(0, 20)}...`);
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
    
    const contentType = resp.headers.get("content-type") || "";
    if (resp.status !== 200 || contentType.includes("html")) {
        const text = await resp.text();
        if(text.includes("acw_sc__v2")) {
             log(`❌ ${tag} 被 WAF 拦截 (Cookie 无效)`);
        } else {
             log(`⚠️ ${tag} 异常返回: ${text.slice(0, 60)}`);
        }
        return;
    }

    const data = await resp.json().catch(() => null);
    if (!data?.success) {
      log(`⚠️ ${tag} 接口失败: ${data?.message || "未知错误"}`);
      return;
    }
    const quota = Number(data.data.quota);
    const balance = quota / 500000;
    log(`💰 ${tag} Quota: ${quota}`);
    log(`💵 ${tag} 余额: $${balance.toFixed(2)}`);
  } catch (e) {
    log(`❌ ${tag} 请求异常: ${e?.message || e}`);
  }
}

async function signIn(url, headers, log) {
  try {
    const resp = await fetch(url, { method: "POST", headers });
    const text = await resp.text();
    log(`签到 HTTP ${resp.status}`);
    
    if (text.includes("acw_sc__v2")) {
        log(`❌ 签到请求被 WAF 拦截`);
        return;
    }

    let data = null;
    try { data = JSON.parse(text); } catch {}
    
    const msg = data?.message ?? text?.slice(0, 80);
    log(`ℹ️ 签到返回：${msg}`);
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

  const title = logContent.some(l => l.includes("✅ 签到")) ? "AnyRouter 签到成功" : "AnyRouter 通知";
  const desp = markdownLines.join("\n\n");
  const params = new URLSearchParams({ title, desp });

  await fetch(`https://sctapi.ftqq.com/${key}.send`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  }).catch((e) => console.log("推送失败", e));
}

// ================= 核心：针对性静态解密 =================

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

/**
 * 针对性解密器：直接解析混淆数组并提取 Key
 */
function solveWafSpecific(html, log) {
  try {
    // 1. 提取 arg1
    const arg1Match = html.match(/var\s+arg1\s*=\s*['"]([^'"]+)['"]/);
    if (!arg1Match) return { cookie: null, error: 'Cannot find arg1' };
    const arg1 = arg1Match[1];

    // 2. 提取大数组 (N)
    // 匹配 function a0i(){var N=['...'];a0i=...}
    const arrayBlockMatch = html.match(/var\s+N\s*=\s*\[([\s\S]*?)\];/);
    if (!arrayBlockMatch) return { cookie: null, error: 'Cannot find Array N' };
    
    // 清理并解析数组内容
    // 数组元素类似于 'mJKZmgTStNvVyq', 'C3rYAw5N'
    const rawArrayStr = arrayBlockMatch[1];
    const stringArray = rawArrayStr.split(/,\s*(?=['"])/).map(s => s.replace(/^['"]|['"]$/g, '').trim());

    // 3. 提取 Key (arg2)
    // 代码逻辑是 p = L(0x115)。偏移量通常是 0xfb (251)。
    // 0x115 (277) - 0xfb (251) = 26 (这是数组下标)
    // 但为了保险，我们不硬编码下标，而是遍历解码整个数组，找那个 40位 HEX 字符串
    
    let arg2 = null;
    
    for (const encodedStr of stringArray) {
        try {
            const decoded = decodeBase64Obfuscated(encodedStr);
            // 特征：40位 HEX，且不是 arg1
            if (decoded.length === 40 && /^[0-9a-fA-F]+$/.test(decoded) && decoded !== arg1) {
                arg2 = decoded;
                break;
            }
        } catch (e) {
            // 忽略解码错误
        }
    }

    if (!arg2) {
        // 如果解码找不到，尝试硬编码查找（假设 index 26）
        // 注意：0x115 - 0xfb = 26.
        if (stringArray.length > 26) {
             const val = decodeBase64Obfuscated(stringArray[26]);
             log(`⚠️ 尝试硬编码提取 Key: ${val}`);
             // 即使不是 40位 HEX，也试一试
             arg2 = val;
        }
    }

    if (!arg2) return { cookie: null, error: 'Cannot find decoded Key (arg2)' };

    // 4. 提取置换数组 (Mapping Array)
    // 位于: var m=[0xf,0x23,...]
    const mappingMatch = html.match(/var\s+m\s*=\s*\[((?:\s*0x[0-9a-fA-F]+,?\s*)+)\]/);
    if (!mappingMatch) return { cookie: null, error: 'Cannot find mapping array m' };
    
    const mappingArray = mappingMatch[1].split(',').map(s => parseInt(s.trim()));
    if (mappingArray.length !== 40) return { cookie: null, error: 'Mapping array length invalid' };

    // 5. 解密计算
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

/**
 * 模拟混淆代码中的 Base64 解码逻辑
 * 对应代码中的 function g(l) {...}
 */
function decodeBase64Obfuscated(l) {
    const table = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';
    let n = '';
    let o = '';
    
    // 1. 标准 Base64 解码流程
    for (let q = 0, r, s, t = 0; (s = l.charAt(t++)); ) {
        s = table.indexOf(s);
        if (s === -1) continue;
        
        r = q % 4 ? r * 64 + s : s;
        if (q++ % 4) {
            // 将解出的 24bit 数据拆分成 8bit
            // 0xff & r >> (-2 * q & 6)
            // 逻辑简化：标准 Base64 解码
            const charCode = 255 & (r >> ((-2 * q) & 6));
            if (charCode !== 0) { // 简单处理 padding
               n += String.fromCharCode(charCode);
            }
        }
    }

    // 2. URL Decode (代码逻辑: loop n -> o += %XX -> decodeURIComponent)
    for (let u = 0; u < n.length; u++) {
        let hex = n.charCodeAt(u).toString(16);
        if (hex.length < 2) hex = '0' + hex;
        o += '%' + hex;
    }
    
    try {
        return decodeURIComponent(o);
    } catch(e) {
        return n; // Fallback
    }
}
