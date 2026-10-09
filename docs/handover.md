# SQL Atelier 首版开发交接

交接日期：2026-10-09。本文面向在另一台机器继续开发的同学，以当前代码为准。线上部署详见 [README](../README.md#线上部署linux--systemd--nginx)，详细测试说明见 [testing.md](testing.md)。

## 1. 当前交付状态

首版功能已实现，并完成本地 MySQL 和浏览器流程验证。Doris 适配已实现，但真实 Doris FE 实例和真实数据库 TLS 握手仍待专项验收；不要把 MySQL 通过视为 Doris 已通过。

| 模块 | 当前能力 |
| --- | --- |
| 账号 | 管理员创建、启用/禁用用户、角色管理、重置密码；用户登录、退出和修改密码 |
| 账号规则 | 邮箱或自定义名称，支持中文，最长 80 位，前后空格去除；平台密码 8～1024 位 |
| 数据连接 | MySQL/Doris 配置、加密密码、测试连接、启用/禁用、编辑和管理员删除 |
| 数据资源 | 选择连接和数据库，搜索表，展开字段 |
| SQL 工作台 | 多标签 Monaco 编辑器、SQL 格式化、统一执行按钮、快捷键及状态轮询 |
| 结果 | 分页预览、重复列名、精度处理、CSV/XLSX 下载、截断提示 |
| 执行历史 | 本人历史、搜索和状态筛选；打开仅回填 SQL 和上下文，不重新执行 |
| 我的 SQL | 保存整个标签、更新、另存为、搜索、打开、重命名和删除；仅本人可见 |
| 路径部署 | `/sqlplat/` 前缀、开发代理、静态构建、Nginx 开发示例及生产部署说明 |

统一「执行 SQL」按钮的规则：有选区就执行选区；选中全部即执行全文；无选区就执行光标所在的完整 SQL，而非单独一行。快捷键为 Ctrl/⌘ + Enter。格式化优先处理选区，无选区则处理全文；保存 SQL 始终保存标签全文。

历史长期保留执行信息，查询结果是有保留期的临时文件：默认结果保留 24 小时、历史保留 90 天。「我的 SQL」存储在平台数据库中，不受上述保留期影响。浏览器草稿与服务端保存项是不同数据，退出登录会清除草稿。

## 2. 技术栈和必须保留的约束

- 后端：Python **3.12**、uv、FastAPI、SQLAlchemy、Alembic、PyMySQL、Argon2、Fernet、openpyxl。
- 前端：React 19、TypeScript、Vite、Ant Design、Monaco、sql-formatter。
- 平台数据库：MySQL 8.0+；普通后端测试使用临时 SQLite。
- SQL 执行：API 进程内有界线程池，默认 4 个执行线程、20 个等待任务；**不使用 Docker、Celery、Redis**。
- API 必须运行 **单个进程、单个实例**。增加 workers 或副本会破坏进程内执行容量、结果读取锁及启动恢复的假设。
- SQL 默认自动提交、不自动重试；遇错停止后续语句，之前的写入可能已经提交。
- 会话使用 HttpOnly Cookie，变更接口校验 CSRF；历史、保存 SQL 和结果均校验所有者，管理员也不能读取别人的结果。
- 平台数据库账号与共享目标数据库账号分离。实际 SQL 权限由目标账号决定，不能把平台管理账号或 root 注册成团队共享执行连接。

## 3. 接手机器的环境与端口

Mac、Linux 均可开发。准备 uv、Python 3.12、Node.js 22.12+（开发验证使用过 Node.js 24）、MySQL 8.0+；浏览器测试另需 Google Chrome。在该机器准备自己的数据库凭据，不使用原开发机器的凭据文件。

| 服务/路径 | 当前配置 |
| --- | --- |
| API | `127.0.0.1:8001`，内部路由 `/api/...` |
| Vite 开发服务 | `127.0.0.1:5180` |
| 开发入口 | `http://127.0.0.1:5180/sqlplat/` |
| 浏览器 API/下载路径 | `/sqlplat/api/...` |
| Nginx 示例入口 | `127.0.0.1:18000/sqlplat/`，需自行配置 Nginx |
| MySQL | 通常 `127.0.0.1:3306`，按本机实际配置 |
| Doris | FE MySQL 协议端口通常为 9030，不是 HTTP 端口 |

前端生产构建后的 `dist` 可从 Mac 复制到 Linux，目录内容应放到 `/var/www/sqlplat/`，而不是 `/var/www/sqlplat/dist/`。服务器无需 Node.js 常驻；Nginx 静态映射和 API 转发步骤见 README。

## 4. 从零启动开发环境

### 4.1 推荐：本地开发初始化脚本

适用于独立的本地 MySQL 开发实例。以下在项目根目录执行；首次使用自动初始化时，**不要提前复制带占位值的 `.env.example` 到 `.env`**。

```sh
uv python install 3.12
uv sync --frozen
uv run python scripts/bootstrap-local.py
```

脚本默认连接本机 MySQL，提示隐藏输入数据库密码。非默认环境可先设置 `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`；密码也可由 `MYSQL_PASSWORD` 提供，但不应写入共享文档。初始化账号需要建库、创建用户及授权权限。

初始化脚本会：

1. `.env` 不存在时创建平台库 `sqlplat`，生成持久加密密钥，写入仅当前用户可读写的 `.env`。
2. 执行 Alembic 迁移。
3. 无管理员时创建 `admin`，将随机初始密码存入 `.local/admin-access.txt`。
4. 创建仅能访问 `sqlplat_demo.*` 的独立共享目标账号，注册「本地 MySQL」连接。
5. 创建示例表 `sqlplat_demo.atelier_demo_orders`，空表时添加示例数据。

脚本会修改本地 MySQL 的上述命名空间及账号，因此只在开发实例运行。已有 `.env` 时使用其中的配置；重复运行不是清库或恢复工具，也不会重新输出已有管理员密码。

启动两个终端：

```sh
# 终端 A，项目根目录；执行迁移后启动单进程 API
./scripts/start-api.sh
```

```sh
# 终端 B，项目根目录；首次需要时自动安装前端依赖
./scripts/start-web.sh
```

打开 `http://127.0.0.1:5180/sqlplat/`，在本机查看 `.local/admin-access.txt` 后登录。不要将该文件、`.env` 或结果文件分享给其他同学。

### 4.2 手动初始化或已有数据库

不使用脚本时，按 [README 的本地启动步骤](../README.md#本地启动) 创建专用平台数据库账号、复制并填写 `.env`、生成密钥、执行迁移、创建管理员，然后在管理中心添加目标连接。

数据库密码中的特殊字符需要 URL 编码。已有数据库必须配套原 `ENCRYPTION_KEY`；丢失或更换密钥会导致已保存连接密码无法解密。仅 HTTP 的本地开发使用 `COOKIE_SECURE=false`，HTTPS 入口使用 `true`。

手动初始化不会生成浏览器测试需要的 `.local/admin-access.txt` 和默认示例连接；若需运行现有 E2E，优先使用独立开发实例走推荐初始化流程。

## 5. 代码导航

| 文件/目录 | 接手时关注点 |
| --- | --- |
| `backend/app/main.py` | 应用生命周期、认证/CSRF、用户和连接 API、任务提交、历史、结果接口 |
| `backend/app/config.py` | `.env`/环境变量配置、限制参数和密钥校验 |
| `backend/app/models.py` | 平台 ORM 模型：User、LoginSession、Connection、Execution、Statement、SavedQuery |
| `backend/app/schemas.py`、`accounts.py` | 输入校验、账号格式、密码长度 |
| `backend/app/security.py` | 密码哈希与会话 Token 摘要 |
| `backend/app/executor.py` | 线程池、队列容量、任务状态、SQL 执行、启动恢复和定期清理 |
| `backend/app/target.py` | MySQL/Doris 连接、TLS、超时及数据库选择 |
| `backend/app/sql.py` | SQL 扫描、拆分、会话设置和事务控制校验 |
| `backend/app/results.py` | 结果落盘、类型序列化、分页、导出和读取锁 |
| `backend/app/saved_queries.py` | 个人 SQL 的 CRUD、搜索、归属与连接绑定校验 |
| `backend/app/cli.py` | 手动创建管理员 |
| `backend/alembic/versions/` | 结构迁移，当前 head 为 `d19297a3c813` |
| `frontend/src/App.tsx` | 登录、全局导航、退出清理、跨页恢复 |
| `frontend/src/Workbench.tsx` | 标签和草稿状态、元数据树、执行范围、任务轮询、保存项绑定 |
| `frontend/src/SqlEditor.tsx` | Monaco 和本地 worker 配置，按需加载 |
| `frontend/src/sql.ts`、`formatSql.ts` | 执行范围计算、SQL 拆分、格式化 |
| `frontend/src/Results.tsx` | 结果表格及下载 |
| `frontend/src/History.tsx` | 历史列表和打开操作 |
| `frontend/src/SavedQueries.tsx`、`SaveQueryModal.tsx` | 我的 SQL 和保存弹窗 |
| `frontend/src/Admin.tsx` | 用户与连接管理、删除确认 |
| `frontend/src/api.ts`、`types.ts` | API 前缀、CSRF、错误处理和前端数据类型 |
| `frontend/src/style.css`、`main.tsx` | 全局样式与 Ant Design 主题 |
| `frontend/vite.config.ts` | `/sqlplat/` base、5180 端口、API 路径及 Cookie 代理转换 |
| `frontend/playwright.config.ts` | 8001/5180 服务启动与 Chrome E2E 配置 |
| `shared/sql-cases.json` | 前后端 SQL 拆分共用样例 |
| `deploy/nginx-sqlplat.conf` | 代理到开发服务的 Nginx 示例；生产静态配置在 README |

## 6. 关键数据流与开发注意点

### 执行与结果

前端计算用户要执行的 SQL → 提交 API → 校验连接、SQL 和队列容量 → 保存任务 → 线程池执行 → 按语句保存状态及结果文件 → 前端轮询并加载结果。CSV/XLSX 从已保存结果导出，不重新运行 SQL。

同一任务共用一个目标连接，多语句顺序执行。结果按列的位置保存，不能改成以列名为唯一键，否则重复列名会丢数据。长整数与高精度小数需保持现有序列化策略；Excel 导出还处理公式字符串、非法 XML 字符及单元格长度限制。

默认每个结果集保存最多 100000 行，页面可预览前 1000 行，每个任务文件上限 100 MiB；超限会提示截断或错误。改变限制时同时检查 `results.py`、执行器和前端提示。

### 连接删除与并发

删除为逻辑删除：隐藏连接并清除地址、账号、密码及 TLS 配置，保留数据库关联和名称；不删除历史或个人 SQL。删除后打开旧记录返回空连接 ID，执行前需重新选择。

删除检查所有用户的排队/运行任务。删除、任务提交及保存 SQL 连接绑定采用同一连接行的 `SELECT ... FOR UPDATE`，不能改回普通查询：MySQL REPEATABLE READ 下，认证读取产生的旧快照可能使并发请求继续使用已删除连接。该行为有真实 MySQL 并发回归测试。

### 编辑器、保存和接口

- 前后端各有 SQL 扫描实现，修改语句边界时同时更新两端和共享样例。
- 格式化不提交 SQL，失败时保留原文，支持撤销。
- 工作台跨页面保持挂载，异步保存必须绑定发起操作的标签，不能更新后来切换的标签。
- 重命名保存项使用仅修改名称的 PATCH，避免覆盖别人刚更新的 SQL 内容。
- 已保存记录被删除后，原绑定更新会失败；用户可以「另存为」，不能静默创建新记录。
- `api.ts` 统一处理 CSRF、401 和 204 空响应；下载也使用同一个 `apiUrl`，避免重新写死根路径 `/api`。
- 增加接口时保留所有者校验、管理员权限和 CSRF。目标连接密码不返回给前端，也不写入日志。

### 迁移与服务重启

修改模型需新增 Alembic 迁移，不能改已应用的历史迁移或只依赖 `create_all`。常用命令：

```sh
uv run alembic -c backend/alembic.ini revision --autogenerate -m "describe change"
uv run alembic -c backend/alembic.ini upgrade head
uv run alembic -c backend/alembic.ini check
```

自动生成后检查默认值、已有数据回填、MySQL/SQLite 差异及降级兼容性。当前迁移依次处理初始表、长 SQL、微秒时间、个人 SQL 保存和连接删除。

开发启动脚本的 API 没有 `--reload`，修改后端后需重启；前端支持热更新。启动恢复会将未完成任务标为中断，不能在另一个实例旁边再启动相同平台数据库的 API。写入超时、断线或服务中断不能证明目标数据库已回滚。

## 7. 测试与验证基线

在项目根目录运行后端，前端命令在 `frontend` 目录运行：

```sh
uv sync --frozen
uv run pytest -q
uv run alembic -c backend/alembic.ini check
cd frontend
npm ci
npm test
npm run build
npm run e2e
```

普通 pytest 不需要真实目标数据库，MySQL/Doris 集成测试默认跳过。Alembic check 使用当前 `.env` 中的平台数据库，需要先执行迁移。E2E 使用真实 API、Chrome 和本地 MySQL，不是模拟接口；可复用已运行的 8001/5180 服务，但该数据库必须是独立开发环境。

真实 MySQL 全套测试，在项目根目录执行：

```sh
RUN_MYSQL_TESTS=1 uv run pytest -q
```

MySQL 测试会在 `sqlplat_demo` 创建随机测试表；并发删除测试会创建并清理随机数据库 `sqlplat_delete_test_*`，需要建库、删库权限。不要指向生产实例。Doris 的环境变量及真实验收流程见 [testing.md](testing.md#真实-doris-验收)。

现有 E2E 会读取 `.local/admin-access.txt`，其中首版默认账号为 `admin`；修改密码后可用 `E2E_USERNAME`、`E2E_PASSWORD` 覆盖，但当前 `workbench.spec.ts` 仍要求本机凭据文件存在。测试会创建禁用的测试连接和个人 SQL；失败时检查测试遗留项，不要清理其他用户的数据。

2026-10-09 各项最近本地验证记录：

| 验证 | 结果 |
| --- | --- |
| 后端全套，启用真实本地 MySQL | 64 通过、1 个真实 Doris 测试跳过 |
| 前端组件/工具测试 | 24 通过 |
| Chrome 浏览器 E2E | 7 通过，已在新端口及 `/sqlplat/` 前缀下运行 |
| TypeScript/Vite 生产构建 | 通过 |
| Alembic 模型一致性 | 通过，无待生成升级操作 |

这些是原开发机器的分轮验证记录，不代表接手机器已通过。请在新环境重新运行相关检查。现有 Starlette 弃用警告和 Monaco/AntD 构建包大小提示不影响上述通过结果；后续可专项优化。

## 8. 已知限制与建议接手顺序

目前不提供公开注册、定时 SQL、取消任务、跨任务手动事务、DELIMITER/存储过程编辑工作流、团队共享保存项或管理员跨用户结果查看。SQL 扫描假定标准 MySQL 转义规则，不支持通过 SQL 切换 ANSI_QUOTES/NO_BACKSLASH_ESCAPES 等模式。

真实 Doris 查询/写入/DDL/元数据/超时和真实数据库 TLS 需补充验收；Linux systemd 与生产 Nginx 已有配置步骤，但本次交付未实际执行线上部署。执行并发扩容需要重新设计持久任务队列、恢复和结果锁，不能只调大 uvicorn workers。

建议接手顺序：

1. 在独立本地 MySQL 上初始化，确认 8001/5180 和 `/sqlplat/` 正常。
2. 跑通普通测试及浏览器流程，记录本机基线。
3. 阅读 `main.py`、`executor.py`、`results.py` 和 `Workbench.tsx`，理解任务及标签状态。
4. 获得专用 Doris/TLS 测试实例后完成剩余验收。
5. 新需求按影响范围补充回归；数据模型变更同时提交迁移、配置说明和必要的前端类型变更。

## 9. 交付文件与独立配置

继续开发需要完整源代码、锁文件、迁移、共享测试样例、脚本及文档。以下内容应在接手机器自行生成，不作为普通源代码交付：`.env`、`.local/admin-access.txt`、`.local/results`、`.venv`、`node_modules`、浏览器草稿及测试截图。

若交接的是已有平台数据而非独立新开发环境，需通过单独的受控渠道移交平台数据库备份和配套 `ENCRYPTION_KEY`；需要保留下载结果时同时移交结果目录。不要把这些敏感内容写入本文。

其他文档：

- [设计说明](design.md)：架构、权限、数据与执行设计。
- [测试说明](testing.md)：MySQL/Doris 与浏览器测试方法。
- [验证记录](acceptance.md)：已验证项目及尚未验证范围。
- [实施记录](implementation.md)：早期实施过程及首版补充记录。
- [README](../README.md)：启动、配置和线上部署操作。
