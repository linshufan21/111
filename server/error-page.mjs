function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function sendErrorPage(res, { status, title, message, requestId }) {
  const body = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${status} · ${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center;
      background: #f7f3ea; color: #191a1d;
      font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; }
    main { width: min(520px, calc(100vw - 48px)); padding: 40px 36px;
      border: 1px solid #dcd3c0; border-radius: 20px; background: #fffdf8; }
    p { line-height: 1.7; color: #6b675e; }
    .code { color: #c74420; font: 700 12px/1.4 "Cascadia Code", Consolas, monospace;
      letter-spacing: .12em; }
    h1 { margin: 8px 0 12px; font-size: 30px; }
    a { display: inline-block; margin-top: 16px; padding: 9px 14px; border-radius: 8px;
      background: #191a1d; color: #fffdf8; text-decoration: none; font-size: 13px; }
    small { display: block; margin-top: 18px; color: #9a9384; font-family: monospace; }
  </style>
</head>
<body>
  <main>
    <div class="code">ERROR ${status}</div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <a href="/">回到广场</a>
    ${requestId ? `<small>request id: ${escapeHtml(requestId)}</small>` : ''}
  </main>
</body>
</html>`
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(body)
}
