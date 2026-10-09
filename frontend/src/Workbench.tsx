import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { Alert, App, Button, Input, Select, Spin, Tabs, Tree, Tag } from "antd";
import {
  PlusOutlined,
  CaretRightOutlined,
  AlignLeftOutlined,
  SaveOutlined,
  CodeOutlined,
  DatabaseOutlined,
  TableOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
const Editor = lazy(() => import("./SqlEditor"));
import type { editor } from "monaco-editor";
import { api, send, query } from "./api";
import type { Connection, Task, User, SavedQuery } from "./types";
import { executionText, type ExecutionMode } from "./sql";
import Results from "./Results";
import SaveQueryModal, { type SaveSnapshot } from "./SaveQueryModal";
import { formatSql } from "./formatSql";

type Draft = {
  id: string;
  name: string;
  sql: string;
  connection?: number;
  database: string;
  taskId?: string;
  savedSqlId?: string;
  active?: boolean;
};
const fresh = (): Draft => ({
  id: crypto.randomUUID(),
  name: "新查询",
  sql: "-- 从一条 SQL 开始探索\nSELECT 1 AS hello;",
  database: "",
});
type Node = {
  title: React.ReactNode;
  key: string;
  isLeaf?: boolean;
  children?: Node[];
  icon?: React.ReactNode;
};
export default function Workbench({
  user,
  restore,
  onRestored,
  savedRestore,
  onSavedRestored,
}: {
  user: User;
  restore: string;
  savedRestore: string;
  onSavedRestored: () => void;
  onRestored: () => void;
}) {
  const { message } = App.useApp(),
    storage = `sqlplat-drafts-${user.id}`;
  const [tabs, setTabs] = useState<Draft[]>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(storage) || "null");
      return Array.isArray(parsed) &&
        parsed.length &&
        parsed.every(
          (t) =>
            typeof t.id === "string" &&
            typeof t.sql === "string" &&
            typeof t.name === "string" &&
            typeof t.database === "string",
        )
        ? parsed
        : [fresh()];
    } catch {
      return [fresh()];
    }
  });
  const [active, setActive] = useState(
      tabs.find((t) => t.active)?.id || tabs[0].id,
    ),
    [connections, setConnections] = useState<Connection[]>([]),
    [databases, setDatabases] = useState<string[]>([]),
    [tables, setTables] = useState<string[]>([]),
    [nodes, setNodes] = useState<Node[]>([]),
    [search, setSearch] = useState(""),
    [metadataError, setMetadataError] = useState(""),
    [metaLoading, setMetaLoading] = useState(false),
    [submitting, setSubmitting] = useState(false),
    [task, setTask] = useState<Task | null>(null),
    [editorHeight, setEditorHeight] = useState(320);
  const edit = useRef<editor.IStandaloneCodeEditor | null>(null),
    tab = tabs.find((t) => t.id === active) || tabs[0];
  const patch = (data: Partial<Draft>) =>
    setTabs((old) => old.map((t) => (t.id === active ? { ...t, ...data } : t)));
  const formatEditor = () => {
    const instance = edit.current;
    const model = instance?.getModel();
    if (!instance || !model) return;
    const selection = instance.getSelection();
    const range =
      selection && !selection.isEmpty() ? selection : model.getFullModelRange();
    const source = model.getValueInRange(range);
    if (!source.trim()) return;
    try {
      const formatted = formatSql(source);
      instance.pushUndoStop();
      instance.executeEdits("format-sql", [
        { range, text: formatted, forceMoveMarkers: true },
      ]);
      instance.pushUndoStop();
      instance.focus();
    } catch {
      message.warning("无法格式化这段 SQL，请检查语法或方言；原文已保留");
    }
  };
  const [saveSnapshot, setSaveSnapshot] = useState<SaveSnapshot | null>(null);
  const saveQuery = (copy = false) => {
    const sql = edit.current?.getModel()?.getValue() ?? tab.sql;
    if (!sql.trim()) {
      message.warning("请输入需要保存的 SQL");
      return;
    }
    setSaveSnapshot({
      draftId: tab.id,
      savedSqlId: copy ? undefined : tab.savedSqlId,
      name: tab.name === "新查询" || tab.name === "历史查询" ? "" : tab.name,
      sql,
      connection_id: tab.connection ?? null,
      database: tab.database,
    });
  };
  useEffect(() => {
    if (!savedRestore) return;
    let alive = true;
    api<SavedQuery>(`/saved-queries/${savedRestore}`)
      .then((v) => {
        if (!alive) return;
        const draft = {
          ...fresh(),
          name: v.name,
          sql: v.sql,
          connection: v.connection_id ?? undefined,
          database: v.database,
          savedSqlId: v.id,
        };
        setTabs((old) => [...old, draft]);
        setActive(draft.id);
        onSavedRestored();
      })
      .catch((e) => {
        if (alive) {
          message.error(e.message);
          onSavedRestored();
        }
      });
    return () => {
      alive = false;
    };
  }, [savedRestore]);
  const [draftError, setDraftError] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(
        storage,
        JSON.stringify(tabs.map((t) => ({ ...t, active: t.id === active }))),
      );
      setDraftError(false);
    } catch {
      setDraftError(true);
    }
  }, [tabs, storage, active]);
  const loadConnections = () =>
    api<Connection[]>("/connections")
      .then((v) => {
        const available = v.filter((c) => c.enabled);
        setConnections(available);
        setTabs((old) =>
          old.map((draft) =>
            draft.connection &&
            !available.some((c) => c.id === draft.connection)
              ? { ...draft, connection: undefined, database: "" }
              : draft,
          ),
        );
      })
      .catch((e) => message.error(e.message));
  useEffect(() => {
    loadConnections();
    window.addEventListener("connections-changed", loadConnections);
    return () =>
      window.removeEventListener("connections-changed", loadConnections);
  }, []);
  useEffect(() => {
    if (!restore) return;
    api<Task>(`/executions/${restore}`)
      .then((v) => {
        const t = {
          ...fresh(),
          name: "历史查询",
          sql: v.sql,
          connection: v.connection_id ?? undefined,
          database: v.database,
        };
        setTabs((old) => [...old, t]);
        setActive(t.id);
        onRestored();
      })
      .catch((e) => {
        message.error(e.message);
        onRestored();
      });
  }, [restore]);
  useEffect(() => {
    let alive = true;
    setDatabases([]);
    setMetadataError("");
    if (!tab.connection) return;
    setMetaLoading(true);
    api<string[]>(`/connections/${tab.connection}/databases`)
      .then((v) => {
        if (alive) setDatabases(v);
      })
      .catch((e) => {
        if (alive) setMetadataError(e.message);
      })
      .finally(() => {
        if (alive) setMetaLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [tab.connection]);
  useEffect(() => {
    let alive = true;
    setTables([]);
    setNodes([]);
    setSearch("");
    setMetadataError("");
    if (!tab.connection || !tab.database) return;
    setMetaLoading(true);
    api<string[]>(
      `/connections/${tab.connection}/tables?${query({ database: tab.database })}`,
    )
      .then((v) => {
        if (alive) {
          setTables(v);
          setNodes(
            v.map((t) => ({ key: t, title: t, icon: <TableOutlined /> })),
          );
        }
      })
      .catch((e) => {
        if (alive) setMetadataError(e.message);
      })
      .finally(() => {
        if (alive) setMetaLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [tab.connection, tab.database]);
  useEffect(() => {
    let alive = true,
      timer: ReturnType<typeof setTimeout>;
    setTask(null);
    if (!tab.taskId) return;
    const poll = async () => {
      try {
        const v = await api<Task>(`/executions/${tab.taskId}`);
        if (alive) {
          setTask(v);
          if (["queued", "running"].includes(v.status))
            timer = setTimeout(poll, 1000);
        }
      } catch (e) {
        if (alive) message.error((e as Error).message);
      }
    };
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [tab.taskId, active]);
  const submitLock = useRef(false);
  async function execute(mode: ExecutionMode = "auto") {
    if (
      submitLock.current ||
      (tab.taskId &&
        (!task ||
          task.id !== tab.taskId ||
          ["queued", "running"].includes(task.status)))
    ) {
      message.info("当前查询正在执行，请等待结果");
      return;
    }
    if (!tab.connection) {
      message.warning("请先选择数据库连接");
      return;
    }
    const instance = edit.current,
      model = instance?.getModel();
    const sql = model?.getValue() ?? tab.sql;
    const selection = instance?.getSelection(),
      position = instance?.getPosition();
    try {
      const text = executionText(
        mode,
        sql,
        model && selection ? model.getValueInRange(selection) : "",
        model && position ? model.getOffsetAt(position) : 0,
      );
      if (!text.trim()) {
        message.warning("当前范围内没有可执行 SQL");
        return;
      }
      submitLock.current = true;
      setSubmitting(true);
      const v = await api<{ id: string }>(
        "/executions",
        send("POST", {
          connection_id: tab.connection,
          database: tab.database,
          sql: text,
        }),
      );
      patch({ taskId: v.id });
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }
  const executeRef = useRef(execute);
  executeRef.current = execute;
  const metadataContext = `${tab.connection || ""}:${tab.database}`;
  const metadataContextRef = useRef(metadataContext);
  metadataContextRef.current = metadataContext;
  async function loadFields(node: { key: React.Key }) {
    const key = String(node.key);
    if (!tab.connection || !tables.includes(key)) return;
    try {
      const rows = await api<Record<string, string>[]>(
        `/connections/${tab.connection}/columns?${query({ database: tab.database, table: key })}`,
      );
      if (metadataContextRef.current !== metadataContext) return;
      setNodes((old) =>
        old.map((n) =>
          n.key === key
            ? {
                ...n,
                children: rows.map((r, i) => ({
                  key: `${key}:field:${i}`,
                  isLeaf: true,
                  title: (
                    <span className="field-node">
                      <span>{r.Field}</span>
                      <small>{r.Type}</small>
                    </span>
                  ),
                  icon: <CodeOutlined />,
                })),
              }
            : n,
        ),
      );
    } catch (e) {
      message.error((e as Error).message);
    }
  }
  const add = () => {
    const t = {
      ...fresh(),
      connection: tab.connection,
      database: tab.database,
    };
    setTabs((v) => [...v, t]);
    setActive(t.id);
  };
  const running =
    submitting ||
    (!!tab.taskId &&
      (!task ||
        task.id !== tab.taskId ||
        ["queued", "running"].includes(task.status)));
  return (
    <div className="workbench">
      {saveSnapshot && (
        <SaveQueryModal
          snapshot={saveSnapshot}
          onClose={() => setSaveSnapshot(null)}
          onSaved={(draftId, saved) =>
            setTabs((old) =>
              old.map((draft) =>
                draft.id === draftId
                  ? { ...draft, savedSqlId: saved.id, name: saved.name }
                  : draft,
              ),
            )
          }
        />
      )}
      <aside className="schema-panel">
        <div className="sidebar-heading">
          <span className="eyebrow">DATA EXPLORER</span>
          <Button
            type="text"
            size="small"
            icon={<ReloadOutlined />}
            aria-label="刷新连接"
            onClick={loadConnections}
          />
        </div>
        <h3>数据资源</h3>
        <label>连接</label>
        <Select
          aria-label="数据库连接"
          placeholder="选择连接"
          value={tab.connection}
          onChange={(id) => {
            const c = connections.find((c) => c.id === id);
            patch({ connection: id, database: c?.database || "" });
          }}
          options={connections.map((c) => ({
            value: c.id,
            label: (
              <span className="connection-option">
                <span className="connection-name">{c.name}</span>
                <Tag className="connection-kind">{c.kind.toUpperCase()}</Tag>
              </span>
            ),
          }))}
        />
        <label>数据库</label>
        <Select
          aria-label="数据库"
          showSearch
          placeholder="选择数据库"
          value={tab.database || undefined}
          onChange={(database) => patch({ database: database || "" })}
          options={databases.map((d) => ({ value: d, label: d }))}
          loading={metaLoading}
          allowClear
          onClear={() => patch({ database: "" })}
        />
        <div className="schema-divider" />
        <Input
          aria-label="搜索表"
          placeholder="搜索表…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
        />
        <div className="schema-caption">
          <DatabaseOutlined /> {tab.database || "尚未选择数据库"}
          <span>{tables.length} 张表</span>
        </div>
        {metadataError && <Alert type="warning" message={metadataError} />}
        <Spin spinning={metaLoading}>
          <Tree
            key={metadataContext}
            showIcon
            blockNode
            loadData={loadFields}
            treeData={nodes.filter((n) =>
              n.key.toLowerCase().includes(search.toLowerCase()),
            )}
            onDoubleClick={(_, node) => {
              if (tables.includes(String(node.key))) {
                const quoted =
                  "`" + String(node.key).replaceAll("`", "``") + "`";
                edit.current?.trigger("insert", "type", { text: quoted });
              }
            }}
          />
        </Spin>
        {!metaLoading && !tables.length && (
          <p className="schema-empty">
            选择连接与数据库，
            <br />
            浏览可用的表和字段。
          </p>
        )}
        <div className="schema-bottom">
          <span className="status-dot" /> 权限由数据库账号决定
        </div>
      </aside>
      <div className="query-panel">
        <div className="workspace-title">
          <div>
            <span className="eyebrow">SQL WORKSPACE</span>
            <h2>
              查询工作台 <span>让数据说话</span>
            </h2>
          </div>
          <div className="workspace-meta">MYSQL / DORIS</div>
        </div>
        <div className="editor-card">
          <Tabs
            type="editable-card"
            activeKey={active}
            onChange={(id) => {
              setActive(id);
            }}
            onEdit={(key, action) => {
              if (action === "add") add();
              else {
                if (tabs.length === 1) return;
                const rest = tabs.filter((t) => t.id !== key);
                setTabs(rest);
                if (active === key) setActive(rest[0].id);
              }
            }}
            items={tabs.map((t, i) => ({
              key: t.id,
              label: (
                <span>
                  <CodeOutlined />{" "}
                  {t.name === "新查询" ? `查询 ${i + 1}` : t.name}
                </span>
              ),
              closable: tabs.length > 1,
            }))}
          />
          <div className="editor-toolbar">
            <div className="execution-buttons">
              <Button
                type="primary"
                icon={<CaretRightOutlined />}
                disabled={running || !tab.connection}
                loading={submitting}
                aria-label="执行 SQL"
                title="选中代码时执行选区，全选执行全部；未选中时执行光标所在的完整 SQL"
                onClick={() => execute()}
              >
                执行 SQL
              </Button>
              <Button
                className="format-action"
                icon={<AlignLeftOutlined />}
                aria-label="格式化 SQL"
                onClick={formatEditor}
                title="有选区时格式化选区，否则格式化全部；可撤销"
              >
                格式化 SQL
              </Button>
              <span className="toolbar-divider" />
              <Button
                className="save-action"
                icon={<SaveOutlined />}
                aria-label="保存 SQL"
                onClick={() => saveQuery()}
              >
                保存 SQL
              </Button>
              {tab.savedSqlId && (
                <Button
                  className="save-as-action"
                  aria-label="另存为"
                  onClick={() => saveQuery(true)}
                >
                  另存为
                </Button>
              )}
            </div>
            <span className="autocommit">
              <span className="status-dot" /> 自动提交{" "}
              <span title="写入可能立即生效，多语句遇错停止，不自动回滚">
                ⓘ
              </span>
            </span>
          </div>
          <Suspense
            fallback={
              <div className="loading-result">
                <Spin />
              </div>
            }
          >
            <Editor
              height={editorHeight}
              language="sql"
              path={tab.id}
              value={tab.sql}
              onChange={(value) => patch({ sql: value || "" })}
              onMount={(instance) => {
                edit.current = instance;
                instance.addCommand(2048 | 3, () => executeRef.current("auto"));
              }}
              options={{
                fontFamily: '"SFMono-Regular", Consolas, monospace',
                fontSize: 14,
                lineHeight: 25,
                minimap: { enabled: false },
                padding: { top: 20, bottom: 20 },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                wordWrap: "on",
              }}
            />
          </Suspense>
          <div className="editor-status">
            <span>
              SQL · UTF-8{draftError ? " · 浏览器存储已满，草稿未保存" : ""}
            </span>
            <span>
              ⌘ / Ctrl + Enter 执行 · 选区优先，否则执行当前完整语句 ·
              默认自动提交
            </span>
          </div>
        </div>
        <div
          className="panel-resizer"
          role="separator"
          aria-label="调整编辑区高度"
          onPointerDown={(e) => {
            e.preventDefault();
            const start = e.clientY,
              height = editorHeight;
            const move = (ev: PointerEvent) =>
              setEditorHeight(
                Math.max(180, Math.min(650, height + ev.clientY - start)),
              );
            const end = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", end);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", end);
          }}
        >
          <span />
        </div>
        <div className="result-card">
          <Results task={task} />
        </div>
      </div>
    </div>
  );
}
