# 备份、恢复与导出

## 备份

```bash
pnpm backup
# 或
node scripts/backup.mjs --out backups --retention 14
```

- 使用 SQLite `VACUUM INTO` 生成一致性快照，不直接复制 WAL 中间状态。
- 文件名：`backups/app-YYYYMMDDTHHmmssSSSZ.db`
- 生成后会重新打开快照执行 `PRAGMA quick_check`，并比对 users/questions/votes/reports/notifications 计数。
- 默认保留 14 天；`BACKUP_RETENTION_DAYS` 或 `--retention` 可调整。
- 备份文件含邮箱、密码哈希与内容，请设置目录/文件权限；脚本在 POSIX 下会把文件设为 `0600`。

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `DB_PATH` | `server/data/app.db` | 源数据库 |
| `BACKUP_DIR` | `backups` | 输出目录 |
| `BACKUP_RETENTION_DAYS` | `14` | 保留天数，`0` 不清理 |

## 恢复

**必须先停止应用**，避免 SQLite 正在写入时替换文件。

```bash
# 本地：先停止 pnpm start / node server/index.mjs（Ctrl+C）
node scripts/restore.mjs backups/app-YYYYMMDDTHHmmssSSSZ.db --force

# 容器
docker compose stop app
docker compose run --rm app node scripts/restore.mjs /data/backups/app-YYYYMMDDTHHmmssSSSZ.db --force
docker compose start app
```

- `--force` 是覆盖确认，必须显式传入。
- 恢复前会把当前数据库复制为 `*.pre-restore-<timestamp>` 安全副本（如果存在）。
- 先校验备份，再复制到临时文件、移除旧 WAL/SHM、原子替换，最后再次校验计数。
- 建议恢复后打开 `/healthz` 并做一次登录/列表冒烟。

## CSV 导出

```bash
node scripts/export-csv.mjs --out exports
```

生成：

- `exports/questions.csv`：id、作者 id、标题、说明、分类、截止、匿名、精选、创建时间；
- `exports/votes.csv`：id、问题 id、用户 id、选择、理由、匿名、创建/更新时间。

CSV 使用 RFC 4180 引号转义。导入 Excel 时请按 UTF-8 打开。

## 定时任务

Linux/macOS cron：

```cron
0 3 * * * cd /srv/decision-app && /usr/bin/node scripts/backup.mjs >> /var/log/dajia-backup.log 2>&1
```

Windows 任务计划程序：

```powershell
schtasks /Create /SC DAILY /TN "Dajia Backup" /ST 03:00 ^
  /TR "cmd /c cd /d C:\path\decision-app && node scripts\backup.mjs"
```

Docker：

```bash
docker compose exec app node scripts/backup.mjs
# 备份会写入容器内 BACKUP_DIR=/data/backups，落在 app-data 卷
```

## 注意

- 备份是数据库快照，不包含 `.env`、证书、Nginx 配置；这些需要单独备份。
- 恢复会覆盖当前数据库；不要在应用运行时执行。
- 当前是单机 SQLite，备份成功不代表可以抵御磁盘损坏；建议定期把备份复制到另一台机器/对象存储。
- CSV 中的 `user_id` 可用于关联，但不包含邮箱等敏感字段；需要完整数据请使用数据库备份。
- 生产环境建议在备份前后记录行数，并定期做一次“备份→临时目录恢复→计数比对”演练。
