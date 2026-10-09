# 实施计划与进度

依据：`docs/design.md`。在当前新建目录内直接实施，不创建额外工作树。

## 任务

- [x] 1. 后端基础、登录与权限：FastAPI、SQLAlchemy、Alembic、会话和 CSRF；验证禁用账号与归属隔离。
- [x] 2. 连接、元数据和 SQL 执行：加密配置、PyMySQL、语句扫描、容量受控线程池、结果落盘；验证拆分、容量和执行故障。
- [x] 3. 结果与下载：分页、类型、CSV/XLSX、截断、清理和重启恢复；验证精度与公式防护。
- [x] 4. 前端工作台与管理：多标签 Monaco、库表树、历史、用户及连接表单、状态轮询；组件测试与浏览器验证。
- [ ] 5. 交付与审查：本地部署、初始化、README、代码审查、完整测试与真实 MySQL 联调已完成；真实 Doris 联调等待实例。

## 约束与裁决

- 用户明确要求不使用 Docker；Python 使用 uv + Python 3.12。
- API 单进程单实例；4 个执行线程、20 个等待任务，不使用 Celery 或 Redis。
- 默认自动提交，无 SQL 自动重试；所有任务结果仅拥有者可访问。
- 平台数据库生产使用 MySQL；测试允许 SQLite，目标连接始终为 MySQL/Doris。
- 所有执行限制与保留期由环境变量配置；缺失加密密钥时拒绝启动，不能生成临时密钥导致已有密码不可读。
- 下载锁覆盖读取与传输，清理不能删除正在读取的结果。
- 在写入、截断、超时或连接中断时不声称自动回滚。

## 验证记录

以下为早期实施阶段记录。首版最新功能、端口、路径和验证基线见 [handover.md](handover.md) 与 [acceptance.md](acceptance.md)：后端 64 项通过、1 个 Doris 跳过，前端 24 项、浏览器 7 项通过。

2026-10-09，本地 Python 3.12.11 / MySQL 8.4.3：

- `RUN_MYSQL_TESTS=1 uv run pytest -q`：40 项通过，1 条上游 Starlette 弃用警告。
- 前端 `npm test`：14 项通过；`npm run build`：通过，存在 Monaco/AntD 包大小提示。
- `npm run e2e`：真实 Chrome、API、本地 MySQL，3 项通过。
- Ruff 检查、Python 编译检查通过；Alembic check 无待生成结构变更。
- 代码审查发现并修复共享 root 连接权限过大、SQL 会话设置绕过、重复快捷键提交、Excel 长整数精度、下载中断锁释放等问题；相关回归测试通过。
- 用户提供的 root 凭据仅用于本地平台配置与初始化。默认共享目标连接使用随机独立账号，只能访问示例库。
- Doris 适配已有测试替身覆盖，尚未获得真实 FE 实例；详细证据与限制见 `docs/acceptance.md`。
