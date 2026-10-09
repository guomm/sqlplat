import { useEffect, useState } from "react";
import { Alert, App, Button, Empty, Pagination, Spin, Tabs, Tag } from "antd";
import { DownloadOutlined, CopyOutlined } from "@ant-design/icons";
import { api, apiUrl, query } from "./api";
import type { Task, ResultPage, Statement } from "./types";
export const statuses: Record<string, { text: string; color: string }> = {
  queued: { text: "排队中", color: "default" },
  running: { text: "执行中", color: "processing" },
  success: { text: "成功", color: "success" },
  failed: { text: "失败", color: "error" },
  interrupted: { text: "中断", color: "warning" },
};
export const utc = (value: string) =>
  new Date(value.endsWith("Z") ? value : value + "Z").toLocaleString("zh-CN", {
    hour12: false,
  });
export default function Results({ task }: { task: Task | null }) {
  const { message } = App.useApp();
  const [sid, setSid] = useState<number>(),
    [page, setPage] = useState(1),
    [data, setData] = useState<ResultPage | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [widths, setWidths] = useState<Record<number, number>>({});
  const statements = task?.statements || [],
    current = statements.find((s) => s.id === sid) || statements[0];
  const running = task && ["queued", "running"].includes(task.status);
  useEffect(() => {
    setSid(undefined);
    setPage(1);
    setWidths({});
  }, [task?.id]);
  useEffect(() => {
    let alive = true;
    setData(null);
    setError("");
    if (!task || !current?.columns.length || running) return;
    setLoading(true);
    api<ResultPage>(
      `/executions/${task.id}/results/${current.id}?${query({ offset: (page - 1) * 100, limit: 100 })}`,
    )
      .then((v) => {
        if (alive) setData(v);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [task?.id, task?.status, current?.id, page]);
  async function download(format: string) {
    if (!task || !current) return;
    try {
      const response = await fetch(
        apiUrl(
          `/executions/${task.id}/results/${current.id}/download?format=${format}`,
        ),
        { credentials: "same-origin" },
      );
      if (!response.ok) {
        const v = await response.json();
        throw new Error(v.detail || "下载失败");
      }
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `查询结果-${current.ordinal + 1}.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      message.error((e as Error).message);
    }
  }
  function resize(index: number, event: React.PointerEvent) {
    event.preventDefault();
    const start = event.clientX,
      initial = widths[index] || 180;
    const move = (e: PointerEvent) =>
      setWidths((v) => ({
        ...v,
        [index]: Math.max(90, initial + e.clientX - start),
      }));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  }
  function summary(s: Statement) {
    return s.columns.length
      ? `${s.saved_rows.toLocaleString()} 行已保存`
      : `影响 ${s.affected_rows.toLocaleString()} 行`;
  }
  if (!task)
    return (
      <div className="result-empty">
        <div className="empty-glyph">↳</div>
        <h3>结果将在这里呈现</h3>
        <p>选择连接并执行 SQL，开始探索数据</p>
        <div className="shortcut">
          ⌘ / Ctrl + Enter <span>执行当前语句</span>
        </div>
      </div>
    );
  const state = statuses[task.status] || statuses.failed;
  return (
    <section className="results">
      <div className="result-heading">
        <div>
          <strong>执行结果</strong>
          <Tag color={state.color}>{state.text}</Tag>
          <span className="muted">
            {task.elapsed_ms} ms · {task.connection_name}
          </span>
        </div>
        <div className="result-actions">
          {current?.columns.length && !running && (
            <>
              <Button
                aria-label="下载 CSV"
                icon={<DownloadOutlined />}
                disabled={!!error}
                onClick={() => download("csv")}
              >
                CSV
              </Button>
              <Button
                aria-label="下载 Excel"
                icon={<DownloadOutlined />}
                disabled={!!error}
                onClick={() => download("xlsx")}
              >
                Excel
              </Button>
            </>
          )}
        </div>
      </div>
      {task.error && (
        <Alert
          type={task.status === "interrupted" ? "warning" : "error"}
          message={task.error}
          showIcon
        />
      )}
      {running && (
        <div className="running-state">
          <Spin />
          <span>SQL 正在后台执行，刷新后可从执行历史继续查看</span>
        </div>
      )}
      {statements.length > 0 && (
        <Tabs
          size="small"
          activeKey={String(current?.id)}
          onChange={(id) => {
            setSid(Number(id));
            setPage(1);
            setWidths({});
          }}
          items={statements.map((s) => ({
            key: String(s.id),
            label: (
              <span>
                语句 {s.ordinal + 1} <span className="muted">{summary(s)}</span>
              </span>
            ),
          }))}
        />
      )}
      {current?.truncated && (
        <Alert
          type="warning"
          showIcon
          message="结果已截断，下载仅包含已保存的数据，并非完整查询结果。"
        />
      )}
      {error && <Alert type="warning" message={error} showIcon />}
      {loading && (
        <div className="loading-result">
          <Spin />
        </div>
      )}
      {!running && current && !current.columns.length && (
        <div className="write-result">
          <span>✓</span>
          <h3>
            {current.status === "success" ? "语句执行完成" : "语句未完成"}
          </h3>
          <p>
            {summary(current)} · {current.elapsed_ms} ms
          </p>
          <p className="muted">自动提交模式：已生效的写入不会自动回滚。</p>
        </div>
      )}
      {data && (
        <>
          <div className="result-table-scroll">
            <table className="result-table">
              <colgroup>
                <col style={{ width: 55 }} />
                {data.columns.map((_, i) => (
                  <col key={i} style={{ width: widths[i] || 180 }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th className="row-index">#</th>
                  {data.columns.map((c, i) => (
                    <th key={i}>
                      {c.name}
                      <span
                        className="resize-handle"
                        onPointerDown={(e) => resize(i, e)}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, r) => (
                  <tr key={r}>
                    <td className="row-index">{(page - 1) * 100 + r + 1}</td>
                    {row.map((v, i) => (
                      <td key={i} title={v === null ? "NULL" : String(v)}>
                        <span className={v === null ? "null-value" : ""}>
                          {v === null ? "NULL" : String(v)}
                        </span>
                        <button
                          className="copy-cell"
                          aria-label="复制单元格"
                          onClick={() =>
                            navigator.clipboard
                              .writeText(v === null ? "NULL" : String(v))
                              .then(() => message.success("已复制"))
                              .catch(() => message.error("浏览器不允许复制"))
                          }
                        >
                          <CopyOutlined />
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.rows.length && (
              <Empty
                description="查询成功，没有返回数据"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            )}
          </div>
          <div className="result-footer">
            <span>
              预览前 {data.total.toLocaleString()} 行 · 已保存{" "}
              {data.saved_rows.toLocaleString()} 行
            </span>
            <Pagination
              size="small"
              current={page}
              pageSize={100}
              total={data.total}
              showSizeChanger={false}
              onChange={setPage}
            />
          </div>
        </>
      )}
    </section>
  );
}
