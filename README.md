# SQL Atelier · SQL 执行平台

内部团队使用的中文 SQL 工作台，支持 MySQL、Doris、登录与用户管理、库表字段浏览、多标签编辑、个人历史以及 CSV/XLSX 导出。

采用 React + FastAPI + 有界线程池。**不使用 Docker、Celery 或 Redis。Python 固定为 3.12，由 uv 管理。**

接手开发请先阅读 [首版开发交接文档](docs/handover.md)，包含新机器初始化、代码导航、测试基线、并发约束与已知限制。

## 本地启动

前提：安装 uv、Node.js 22.12+（推荐 24），以及用于保存平台数据的本地 MySQL 8.0+。目标 Doris 使用 FE 的 MySQL 协议端口（通常为 9030）。平台数据库与目标数据库可以是不同服务。

```sh
uv python install 3.12
uv sync
cp .env.example .env
uv run python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'
```

编辑 `.env`，将生成的密钥填入 `ENCRYPTION_KEY`，并将 `DATABASE_URL` 改为实际平台数据库地址、用户和密码。数据库 URL 中的特殊字符需 URL 编码。该密钥用于加密数据库连接密码，必须和平台数据库一起备份；不能随意更换。

在本地 MySQL 中创建平台数据库和专用账号（替换示例密码）：

```sql
CREATE DATABASE sqlplat CHARACTER SET utf8mb4;
CREATE USER 'sqlplat'@'localhost' IDENTIFIED BY 'replace-with-strong-password';
GRANT ALL ON sqlplat.* TO 'sqlplat'@'localhost';
```

从项目根目录执行迁移、创建管理员并启动 API：

```sh
uv run alembic -c backend/alembic.ini upgrade head
PYTHONPATH=backend uv run python -m app.cli create-admin admin
PYTHONPATH=backend uv run uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8001 --workers 1
```

另开终端启动前端：

```sh
cd frontend
npm ci
npm run dev
```

打开 <http://127.0.0.1:5180/sqlplat/>，登录后在“管理中心”添加目标 MySQL/Doris 连接、测试连接；在工作台选择连接和数据库后执行 SQL。

平台账号可使用邮箱或自定义名称（支持中文、字母、数字、点、下划线、短横线），最多 80 位；账号前后空格会自动去掉。平台密码最少 8 位，适用于新建用户、重置密码、修改密码及初始化管理员。

管理员可在“管理中心”删除数据连接，确认后移除连接并清除凭据。执行历史和保存的 SQL 保留，重新打开需选择其他连接；有排队或运行中的任务时，需等待任务结束后删除。

本机 HTTP 使用 `COOKIE_SECURE=false`。正式服务应配置 HTTPS 并设置 `COOKIE_SECURE=true`，页面与 `/sqlplat/api` 通过同一域名提供服务。前端构建命令为 `npm run build`，构建结果在 `frontend/dist`；静态服务器需要将 `/sqlplat/api/` 转发到后端 `/api/`，并为 `/sqlplat/` 下的前端路由返回 `index.html`。

## 通过 Nginx 子路径访问

平台统一使用 `/sqlplat/`：页面和静态资源在该路径下，前端 API 与下载请求使用 `/sqlplat/api/...`。Vite 的 `base` 自动处理 JS、CSS、编辑器 worker 和动态加载资源，统一 API 地址由 `frontend/src/api.ts` 的 `apiUrl` 生成。

本地 API 继续监听 `127.0.0.1:8001`，前端继续监听 `127.0.0.1:5180`。`deploy/nginx-sqlplat.conf` 提供开发服务的反向代理示例，配置后访问 <http://127.0.0.1:18000/sqlplat/>；不带末尾斜杠的 `/sqlplat` 会重定向到 `/sqlplat/`。已有监听 18000 的 server 时，只合并示例中的 location，不要重复创建 server；其他平台可在同一 server 添加 `/xxx/`。

Nginx 将 `/sqlplat/api/...` 转为后端 `/api/...`，并将会话 Cookie 的 Path 改为 `/sqlplat/`。Vite 本地代理也执行相同的路径和 Cookie 转换，因此直接访问 5180 的子路径同样可登录。Nginx 访问 5180 时保留 `/sqlplat/` 前缀，并代理 WebSocket 以支持热更新。

正式部署先运行 `npm run build`，让 Nginx 直接提供 `frontend/dist` 内容到 `/sqlplat/`，替换开发示例中转发到 5180 的 location；保留 API location。后端内部 `/api` 路由无需添加前缀。

## 线上部署（Linux + systemd + Nginx）

以下以项目目录 `/opt/sqlplat`、运行用户 `sqlplat`、静态文件目录 `/var/www/sqlplat`、结果目录 `/var/lib/sqlplat/results` 为例。入口为 `https://data.example.com:18000/sqlplat/`，请替换域名与证书路径。已有统一入口时，将下面的 location 合并进现有 server，其他平台继续使用各自路径。

线上 API 监听 `127.0.0.1:8001`；Nginx 直接提供构建后的前端文件，**无需启动 5180，也无需 Node.js 常驻进程**。API 必须保持单进程、单实例，不能使用多个 workers 或启动多个副本。

### 1. 准备服务器与发布代码

服务器需具备 MySQL 8.0+、Nginx、systemd、uv 和 Node.js 22.12+。Node.js 只用于构建，也可在构建机生成静态文件后上传。uv 安装参考 [官方安装文档](https://docs.astral.sh/uv/getting-started/installation/)。确保服务器可以连接实际使用的 MySQL、Doris FE 和所需 TLS 证书路径。

由管理员创建运行用户和目录：

```sh
sudo useradd --system --create-home --home-dir /home/sqlplat --shell /bin/bash sqlplat
sudo install -d -m 755 -o sqlplat -g sqlplat /opt/sqlplat /var/www/sqlplat
sudo install -d -m 700 -o sqlplat -g sqlplat /var/lib/sqlplat/results
```

将发布版本源代码复制到 `/opt/sqlplat`，保留 `uv.lock` 和 `frontend/package-lock.json`。不要上传开发机器的 `.env`、`.local`、`.venv` 或 `node_modules`。已有用户或目录时复用即可；代码和构建目录应归 `sqlplat` 用户所有，Nginx 用户需能读取静态文件及访问其父目录。

以下 Python 安装、依赖同步、配置和构建命令均以运行用户执行。为该用户安装 uv 后，切换用户并进入项目：

```sh
sudo -iu sqlplat
export PATH="$HOME/.local/bin:$PATH"
cd /opt/sqlplat
uv python install 3.12
uv sync --frozen --no-dev --python 3.12
cp .env.example .env
chmod 600 .env
uv run --no-sync python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'
```

### 2. 配置平台数据库与环境

由数据库管理员创建平台专用数据库和账号，可复用“本地启动”中的建库 SQL。平台账号只需拥有 `sqlplat.*` 的权限；通过远程数据库部署时，按实际 API 服务器来源配置 MySQL 账号 Host 和网络访问。

编辑 `/opt/sqlplat/.env`，至少修改以下配置，其他参数可保留 `.env.example` 默认值：

```dotenv
DATABASE_URL=mysql+pymysql://sqlplat:replace-with-strong-password@127.0.0.1:3306/sqlplat?charset=utf8mb4
ENCRYPTION_KEY=replace-with-generated-fernet-key
RESULT_DIR=/var/lib/sqlplat/results
COOKIE_SECURE=true
```

密码中的特殊字符需 URL 编码。首次部署填写上一步生成的密钥；迁移已有平台时使用原有密钥，不能重新生成。结果目录必须可由运行用户写入，并持久保留。浏览器通过 HTTPS 访问时使用 `COOKIE_SECURE=true`；仅 HTTP 的内网试运行入口则设置为 `false`。

执行迁移并创建首个管理员：

```sh
cd /opt/sqlplat
uv run --no-sync alembic -c backend/alembic.ini upgrade head
PYTHONPATH=backend uv run --no-sync python -m app.cli create-admin admin
```

管理员密码通过隐藏输入设置，至少 8 位；已有管理员无需再次创建。依赖安装使用锁文件，运行命令使用 `--no-sync`，避免重新安装开发依赖；参见 [uv 依赖同步说明](https://docs.astral.sh/uv/concepts/projects/sync/)。

### 3. 构建并发布前端

仍以 `sqlplat` 用户执行：

```sh
cd /opt/sqlplat/frontend
npm ci
npm run build
rsync -a --delete dist/ /var/www/sqlplat/
```

`--delete` 仅用于专属静态发布目录 `/var/www/sqlplat/`。该目录对应 Nginx 的 `/sqlplat/` 路径；Vite 已配置相同的 base，构建产物中的 JS、CSS 和编辑器 worker 均带此前缀。不要将其他平台的文件放入这个目录。

### 4. 使用 systemd 托管 API

退出运行用户的登录 shell，由管理员将以下内容保存为 `/etc/systemd/system/sqlplat-api.service`：

```ini
[Unit]
Description=SQL Atelier API
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=sqlplat
Group=sqlplat
WorkingDirectory=/opt/sqlplat
Environment=PYTHONPATH=/opt/sqlplat/backend
Environment=PYTHONUNBUFFERED=1
ExecStart=/opt/sqlplat/.venv/bin/python -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8001 --workers 1 --timeout-graceful-shutdown 330
Restart=on-failure
RestartSec=5
TimeoutStopSec=360
UMask=0077

[Install]
WantedBy=multi-user.target
```

应用从 WorkingDirectory 下的 `.env` 读取配置。虚拟环境和 uv 管理的 Python 应由同一个运行用户安装，不能直接复制开发机器的虚拟环境。以上停止等待时间对应默认 300 秒 SQL 超时；提高执行超时时，同步增加服务停止等待时间。

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now sqlplat-api
sudo systemctl status sqlplat-api --no-pager
curl -fsS http://127.0.0.1:8001/api/health
```

健康检查应返回 `{"status":"ok"}`。查看日志：`sudo journalctl -u sqlplat-api -n 100 --no-pager`。systemd 的服务重启不会自动重试 SQL。

### 5. 配置生产 Nginx

将有效域名证书放到配置指定位置，下面的 server 放入 Nginx 的 `http` 配置范围，例如 `/etc/nginx/conf.d/sqlplat.conf`。已有监听 18000 的 server 时只合并 location，并沿用现有证书和其他平台配置。

```nginx
server {
    listen 18000 ssl;
    server_name data.example.com;
    ssl_certificate /etc/nginx/tls/data.example.com.crt;
    ssl_certificate_key /etc/nginx/tls/data.example.com.key;

    root /var/www;

    location = /sqlplat {
        return 302 /sqlplat/;
    }

    location ^~ /sqlplat/api/ {
        client_max_body_size 10m;
        proxy_pass http://127.0.0.1:8001/api/;
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cookie_path / /sqlplat/;
        proxy_read_timeout 300s;
    }

    location ^~ /sqlplat/assets/ {
        try_files $uri =404;
        expires 7d;
    }

    location = /sqlplat/index.html {
        add_header Cache-Control "no-cache";
    }

    location /sqlplat/ {
        try_files $uri $uri/ /sqlplat/index.html;
    }

    # 其他平台的 location /xxx/ 配置保留在同一 server 中。
}
```

`root /var/www` 配合 `/sqlplat/...`，实际读取 `/var/www/sqlplat/...`。API 转发去掉应用前缀，Cookie Path 则限制为 `/sqlplat/`。静态路径和转发规则参见 [Nginx 静态文件说明](https://docs.nginx.com/nginx/admin-guide/web-server/serving-static-content/) 与 [代理模块说明](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)。本项目的 `deploy/nginx-sqlplat.conf` 是代理到 Vite 的开发示例，生产部署使用上述静态文件配置。

```sh
sudo nginx -t
sudo systemctl reload nginx
curl -fsS https://data.example.com:18000/sqlplat/api/health
```

使用实际域名访问入口，验证登录、选择连接、执行只读 SQL、CSV/XLSX 下载和退出；浏览器请求应落在 `/sqlplat/` 下。外部只需访问 Nginx 入口端口，API 的 8001 保持本机监听。

### 6. 后续升级与备份

升级前备份平台 MySQL 和原有 `ENCRYPTION_KEY`，按需备份结果目录，并准备上一个发布版本。等待排队和运行任务结束后停止 API；服务被强制中断时，未完成 SQL 的实际写入状态需在目标数据库核实。

```sh
sudo systemctl stop sqlplat-api
```

更新 `/opt/sqlplat` 的发布代码，保留 `.env` 和结果目录。以 `sqlplat` 用户在项目目录执行：

```sh
cd /opt/sqlplat
uv sync --frozen --no-dev --python 3.12
uv run --no-sync alembic -c backend/alembic.ini upgrade head
cd frontend
npm ci
npm run build
rsync -a --delete dist/ /var/www/sqlplat/
```

全部成功后由管理员启动服务，并重复本机及入口健康检查：

```sh
sudo systemctl start sqlplat-api
curl -fsS http://127.0.0.1:8001/api/health
curl -fsS https://data.example.com:18000/sqlplat/api/health
```

修改 systemd 单元后先执行 `sudo systemctl daemon-reload`；修改 Nginx 配置后执行 `sudo nginx -t`，通过后再 reload。静态文件更新不需要重启 Nginx。回退旧版本前确认数据库迁移兼容性，必要时恢复配套数据库备份及原密钥。

## SQL 操作

- **执行 SQL**：有选区时执行选区，选中全部即执行全文；无选区时执行光标所在完整 SQL，可以跨多行。快捷键为 ⌘/Ctrl + Enter。
- 多条语句顺序执行，遇错停止，保留先前结果。
- 同一任务使用同一数据库连接，不同任务相互独立。连接账号决定实际 SQL 权限。
- 默认自动提交，写入可能立即生效；不提供跨任务事务或 DELIMITER/存储过程编辑工作流。
- 字符串扫描按标准 MySQL 转义规则解释，首版不支持通过 SQL 修改到 ANSI_QUOTES/NO_BACKSLASH_ESCAPES 模式。
- 下载不会重新执行 SQL。页面只预览前 1000 行，每个结果集最多保存 10 万行；截断时会提示。
- CSV 带 UTF-8 BOM，并对公式字符串作文本防护；Excel 的长整数、高精度数值按文本保存。
- 结果默认保留 24 小时，执行历史默认保留 90 天。

## 执行与故障处理

默认 4 个执行线程、20 个等待任务，达到容量限制返回 429。默认执行超时 300 秒，线程使用数据库超时、网络超时及连接中断保护。

API 必须运行 **单个进程、单个实例**，不能开启多个 uvicorn workers；SQL 不自动重试。刷新页面后从执行历史打开任务，或由本地草稿恢复任务 ID。服务重启时未完成任务标记中断。超时、断线等情况不能证明数据库已回滚；写入结果需要在目标数据库核实。

目标数据库连接默认不启用 TLS；需要 TLS 时在管理页面开启证书校验，证书路径为本机 API 可读路径。不启用 TLS 不等于链路已加密。

## 配置

所有配置从根目录 `.env` 或环境变量读取，环境变量优先。完整示例在 `.env.example`。

| 配置 | 默认/说明 |
| --- | --- |
| DATABASE_URL | 平台数据库 SQLAlchemy URL |
| ENCRYPTION_KEY | 必须提供有效的持久 Fernet 密钥 |
| RESULT_DIR | 本地结果目录，示例为 `.local/results` |
| EXECUTION_WORKERS / EXECUTION_QUEUE | 4 / 20 |
| EXECUTION_TIMEOUT | 300 秒，从开始运行计时 |
| RESULT_ROWS / PREVIEW_ROWS | 100000 / 1000 |
| RESULT_BYTES | 每个任务 104857600 字节 |
| RESULT_HOURS / HISTORY_DAYS | 24 小时 / 90 天 |
| SESSION_HOURS | 会话有效期 12 小时 |
| COOKIE_SECURE | 默认 true，本机 HTTP 改为 false |

## 测试

```sh
uv run pytest
cd frontend
npm test
npm run build
npm run e2e
```

后端自动化测试使用临时 SQLite 保存平台数据，数据库外部操作使用明确的测试替身，验证线程池执行、错误处理、结果保存及权限。前端组件测试使用 Vitest，浏览器流程使用 Playwright。真实数据库集成测试需配置测试数据库，不应对生产库运行测试。

真实数据库联调配置与测试命令见 `docs/testing.md`。结果测试覆盖重复列名、中文、NULL、日期、长整数、高精度数值、公式防护、行数/文件截断、结果过期和服务重启恢复。

## 项目结构

- `backend/app`：API、认证、目标连接、SQL 扫描、执行器与结果存储。
- `backend/alembic`：平台数据库迁移。
- `frontend/src`：工作台、执行历史与管理界面。
- `shared/sql-cases.json`：前后端共用的语句边界测试样例。
- `docs/design.md`：设计文档；`docs/implementation.md`：实施与验证进度。

备份平台 MySQL、加密密钥和需要保留的结果目录。日志和接口不返回目标连接密码，普通用户及管理员均只能查看自己的执行结果。

本地初始化使用提供的 MySQL 管理员凭据创建数据库，并为默认共享连接创建仅拥有 `sqlplat_demo.*` 权限的独立账号；不会把平台账号或 root 注册为共享执行连接。

## 保存常用 SQL

工作台点击“保存 SQL”，填写名称即可保存当前标签的全部 SQL、连接和数据库。保存项只对本人可见，存储于平台 MySQL，刷新、重新登录或更换浏览器后仍可找回；与临时结果文件和执行历史的保留期无关。

通过顶部“我的 SQL”搜索、打开、重命名和删除。打开仅回填编辑内容，不自动执行或加载旧结果。打开已保存项后，“保存 SQL”更新原记录，“另存为”创建新记录。未选择连接也可保存，执行前再选择连接。记录已被删除时，更新提示使用另存为。

本次升级新增 `saved_queries` 表，已有环境运行 `uv run alembic -c backend/alembic.ini upgrade head` 后重启 API；本地启动脚本会自动执行迁移。
