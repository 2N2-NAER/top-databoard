# Top Databoard 内网部署版

这是一套不依赖 Vercel / Supabase 的内网部署方案：

- 浏览器访问同一个内网地址。
- Node.js 服务提供页面和 `/api/records`。
- PostgreSQL 保存所有数据版本。
- 每次保存都会新增历史版本。
- 多人同时编辑时，旧版本提交会返回 `409 Conflict`，避免静默覆盖。

## 一键启动

在内网 Linux 机器上执行：

```bash
git clone <your-repo-url>
cd top-databoard
cp .env.example .env
```

编辑 `.env`，把 `POSTGRES_PASSWORD` 改成强密码，然后启动：

```bash
docker compose up -d --build
```

访问：

```text
http://服务器内网IP:8080
```

例如：

```text
http://10.25.76.198:8080
```

## 常用命令

查看服务状态：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f app
```

停止服务：

```bash
docker compose down
```

停止服务但保留数据库数据：

```bash
docker compose down
```

停止并删除数据库数据：

```bash
docker compose down -v
```

## 数据备份

备份数据库：

```bash
docker compose exec postgres pg_dump -U databoard databoard > databoard_backup.sql
```

恢复数据库：

```bash
docker compose exec -T postgres psql -U databoard databoard < databoard_backup.sql
```

## 接口

读取最新数据：

```http
GET /api/records
```

保存新版本：

```http
POST /api/records
Content-Type: application/json

{
  "state": {},
  "baseVersion": 1
}
```

健康检查：

```http
GET /api/health
```
