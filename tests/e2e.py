"""端到端：注册 → 验证 → 发布 → 投票 → 改密 → 管理台 → 注销 → 找回密码。"""
import os
import re
import sys
import time
import traceback

from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("E2E_BASE", "http://127.0.0.1:8787").rstrip("/")
# 本机默认 Edge；CI 设 E2E_CHANNEL=none 时使用 Playwright 自带 Chromium。
_channel = os.environ.get("E2E_CHANNEL", "msedge").strip()
CHANNEL = None if _channel.lower() in ("", "none", "bundled") else _channel


def main() -> None:
    stamp = int(time.time())
    username = f"测试员{stamp % 100000}"
    email = f"e2e{stamp}@example.com"
    question_url = ""

    with sync_playwright() as p:
        browser = p.chromium.launch(channel=CHANNEL, headless=True)
        ctx = browser.new_context(viewport={"width": 1280, "height": 900}, locale="zh-CN")
        page = ctx.new_page()

        # 注册
        page.goto(f"{BASE}/login", wait_until="networkidle")
        page.get_by_role("tab", name="注册").click()
        page.get_by_label("昵称").fill(username)
        page.get_by_label("邮箱").fill(email)
        page.get_by_label("密码", exact=True).fill("password123")
        page.get_by_label("确认密码").fill("password123")
        page.get_by_role("button", name="创建账号").click()
        page.wait_for_url(re.compile(r"/verify-email\?status=sent"), timeout=10000)
        expect(page.get_by_role("heading", name="验证邮件已发送")).to_be_visible()

        # 未验证横幅 → 设置页邮箱区块
        page.get_by_role("link", name="先去逛逛").click()
        expect(page.locator(".verify-banner")).to_be_visible()
        page.get_by_role("link", name="去验证 →").click()
        page.wait_for_url(re.compile(r"/settings#email"), timeout=10000)
        expect(page.get_by_role("heading", name="邮箱验证")).to_be_visible()
        page.wait_for_timeout(300)
        assert page.evaluate("window.scrollY") > 0

        # 开发邮件箱取验证链接
        page.goto(f"{BASE}/dev/mail", wait_until="networkidle")
        mail_item = page.locator(".devmail-item", has_text=email).first
        expect(mail_item).to_be_visible(timeout=8000)
        mail_item.get_by_role("link", name="打开验证链接").click()
        page.wait_for_url(re.compile(r"/verify-email\?status=success"), timeout=10000)
        expect(page.get_by_role("heading", name="邮箱验证成功")).to_be_visible()

        page.get_by_role("link", name="去发起投票").click()
        page.locator("dialog[open]").wait_for(state="visible", timeout=8000)

        # 发布
        page.get_by_label("你的问题").fill("要不要现在就下班去散步？")
        page.get_by_label("补充背景（可选）").fill("外面天气很好，但还有一点工作没做完。")
        page.get_by_role("dialog").get_by_role("button", name="工作").click()
        page.get_by_role("button", name="发布问题").click()
        page.wait_for_url(re.compile(r"/q/[0-9a-f-]+"), timeout=10000)
        question_url = page.url
        expect(page.locator(".detail-head h1")).to_have_text("要不要现在就下班去散步？")

        # 退出
        page.locator("summary[aria-label='账号菜单']").click()
        page.get_by_role("button", name="退出登录").click()
        page.wait_for_url(f"{BASE}/login", timeout=10000)

        # 另一个账号投票
        page.get_by_label("用户名或邮箱").fill("demo")
        page.get_by_label("密码", exact=True).fill("demo1234")
        page.get_by_role("button", name="进入广场").click()
        page.wait_for_url(f"{BASE}/", timeout=10000)

        page.goto(question_url, wait_until="networkidle")
        page.get_by_role("button", name=re.compile("是，支持")).click()
        page.get_by_label("投票理由（可选）").fill("天气好就该出去走走。")
        page.get_by_role("button", name="提交投票").click()
        expect(page.locator(".results")).to_be_visible(timeout=8000)
        expect(page.locator(".my-vote")).to_contain_text("是")

        # 改票
        page.get_by_role("button", name="改票").click()
        page.get_by_label("投票理由（可选）").fill("想了想还是先把工作收尾。")
        page.get_by_role("button", name="更新选择").click()
        expect(page.locator(".my-vote")).to_contain_text("否", timeout=8000)
        expect(page.locator(".results")).to_be_visible()

        # 举报：详情页提交 → 我的举报可见待处理状态
        page.goto(question_url, wait_until="networkidle")
        page.get_by_role("button", name="举报这个问题").click()
        report_dialog = page.get_by_role("dialog")
        expect(report_dialog).to_be_visible(timeout=8000)
        report_dialog.locator("input[value='spam']").check()
        report_dialog.get_by_label("补充说明（可选）").fill("这条内容像是在发广告。")
        report_dialog.get_by_role("button", name="提交举报").click()
        expect(page.locator(".toast")).to_contain_text("举报已提交", timeout=8000)
        expect(page.locator(".report-card .report-state")).to_contain_text("待处理", timeout=8000)

        page.goto(f"{BASE}/me?tab=reports", wait_until="networkidle")
        expect(page.get_by_role("tab", name="我的举报")).to_have_attribute("aria-selected", "true")
        expect(page.locator(".report-item").first).to_contain_text("待处理")
        expect(page.locator(".report-item").first).to_contain_text("要不要现在就下班去散步？")

        page.goto(f"{BASE}/", wait_until="networkidle")
        # 账号设置：改密（轮换当前会话）
        page.locator("summary[aria-label='账号菜单']").click()
        page.get_by_role("button", name="退出登录").click()
        page.wait_for_url(f"{BASE}/login", timeout=10000)
        page.get_by_label("用户名或邮箱").fill(username)
        page.get_by_label("密码", exact=True).fill("password123")
        page.get_by_role("button", name="进入广场").click()
        page.wait_for_url(f"{BASE}/", timeout=10000)

        # 通知中心：作者收到投票/理由通知，铃铛未读，全部已读持久化
        expect(page.locator(".notification-count")).to_be_visible(timeout=8000)
        page.goto(f"{BASE}/notifications", wait_until="networkidle")
        expect(page.get_by_role("heading", name="通知中心")).to_be_visible()
        expect(page.locator(".notification-item").first).to_be_visible(timeout=8000)
        expect(page.locator(".notification-item", has_text="收到一条新理由").first).to_be_visible()
        page.get_by_role("button", name="全部已读").click()
        expect(page.locator(".notification-item.unread")).to_have_count(0, timeout=8000)
        expect(page.locator(".notification-count")).to_have_count(0, timeout=8000)
        page.reload(wait_until="networkidle")
        expect(page.get_by_role("heading", name="通知中心")).to_be_visible()
        expect(page.locator(".notification-item.unread")).to_have_count(0)

        page.goto(f"{BASE}/settings", wait_until="networkidle")
        expect(page.get_by_role("heading", name="账号设置")).to_be_visible()
        expect(page.locator("#email")).to_contain_text("已验证")
        expect(page.locator(".session-current")).to_be_visible()
        security = page.locator("#security")
        security.get_by_label("当前密码").fill("password123")
        security.get_by_label("新密码", exact=True).fill("password456")
        security.get_by_label("确认新密码").fill("password456")
        security.get_by_role("button", name="更新密码").click()
        expect(page.locator(".toast")).to_contain_text("密码已更新", timeout=8000)
        page.reload(wait_until="networkidle")
        expect(page.get_by_role("heading", name="账号设置")).to_be_visible()
        expect(page.locator(".session-current")).to_be_visible()

        # 管理台可访问、内容表格可加载
        admin_ctx = browser.new_context(viewport={"width": 1280, "height": 900}, locale="zh-CN")
        admin = admin_ctx.new_page()
        admin.goto(f"{BASE}/login", wait_until="networkidle")
        admin.get_by_label("用户名或邮箱").fill("admin")
        admin.get_by_label("密码", exact=True).fill("admin1234")
        admin.get_by_role("button", name="进入广场").click()
        admin.wait_for_url(f"{BASE}/", timeout=10000)
        admin.goto(f"{BASE}/admin", wait_until="networkidle")
        expect(admin.get_by_role("heading", name="管理台")).to_be_visible()
        admin.get_by_role("button", name="内容管理").click()
        expect(admin.locator(".admin-table tbody tr").first).to_be_visible(timeout=8000)
        admin.locator(".admin-table tbody tr").first.get_by_role(
            "button", name=re.compile("精选")
        ).click()
        expect(admin.locator(".toast")).to_contain_text("精选", timeout=8000)

        # 审计日志：管理动作可查，详情可打开
        admin.get_by_role("button", name="审计日志").click()
        expect(admin.get_by_role("heading", name="审计日志")).to_be_visible(timeout=8000)
        audit_row = admin.locator(".audit-table tbody tr", has_text="精选").first
        expect(audit_row).to_be_visible(timeout=8000)
        audit_row.get_by_role("button", name="查看").click()
        audit_dialog = admin.get_by_role("dialog")
        expect(audit_dialog).to_be_visible(timeout=8000)
        expect(audit_dialog).to_contain_text("附加信息")
        audit_dialog.get_by_role("button", name="关闭").click()

        # 举报队列：待处理 → 标记处理 → 已处理列表可见
        admin.get_by_role("button", name=re.compile("^举报")).click()
        expect(admin.get_by_role("heading", name="举报队列")).to_be_visible(timeout=8000)
        report_row = admin.locator(
            ".report-table tbody tr", has_text="要不要现在就下班去散步？"
        ).first
        expect(report_row).to_be_visible(timeout=8000)
        report_row.get_by_role("button", name="标记已处理").click()
        expect(
            admin.locator(".toast", has_text="已标记为处理完成")
        ).to_be_visible(timeout=8000)
        admin.get_by_role("tab", name=re.compile("已处理")).click()
        expect(
            admin.locator(".report-table tbody tr", has_text="要不要现在就下班去散步？").first
        ).to_be_visible(timeout=8000)

        # 登录错误提示
        error_ctx = browser.new_context(viewport={"width": 1280, "height": 900}, locale="zh-CN")
        error_page = error_ctx.new_page()
        error_page.goto(f"{BASE}/login", wait_until="networkidle")
        error_page.get_by_label("用户名或邮箱").fill("demo")
        error_page.get_by_label("密码", exact=True).fill("wrong-password")
        error_page.get_by_role("button", name="进入广场").click()
        expect(error_page.locator(".field-error")).to_contain_text("账号或密码不正确", timeout=8000)

        # 注销账号：内容匿名化，账号不可再登录
        page.goto(f"{BASE}/settings", wait_until="networkidle")
        page.get_by_role("button", name="注销账号").click()
        dialog = page.get_by_role("dialog")
        expect(dialog).to_be_visible()
        dialog.get_by_label("当前密码").fill("password456")
        dialog.get_by_label("输入「注销」确认").fill("注销")
        dialog.get_by_role("button", name="确认注销").click()
        page.wait_for_url(f"{BASE}/", timeout=10000)

        page.goto(question_url, wait_until="networkidle")
        expect(page.locator(".detail-byline")).to_contain_text("已注销用户")

        page.goto(f"{BASE}/login", wait_until="networkidle")
        page.get_by_label("用户名或邮箱").fill(username)
        page.get_by_label("密码", exact=True).fill("password456")
        page.get_by_role("button", name="进入广场").click()
        expect(page.locator(".field-error")).to_contain_text("账号或密码不正确", timeout=8000)

        # 找回密码：注册 → 忘记密码 → 开发邮件箱 → 重置 → 新密码登录
        recovery_name = f"找回员{stamp % 100000}"
        recovery_email = f"recover{stamp}@example.com"
        recovery_ctx = browser.new_context(viewport={"width": 1280, "height": 900}, locale="zh-CN")
        recovery = recovery_ctx.new_page()
        recovery.goto(f"{BASE}/login", wait_until="networkidle")
        recovery.get_by_role("tab", name="注册").click()
        recovery.get_by_label("昵称").fill(recovery_name)
        recovery.get_by_label("邮箱").fill(recovery_email)
        recovery.get_by_label("密码", exact=True).fill("oldpass123")
        recovery.get_by_label("确认密码").fill("oldpass123")
        recovery.get_by_role("button", name="创建账号").click()
        recovery.wait_for_url(re.compile(r"/verify-email\?status=sent"), timeout=10000)

        recovery.goto(f"{BASE}/forgot-password", wait_until="networkidle")
        recovery.get_by_label("注册邮箱").fill(recovery_email)
        recovery.get_by_role("button", name="发送重置链接").click()
        expect(recovery.get_by_text("如果这个邮箱已注册")).to_be_visible(timeout=8000)

        recovery.goto(f"{BASE}/dev/mail", wait_until="networkidle")
        reset_mail = (
            recovery.locator(".devmail-item", has_text=recovery_email)
            .filter(has_text="重置你的密码")
            .first
        )
        reset_mail.wait_for(state="visible", timeout=8000)
        reset_mail.get_by_role("link", name="打开重置链接").click()
        recovery.wait_for_url(re.compile(r"/reset-password\?token="), timeout=10000)

        recovery.get_by_label("新密码", exact=True).fill("newpass123")
        recovery.get_by_label("确认新密码").fill("newpass123")
        recovery.get_by_role("button", name="重置密码").click()
        recovery.wait_for_url(re.compile(r"/login\?reset=1"), timeout=10000)
        expect(recovery.get_by_text("密码已重置，请用新密码登录")).to_be_visible()

        recovery.get_by_label("用户名或邮箱").fill(recovery_name)
        recovery.get_by_label("密码", exact=True).fill("newpass123")
        recovery.get_by_role("button", name="进入广场").click()
        recovery.wait_for_url(f"{BASE}/", timeout=10000)

        browser.close()

    print("e2e ok", question_url)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        print("E2E FAILED:", exc)
        sys.exit(1)
