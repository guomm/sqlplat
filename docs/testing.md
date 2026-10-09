# 本地测试

Python 使用 uv + 3.12，不使用 Docker。

## 自动化测试

在项目根目录执行 `uv sync` 后运行：

```sh
uv run pytest
cd frontend
npm ci
npm test
npm run build
```

pytest 默认使用临时 SQLite 作为平台数据库。执行器测试替身只替代外部数据库连接；真实线程池、平台 ORM、状态迁移、结果文件、导出与 API 权限均执行生产代码。

## 真实本地 MySQL

根目录 `.env` 保存实际本地平台数据库地址与加密密钥，不提交凭据。执行 `scripts/bootstrap-local.py` 会创建平台库 `sqlplat` 和示例库 `sqlplat_demo`，不会删除已有业务库或表。首次创建管理员后，凭据位于 `.local/admin-access.txt`，权限为仅当前用户可读写。

```sh
uv run python scripts/bootstrap-local.py
RUN_MYSQL_TESTS=1 uv run pytest backend/tests/test_mysql_integration.py -v
```

集成测试从 `.env` 获取 MySQL 凭据，在 `sqlplat_demo` 中创建随机命名的独立表，结束时仅删除自己创建的表。验证 DDL、INSERT、UPDATE、SELECT、元数据、同一任务多语句、遇错停止、重复列名、长整数、高精度数值、日期、NULL 和真实 CSV/XLSX 下载。

## 浏览器流程

系统安装 Google Chrome 后运行：

```sh
cd frontend
npm run e2e
```

Playwright 启动真实 API 与前端本地服务，使用 `.local/admin-access.txt` 中的初始管理员和真实本地 MySQL 连接，验证登录、库表字段、Monaco 编辑、三种执行范围、历史回填、刷新恢复、CSV/XLSX 下载和退出清理。不使用模拟 API。

浏览器测试需要先运行本地初始化脚本。管理员密码修改后，请通过环境变量 `E2E_USERNAME`、`E2E_PASSWORD` 提供测试账号，或更新仅本机保存的凭据文件。工作台截图保存在 `.local/workbench.png`，下载文件位于 `.local/e2e-result.*`，均不提交版本控制。

## Doris

管理中心支持 Doris 的 MySQL 协议连接，默认端口 9030。实际 Doris 联调需要可访问的 FE 地址与测试账号。在未提供真实 Doris 服务时，不将 MySQL 测试结果视为 Doris 联调结果。

验收顺序：测试连接 → 查看库表字段 → 查询中文/NULL/日期/精度数据 → 多语句遇错停止 → 测试库建表/写入 → CSV/XLSX 下载 → 超时验证。

本地初始化使用提供的 MySQL 管理员凭据创建数据库，并为默认共享连接创建仅拥有 `sqlplat_demo.*` 权限的独立账号；不会把平台账号或 root 注册为共享执行连接。

## 删除连接验证

`backend/tests/test_connection_delete.py` 覆盖管理员权限、CSRF、未完成任务拦截、凭据清除、历史与保存 SQL 保留，以及删除后各接口拒绝使用。`frontend/e2e/connection-delete.spec.ts` 验证单行按钮布局、确认、取消及列表刷新。

`RUN_MYSQL_TESTS=1` 同时运行 `backend/tests/test_mysql_connection_delete.py`，验证 MySQL REPEATABLE READ 下保存 SQL 与删除连接的并发行为。该测试使用本地数据库凭据创建随机命名的 `sqlplat_delete_test_*` 独立数据库，结束时删除；测试账号需有创建和删除数据库权限。

## 真实 Doris 验收

新增 `backend/tests/test_doris_integration.py`，通过平台 API 验证 Doris 建表、INSERT 影响行数、查询、元数据、重复列名、精度、NULL、CSV/XLSX 和遇错停止。测试需要现有专用测试库及具备建表/写入/删除表权限的账号；至少一个健康 BE。只创建并删除随机命名的 `sqlplat_acceptance_*` 表，不创建数据库。

在终端设置 `DORIS_HOST`、`DORIS_PORT`（默认 9030）、`DORIS_USER`、`DORIS_DATABASE`；密码通过隐藏输入传入，避免写入命令历史：

```sh
read -s 'DORIS_PASSWORD?Doris 密码：'
export DORIS_PASSWORD
RUN_DORIS_TESTS=1 uv run pytest -q backend/tests/test_doris_integration.py
unset DORIS_PASSWORD
```

以上隐藏输入使用 macOS 默认 zsh 语法。其他变量也需 `export`。未设置 `RUN_DORIS_TESTS=1` 时测试明确跳过，跳过不能视为 Doris 验收通过。若测试进程被强制结束，需在测试库检查是否遗留上述前缀的表。

临时表采用 Doris 官方 [CREATE TABLE 示例](https://doris.apache.org/docs/3.x/sql-manual/sql-statements/table-and-view/table/CREATE-TABLE/) 中的 DUPLICATE KEY、HASH 分桶与单副本配置。
