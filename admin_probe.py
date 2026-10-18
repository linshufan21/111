from playwright.sync_api import sync_playwright
B="http://127.0.0.1:8787"
with sync_playwright() as p:
    b=p.chromium.launch(channel='msedge', headless=True)
    pg=b.new_page(viewport={'width':1440,'height':900})
    pg.goto(B+'/login', wait_until='networkidle')
    pg.get_by_label('用户名或邮箱').fill('admin')
    pg.get_by_label('密码', exact=True).fill('admin1234')
    pg.get_by_role('button', name='进入广场').click()
    pg.wait_for_url(B+'/', timeout=10000)
    pg.goto(B+'/admin', wait_until='networkidle')
    print('h2', pg.locator('.admin-head h2').inner_text())
    pg.get_by_role('button', name='内容管理').click()
    pg.wait_for_timeout(800)
    print('url', pg.url)
    print('h2 after', pg.locator('.admin-head h2').inner_text())
    print('rows', pg.locator('.admin-table tbody tr').count())
    b.close()
