import requests
import os
import sys
import datetime

# ================= 配置区 =================
# 1. 基础接口配置
BASE_URL = "https://anyrouter-zamftesyrayd.wuwei0727.deno.net/api/user"
SIGN_IN_URL = f"{BASE_URL}/sign_in"
SELF_INFO_URL = f"{BASE_URL}/self"

# 2. 从环境变量获取敏感信息
NEW_API_USER = os.getenv("NEW_API_USER")
COOKIE = os.getenv("COOKIE")

# WxPusher 配置
WXPUSHER_APP_TOKEN = os.getenv("WXPUSHER_APP_TOKEN")
WXPUSHER_UID = os.getenv("WXPUSHER_UID")

# 全局日志列表
log_content = []

def log(content: str):
    """同时打印到控制台和添加到日志列表"""
    print(content)
    log_content.append(content)

def check_env():
    if not NEW_API_USER or not COOKIE:
        log("❌ 错误：未检测到环境变量 NEW_API_USER 或 COOKIE")
        sys.exit(1)

# 初始化 Session
headers = {
    "New-Api-User": NEW_API_USER,
    "Cookie": COOKIE,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36"
}
session = requests.Session()
session.headers.update(headers)

def send_wxpusher_notification():
    """发送 WxPusher 微信通知"""
    if not WXPUSHER_APP_TOKEN or not WXPUSHER_UID:
        print("⚠️ 未配置 WxPusher 参数，跳过微信推送")
        return

    # 1. 处理日志格式 (HTML)
    # 将日志列表拼接，换行符转为 <br>，加一点简单的颜色样式
    lines_html = []
    for line in log_content:
        if "✅" in line:
            lines_html.append(f'<span style="color:green;">{line}</span>')
        elif "❌" in line:
            lines_html.append(f'<span style="color:red;">{line}</span>')
        elif "💰" in line or "💵" in line:
            lines_html.append(f'<span style="color:orange;">{line}</span>')
        else:
            lines_html.append(line)
            
    content_html = "<br>".join(lines_html)
    
    # 2. 构造请求数据
    url = "http://wxpusher.zjiecode.com/api/send/message"
    
    body = {
        "appToken": WXPUSHER_APP_TOKEN,
        "content": content_html,
        "summary": "AnyRouter 签到结果通知", # 消息摘要，显示在列表里
        "contentType": 2, # 2表示HTML
        "uids": [WXPUSHER_UID]
    }
    
    # 3. 发送
    try:
        resp = requests.post(url, json=body)
        res_json = resp.json()
        if res_json.get("code") == 1000:
            print("✅ WxPusher 推送发送成功")
        else:
            print(f"❌ WxPusher 发送失败: {res_json.get('msg')}")
    except Exception as e:
        print(f"❌ 发送通知异常: {e}")

def query_balance(tag: str) -> tuple[int, float]:
    try:
        resp = session.get(SELF_INFO_URL, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        
        if not data.get("success"):
            msg = data.get("message", "未知错误")
            log(f"❌ {tag} 查询失败：{msg}")
            return 0, 0.0

        quota = int(data["data"]["quota"])
        balance = quota / 500000
        
        log(f"💰 {tag} Quota: {quota}")
        log(f"💵 {tag} 余额: ${balance:.2f}")
        return quota, balance
    except Exception as e:
        log(f"❌ {tag} 查询异常: {e}")
        return 0, 0.0

def sign_in():
    try:
        resp = session.post(SIGN_IN_URL, timeout=15)
        resp.raise_for_status()
        try:
            data = resp.json()
        except ValueError:
            log(f"❌ 签到响应非JSON: {resp.text[:50]}")
            return

        msg = data.get("message", "")
        if isinstance(msg, str) and ("签到成功" in msg):
            log("✅ 签到结果：已签到")
        elif msg == "":
            log("⚠️ 签到结果：可能已签到 (无返回消息)")
        else:
            log(f"ℹ️ 签到结果：{msg}")
            
    except Exception as e:
        log(f"❌ 签到请求异常: {e}")

def main():
    check_env()
    
    # 记录时间
    now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8)))
    log(f"⏰ 北京时间: {now.strftime('%Y-%m-%d %H:%M:%S')}")
    log("-" * 20)

    # 流程
    query_balance("签到前")
    log("-" * 20)
    sign_in()
    log("-" * 20)
    query_balance("签到后")
    
    # 发送通知
    send_wxpusher_notification()

if __name__ == "__main__":
    main()
