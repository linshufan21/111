# 日志、指标与错误页

## 结构化日志

每个请求在响应结束后输出一行 JSON 到 stdout：

```json
{
  "time": "2026-10-18T07:30:00.000Z",
  "level": "info",
  "event": "request",
  "requestId": "b7f4...",
  "method": "GET",
  "path": "/api/questions",
  "status": 200,
  "durationMs": 4.21,
  "ip": "127.0.0.1"
}
```

- 请求 ID 优先使用客户端 `X-Request-ID`，否则生成 UUID；响应带同名头。
- Nginx 使用 `$request_id` 透传，便于把访问日志与应用日志串起来。
- 不记录请求体、Cookie、密码或 token。
- 测试环境默认静默；设置 `LOG_REQUESTS=1` 可在测试中查看日志。
- 500 错误额外输出 `request.failed`，含错误信息和堆栈。

## 健康检查

`GET /healthz`（容器/负载均衡）与 `GET /api/health`（兼容）返回：

```json
{
  "status": "ok",
  "db": "ok",
  "version": "0.1.0",
  "commit": "abc123def456",
  "mail": "brevo",
  "schemaVersion": 14,
  "schemaName": "day14-release-healthz",
  "schemaAppliedAt": "2026-10-18T08:00:00.000Z",
  "uptime": 12,
  "startedAt": "2026-10-18T08:00:00.000Z"
}
```

- 数据库异常返回 `503`，`status="error"`、`db="unavailable"`。
- 支持 `HEAD`，响应 `Cache-Control: no-store`。
- `commit` 为空表示部署环境没有注入 `GIT_SHA`。
- 数据库 schema 版本高于代码版本时，启动阶段直接失败。

## 指标

`GET /metrics` 返回 Prometheus 文本格式：

- `dajia_http_requests_total{method,status}`：按方法与状态码的请求数；
- `dajia_http_request_duration_ms`：最近 2048 次请求的 p50/p95/p99、sum、count；
- `dajia_http_requests_all_total`：进程启动以来总请求数；
- `dajia_uptime_seconds`；
- `dajia_db_questions / votes / users / pending_reports`；
- `dajia_db_bytes`：SQLite 主库页数 × 页大小（不含 WAL 文件）。

指标保存在进程内存，重启后归零；单实例下可直接抓取。Nginx 的 `/metrics` 只允许本机与私网地址访问，公网返回 403。

Prometheus 示例：

```yaml
scrape_configs:
  - job_name: dajia
    metrics_path: /metrics
    static_configs:
      - targets: ["127.0.0.1:8787"]
```

如果通过 Nginx 抓取，请让 Prometheus 处于允许的私网范围，或直接抓 `127.0.0.1:8787`。

## 错误页

- 浏览器访问不存在的静态资源：HTML 404 页面，带 request id 与返回广场链接。
- 浏览器遇到服务器异常：HTML 500 页面。
- `/api/*` 仍返回 JSON，错误对象含 `requestId`，响应头也带 `X-Request-ID`。
- 前端 SPA 的未知路由仍由 React NotFound 页面处理。

## 优雅关闭

- 监听 `SIGINT` / `SIGTERM`；
- 停止接收新连接，等待在途请求结束；
- 清理通知 worker、关闭 SQLite；
- 10 秒仍未结束则强制关闭连接并退出。

容器 `docker compose stop` 会发送 `SIGTERM`，因此会走该流程。

## 已知限制

- 指标是进程内存，重启归零；多实例需要 Prometheus 分别抓取或改用共享存储。
- 延迟分位基于最近 2048 次请求，不是全量直方图。
- 日志输出到 stdout，未接入日志采集、轮转或错误追踪平台。
- 未提供 `/metrics` 鉴权；依赖 Nginx 私网访问限制。
- request id 由客户端传入时会被沿用，适合追踪，但不作为安全凭证。
- HTML 错误页只在静态资源/未捕获异常时出现；API 错误保持 JSON。
