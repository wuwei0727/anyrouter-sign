export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(main(env));
  },

  // 可选：留个手动触发入口，方便你浏览器访问测试
  async fetch(req, env, ctx) {
    ctx.waitUntil(main(env));
    return new Response("ok");
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
    await sendServerChan(SERVERCHAN_SENDKEY, logContent);
    return;
  }

  // ⚠️ 这里不做绕 WAF：直接用你的登录 Cookie 请求
  const headers = {
    "Content-Type": "application/json",
    "New-Api-User": NEW_API_USER,
    "Cookie": USER_COOKIE,
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

async function queryBalance(tag, url, headers, log) {
  try {
    const resp = await fetch(url, { method: "GET", headers });
    log(`${tag} HTTP ${resp.status}`);
    const data = await resp.json().catch(() => null);
    if (!data?.success) return;
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
    const msg = data?.message ?? text?.slice(0, 80);
    log(`ℹ️ 签到返回：${msg}`);
  } catch (e) {
    log(`❌ 签到异常: ${e?.message || e}`);
  }
}

async function sendServerChan(key, logContent) {
  if (!key) return;
  const title = logContent.some(l => l.includes("签到")) ? "AnyRouter 签到通知" : "AnyRouter 通知";
  const desp = logContent.join("\n\n");
  const params = new URLSearchParams({ title, desp });

  await fetch(`https://sctapi.ftqq.com/${key}.send`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  }).catch(() => {});
}
