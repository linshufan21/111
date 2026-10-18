"""用本机 Edge 截取关键页面，兼作一次冒烟测试。"""
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8787"
OUT = Path(__file__).resolve().parent.parent / "screenshots"
OUT.mkdir(exist_ok=True)


def main() -> None:
    errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)

        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, locale="zh-CN")
        page = ctx.new_page()
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda exc: errors.append(str(exc)))

        page.goto(f"{BASE}/", wait_until="networkidle")
        page.screenshot(path=str(OUT / "home-anon.png"), full_page=False)

        page.goto(f"{BASE}/login", wait_until="networkidle")
        page.get_by_role("button", name="用体验账号进入（demo / demo1234）").click()
        page.wait_for_url(f"{BASE}/", timeout=10000)
        page.wait_for_load_state("networkidle")
        page.screenshot(path=str(OUT / "home.png"))

        page.locator(".qcard:has(.qcard-report) .qcard-title a").first.click()
        page.wait_for_load_state("networkidle")
        page.screenshot(path=str(OUT / "detail.png"))

        # 举报弹窗与我的举报
        page.get_by_role("button", name="举报这个问题").click()
        page.locator("dialog[open]").wait_for(state="visible", timeout=8000)
        page.screenshot(path=str(OUT / "report.png"))
        page.locator("input[value='spam']").check()
        page.get_by_label("补充说明（可选）").fill("这条内容像是在反复发广告。")
        page.get_by_role("button", name="提交举报").click()
        expect_toast = page.locator(".toast")
        expect_toast.wait_for(state="visible", timeout=8000)
        page.screenshot(path=str(OUT / "report-submitted.png"))
        page.goto(f"{BASE}/me?tab=reports", wait_until="networkidle")
        page.locator(".report-item").first.wait_for(state="visible", timeout=8000)
        page.wait_for_timeout(2600)
        page.screenshot(path=str(OUT / "my-reports.png"))

        page.goto(f"{BASE}/me", wait_until="networkidle")
        page.screenshot(path=str(OUT / "me.png"))

        # 账号设置与注销确认
        page.goto(f"{BASE}/settings", wait_until="networkidle")
        page.locator(".session-current").wait_for(state="visible", timeout=8000)
        page.screenshot(path=str(OUT / "settings.png"))
        page.locator("#email").evaluate("el => el.scrollIntoView({block: 'start'})")
        page.wait_for_timeout(300)
        page.screenshot(path=str(OUT / "settings-email.png"))
        page.locator("#security").evaluate("el => el.scrollIntoView({block: 'start'})")
        page.wait_for_timeout(300)
        page.screenshot(path=str(OUT / "settings-devices.png"))
        page.get_by_role("button", name="注销账号").click()
        page.locator("dialog[open]").wait_for(state="visible", timeout=8000)
        page.screenshot(path=str(OUT / "settings-danger.png"))
        page.get_by_role("dialog").get_by_role("button", name="关闭").click()

        # 未投票的卡片：打开发票理由编辑器
        page.goto(f"{BASE}/", wait_until="networkidle")
        cards = page.locator(".qcard")
        for i in range(cards.count()):
            if cards.nth(i).locator(".vote-buttons").count():
                cards.nth(i).locator(".qcard-title a").click()
                page.wait_for_url(re.compile(r"/q/"), timeout=8000)
                break
        page.wait_for_load_state("networkidle")
        page.get_by_role("button", name="是，支持").first.click()
        page.screenshot(path=str(OUT / "vote-editor.png"))

        # 发布弹窗
        page.goto(f"{BASE}/", wait_until="networkidle")
        page.locator(".composer").click()
        page.locator("dialog[open]").wait_for(state="visible", timeout=8000)
        page.screenshot(path=str(OUT / "publish.png"))

        # 管理员界面
        admin_ctx = browser.new_context(viewport={"width": 1440, "height": 900}, locale="zh-CN")
        admin = admin_ctx.new_page()
        admin.goto(f"{BASE}/login", wait_until="networkidle")
        admin.get_by_label("用户名或邮箱").fill("admin")
        admin.get_by_label("密码", exact=True).fill("admin1234")
        admin.get_by_role("button", name="进入广场").click()
        admin.wait_for_url(f"{BASE}/", timeout=10000)
        admin.goto(f"{BASE}/admin", wait_until="networkidle")
        admin.screenshot(path=str(OUT / "admin.png"))
        admin.get_by_role("button", name="内容管理").click()
        admin.locator(".admin-table tbody tr").first.wait_for(state="visible", timeout=8000)
        admin.wait_for_timeout(400)
        admin.screenshot(path=str(OUT / "admin-questions.png"))
        # 产生一条管理审计记录，供审计页截图
        admin.locator(".admin-table tbody tr").first.get_by_role(
            "button", name=re.compile("精选")
        ).click()
        admin.get_by_role("button", name="用户管理").click()
        admin.locator(".admin-head h2", has_text="用户管理").wait_for(state="visible", timeout=8000)
        admin.locator(".admin-table tbody tr").first.wait_for(state="visible", timeout=8000)
        admin.wait_for_timeout(400)
        admin.screenshot(path=str(OUT / "admin-users.png"))
        admin.get_by_role("button", name="审计日志").click()
        admin.locator(".admin-head h2", has_text="审计日志").wait_for(state="visible", timeout=8000)
        admin.locator(".audit-table tbody tr").first.wait_for(state="visible", timeout=8000)
        admin.wait_for_timeout(2600)
        admin.screenshot(path=str(OUT / "admin-audit.png"))
        admin.locator(".audit-table tbody tr").first.get_by_role("button", name="查看").click()
        admin.locator("dialog[open]").wait_for(state="visible", timeout=8000)
        admin.screenshot(path=str(OUT / "admin-audit-detail.png"))
        admin.get_by_role("dialog").get_by_role("button", name="关闭").click()

        # 举报队列：待处理 → 处理完成 → 举报人侧通知
        admin.get_by_role("button", name=re.compile("^举报")).click()
        admin.locator(".report-table tbody tr").first.wait_for(state="visible", timeout=8000)
        admin.wait_for_timeout(400)
        admin.screenshot(path=str(OUT / "admin-reports.png"))
        admin.locator(".report-table tbody tr").first.get_by_role(
            "button", name="标记已处理"
        ).click()
        admin.locator(".toast").wait_for(state="visible", timeout=8000)
        admin.wait_for_timeout(2600)
        page.goto(f"{BASE}/me?tab=reports", wait_until="networkidle")
        page.locator(".notice-banner").wait_for(state="visible", timeout=8000)
        page.screenshot(path=str(OUT / "my-reports-resolved.png"))
        page.goto(f"{BASE}/notifications", wait_until="networkidle")
        page.locator(".notification-item").first.wait_for(state="visible", timeout=8000)
        page.wait_for_timeout(400)
        page.screenshot(path=str(OUT / "notifications.png"))

        mobile = browser.new_context(
            viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True,
            locale="zh-CN",
        )
        m = mobile.new_page()
        m.goto(f"{BASE}/login", wait_until="networkidle")
        m.screenshot(path=str(OUT / "login-mobile.png"))
        m.goto(f"{BASE}/", wait_until="networkidle")
        m.screenshot(path=str(OUT / "home-mobile.png"))
        m.locator(".qcard-title a").first.click()
        m.wait_for_load_state("networkidle")
        m.screenshot(path=str(OUT / "detail-mobile.png"))
        m.goto(f"{BASE}/login", wait_until="networkidle")
        m.get_by_role("button", name="用体验账号进入（demo / demo1234）").click()
        m.wait_for_url(f"{BASE}/", timeout=10000)
        m.goto(f"{BASE}/settings", wait_until="networkidle")
        m.locator(".session-current").wait_for(state="visible", timeout=8000)
        m.screenshot(path=str(OUT / "settings-mobile.png"))

        # 邮箱验证：注册 → 横幅 → 开发邮件箱 → 验证成功
        stamp = int(time.time())
        verify_name = f"验证演示{stamp % 100000}"
        verify_email = f"verify{stamp}@example.com"
        verify_ctx = browser.new_context(viewport={"width": 1440, "height": 900}, locale="zh-CN")
        vp = verify_ctx.new_page()
        vp.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        vp.on("pageerror", lambda exc: errors.append(str(exc)))

        vp.goto(f"{BASE}/login", wait_until="networkidle")
        vp.get_by_role("tab", name="注册").click()
        vp.get_by_label("昵称").fill(verify_name)
        vp.get_by_label("邮箱").fill(verify_email)
        vp.get_by_label("密码", exact=True).fill("password123")
        vp.get_by_label("确认密码").fill("password123")
        vp.get_by_role("button", name="创建账号").click()
        vp.wait_for_url(re.compile(r"/verify-email\?status=sent"), timeout=10000)
        vp.screenshot(path=str(OUT / "verify-email-sent.png"))

        vp.goto(f"{BASE}/", wait_until="networkidle")
        vp.locator(".verify-banner").wait_for(state="visible", timeout=8000)
        vp.screenshot(path=str(OUT / "home-verify-banner.png"))

        vp.goto(f"{BASE}/settings", wait_until="networkidle")
        vp.locator("#email").evaluate("el => el.scrollIntoView({block: 'start'})")
        vp.wait_for_timeout(300)
        vp.screenshot(path=str(OUT / "settings-email.png"))

        vp.goto(f"{BASE}/dev/mail", wait_until="networkidle")
        mail_item = vp.locator(".devmail-item", has_text=verify_email).first
        mail_item.wait_for(state="visible", timeout=8000)
        vp.screenshot(path=str(OUT / "dev-mail.png"))
        mail_item.get_by_role("link", name="打开验证链接").click()
        vp.wait_for_url(re.compile(r"/verify-email\?status=success"), timeout=10000)
        vp.screenshot(path=str(OUT / "verify-email-success.png"))

        vp.goto(f"{BASE}/settings", wait_until="networkidle")
        vp.locator("#email").evaluate("el => el.scrollIntoView({block: 'start'})")
        vp.wait_for_timeout(300)
        vp.screenshot(path=str(OUT / "settings-email-verified.png"))

        # 找回密码：忘记密码 → 开发邮件箱 → 重置表单
        vp.goto(f"{BASE}/forgot-password", wait_until="networkidle")
        vp.screenshot(path=str(OUT / "forgot-password.png"))
        vp.get_by_label("注册邮箱").fill(verify_email)
        vp.get_by_role("button", name="发送重置链接").click()
        vp.get_by_text("如果这个邮箱已注册").wait_for(state="visible", timeout=8000)
        vp.screenshot(path=str(OUT / "forgot-password-sent.png"))

        vp.goto(f"{BASE}/dev/mail", wait_until="networkidle")
        reset_mail = (
            vp.locator(".devmail-item", has_text=verify_email)
            .filter(has_text="重置你的密码")
            .first
        )
        reset_mail.wait_for(state="visible", timeout=8000)
        vp.screenshot(path=str(OUT / "dev-mail-reset.png"))
        reset_mail.get_by_role("link", name="打开重置链接").click()
        vp.wait_for_url(re.compile(r"/reset-password\?token="), timeout=10000)
        vp.screenshot(path=str(OUT / "reset-password.png"))

        browser.close()

    if errors:
        print("BROWSER ERRORS:")
        for e in errors:
            print(" -", e)
        sys.exit(1)
    print("screenshots ok")


if __name__ == "__main__":
    main()
