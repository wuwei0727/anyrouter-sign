import requests

# 1. 定义基地址变量
base_url = "https://anyrouter-zamftesyrayd.wuwei0727.deno.net/api/user"

# 2. 定义完整接口路径的变量
sign_in_url = f"{base_url}/sign_in"
self_info_url = f"{base_url}/self"
NEW_API_USER="92209"
COOKIE ="session=MTc2NzQ5MjE5M3xEWDhFQVFMX2dBQUJFQUVRQUFEX3h2LUFBQVlHYzNSeWFXNW5EQWdBQm5OMFlYUjFjd05wYm5RRUFnQUNCbk4wY21sdVp3d0hBQVZuY205MWNBWnpkSEpwYm1jTUNRQUhaR1ZtWVhWc2RBWnpkSEpwYm1jTURRQUxiMkYxZEdoZmMzUmhkR1VHYzNSeWFXNW5EQTRBREVneGJHMHhVWGgxYTNSNVNnWnpkSEpwYm1jTUJBQUNhV1FEYVc1MEJBVUFfUUxRWWdaemRISnBibWNNQ2dBSWRYTmxjbTVoYldVR2MzUnlhVzVuREE4QURXeHBiblY0Wkc5Zk9USXlNRGdHYzNSeWFXNW5EQVlBQkhKdmJHVURhVzUwQkFJQUFnPT18zDt3ZOt0TEYCBd7Uc_ZxkTIRugiOFRypXqJKqe_Eiek="
# 3. 定义Headers变量（需替换为你实际的Headers值，比如New-Api-User、Cookie）
headers = {
    "New-Api-User": NEW_API_USER,
    "Cookie": COOKIE
}

session = requests.Session()
session.headers.update(headers)


def query_balance(tag: str) -> tuple[int, float]:
    """查询并打印 quota / 余额；返回 (quota, balance)."""
    resp = session.get(self_info_url, timeout=15)
    resp.raise_for_status()

    data = resp.json()
    if not data.get("success"):
        msg = data.get("message", "未知错误")
        raise RuntimeError(f"{tag} 查询失败：{msg}")

    quota = int(data["data"]["quota"])
    balance = quota / 500000

    print(f"{tag} 当前quota：{quota}")
    print(f"{tag} 当前余额：${balance:.2f}")
    return quota, balance


def sign_in() -> None:
    """执行签到并按规则打印结果。"""
    resp = session.post(sign_in_url, timeout=15)
    resp.raise_for_status()

    try:
        data = resp.json()
    except ValueError:
        # 万一服务端返回的不是 JSON
        print("签到结果：响应不是JSON：", resp.text[:200])
        return

    msg = data.get("message", "")
    # ✅ 你要求的打印规则：
    # - message 里包含“签到成功” => 打印“已签到”
    # - message 为空字符串 => 打印“已签到或签到失败”
    # - 其它 message => 原样打印（便于排错）
    if isinstance(msg, str) and ("签到成功" in msg):
        print("签到结果：已签到")
    elif msg == "":
        print("签到结果：已签到或签到失败")
    else:
        print("签到结果：", msg)


def main():
    try:
        print("正在查询签到前账户余额...")
        query_balance("签到前")

        print("\n正在执行签到请求...")
        sign_in()

        print("\n正在查询签到后账户余额...")
        query_balance("签到后")

    except requests.exceptions.RequestException as e:
        print("请求出错：", str(e))
    except Exception as e:
        print("运行出错：", str(e))


if __name__ == "__main__":
    main()
