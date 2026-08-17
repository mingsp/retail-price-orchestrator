# Master 生产部署手册

本文用于把 `xf Mac` 或后续独立 Linux 主机部署为 7x24 小时 Master。Master 负责调度、状态、风险事件和数据资产，Worker 不通过 SSH 执行日常任务；SSH 仅用于安装、升级和故障维护。

## 1. 网络与主机准备

1. 给 Master 配置固定地址或 DHCP 保留，并在局域网 DNS/hosts 中设置 `retail-master.local`。
2. 安装 Docker Engine 与 Compose v2，确认 `docker compose version` 可执行。
3. 禁止主机自动睡眠，启用 Docker 开机启动，并至少保留 100 GB 可用磁盘。
4. 防火墙仅放行 TCP `2808`。启用可选 RustDesk 时，再放行 TCP `21115/21116/21117` 和 UDP `21116`。
5. PostgreSQL、Redis、MinIO 和 Master 的内部端口不得映射到宿主机。

## 2. 生产变量

在仓库根目录创建权限为 `0600` 的 `.env.production`，不得提交到 Git：

```dotenv
MASTER_HOSTNAME=retail-master.local
MASTER_PUBLIC_BASE_URL=https://retail-master.local:2808
RETAIL_RADAR_VERSION=0.1.0
POSTGRES_USER=retail
POSTGRES_DB=retail_orchestrator
POSTGRES_PASSWORD=<随机强密码>
DATABASE_URL=postgres://retail:<URL编码后的密码>@postgres:5432/retail_orchestrator
REDIS_PASSWORD=<随机强密码>
REDIS_URL=redis://:<URL编码后的密码>@redis:6379
MINIO_ROOT_USER=<随机访问键>
MINIO_ROOT_PASSWORD=<随机强密码>
WORKER_SHARED_TOKEN=<随机遗留兼容值，生产不会启用共享认证>
AUTOMATION_TOKEN=<Codex值守专用随机令牌>
OPERATOR_TOKEN=<运营操作台专用随机令牌>
DINGTALK_WEBHOOK_URL=<钉钉机器人Webhook>
```

所有 secret 在 Compose 中都使用 `${VAR:?message}`。缺少任一必填值时，`docker compose config` 和启动会直接失败，不存在生产默认密码。

## 3. 构建与启动

```bash
pnpm deploy:validate
docker compose --env-file .env.production -f infra/docker-compose.production.yml config --quiet
docker compose --env-file .env.production -f infra/docker-compose.production.yml up -d --build
docker compose --env-file .env.production -f infra/docker-compose.production.yml ps
```

只允许看到宿主机 `2808:2808`。验证入口：

```bash
curl --cacert ./master-root.crt https://retail-master.local:2808/health
curl --cacert ./master-root.crt https://retail-master.local:2808/ready
```

`/health` 表示 Master 进程存活；`/ready` 必须同时确认 PostgreSQL、Redis、MinIO 可用后才返回成功。

## 4. HTTPS 与同源入口

Caddy 使用内部 CA 终止 HTTPS，并将 `/api/*`、`/ws/*`、`/health`、`/ready` 转发给 Master，其余路径转发给 Dashboard。WebSocket 由 Caddy 原生升级，浏览器和 Worker 都只访问 `https://retail-master.local:2808`。

导出 Caddy 根证书后分发到每台 Worker：

```bash
docker compose --env-file .env.production -f infra/docker-compose.production.yml cp \
  caddy:/data/caddy/pki/authorities/local/root.crt ./master-root.crt
```

Windows 安装器会把该证书导入受信任根并设置 `NODE_EXTRA_CA_CERTS`；macOS 安装器会在 Worker 专用目录保存证书并传给 Node/curl。

## 5. 操作台无感认证边界

业务人员通过局域网 HTTPS 入口直接进入操作台，不输入、不查看也不保存操作授权码。Caddy 从生产环境变量读取 `OPERATOR_TOKEN`，仅在反向代理 `/api/*` 和 `/ws/*` 到 Master 时注入请求头；令牌不会进入静态前端、浏览器存储、URL 或页面日志。

Master 仍校验 `X-Retail-Operator-Token`。Worker 继续使用独立的 `Authorization: Bearer <worker-token>`，自动化接口继续使用独立 Automation Token，三类凭据互不替代。主机防火墙必须继续把 2808 限制在受信任局域网，Master 端口不得直接发布到宿主机。

## 6. 可选 RustDesk

RustDesk 默认不启动，基础 `docker compose config` 不要求设置 `RUSTDESK_SERVER_IMAGE`。Compose 提供固定版本兜底值；正式启用前仍应把经过验证的固定镜像标签或 digest 写入 `RUSTDESK_SERVER_IMAGE`，再启动 profile：

```bash
docker compose --profile remote-desktop --env-file .env.production \
  -f infra/docker-compose.production.yml up -d rustdesk-hbbs rustdesk-hbbr
```

基础远程桌面只开放 `21115/21116/21117`；未启用 Web Client，因此不开放 `21118/21119`。操作台只保存远程桌面定位信息和启动链接，不在网页内重做远控协议。

## 7. 备份与日常检查

- 每日执行 PostgreSQL 逻辑备份和 MinIO 增量备份，备份写到 Master 主机之外。
- 每周做一次恢复演练，而不是只检查备份文件存在。
- 监控 `/ready`、容器重启次数、磁盘剩余、证书有效期、PostgreSQL/MinIO 备份时间。
- 日志查看：`docker compose --env-file .env.production -f infra/docker-compose.production.yml logs --since 30m caddy master`。
- 升级前先备份数据库，再使用固定版本标签构建；禁止用 `latest`。

## 8. 停止与灾难恢复

```bash
docker compose --env-file .env.production -f infra/docker-compose.production.yml stop
```

不要使用 `down -v`，它会删除持久卷。灾难恢复顺序为 PostgreSQL、Redis、MinIO、Master、Dashboard、Caddy；恢复后必须以 `/ready` 和一个只读 Dashboard 查询共同验收。
