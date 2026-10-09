import { useEffect, useState } from "react";
import { App, Button, Input, Select, Table, Tag } from "antd";
import { ReloadOutlined, ArrowRightOutlined } from "@ant-design/icons";
import { api, query } from "./api";
import type { Task } from "./types";
import { statuses, utc } from "./Results";
export default function History({
  onRestore,
}: {
  onRestore: (id: string) => void;
}) {
  const { message } = App.useApp();
  const [items, setItems] = useState<Task[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [status, setStatus] = useState(""),
    [search, setSearch] = useState(""),
    [q, setQ] = useState(""),
    [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try {
      const v = await api<{ items: Task[]; total: number }>(
        `/executions?${query({ page, status, q })}`,
      );
      setItems(v.items);
      setTotal(v.total);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [page, status, q]);
  return (
    <div className="page-container">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR QUERY JOURNEY</span>
          <h1>执行历史</h1>
          <p>每一次探索，都有迹可循。这里只展示你的执行记录。</p>
        </div>
        <Button icon={<ReloadOutlined />} onClick={load}>
          刷新记录
        </Button>
      </div>
      <div className="page-card">
        <div className="filter-row">
          <Input.Search
            placeholder="搜索 SQL 内容"
            aria-label="搜索 SQL 内容"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={(v) => {
              setQ(v);
              setPage(1);
            }}
            allowClear
            style={{ width: 340 }}
          />
          <Select
            aria-label="执行状态"
            value={status}
            style={{ width: 140 }}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            options={[
              { value: "", label: "全部状态" },
              ...Object.entries(statuses).map(([value, s]) => ({
                value,
                label: s.text,
              })),
            ]}
          />
          <span className="muted">共 {total} 条记录</span>
        </div>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={items}
          className="history-table"
          tableLayout="fixed"
          scroll={{ x: 1100 }}
          pagination={{
            current: page,
            pageSize: 20,
            total,
            onChange: setPage,
            showSizeChanger: false,
          }}
          columns={[
            {
              title: "SQL",
              dataIndex: "sql",
              width: "50%",
              render: (v) => <code className="sql-preview">{v}</code>,
            },
            {
              title: "连接 / 数据库",
              width: "15%",
              render: (_, t) => (
                <div>
                  {t.connection_name}
                  <div className="muted">{t.database || "默认数据库"}</div>
                </div>
              ),
            },
            {
              title: "状态",
              width: "8%",
              render: (_, t) => (
                <Tag color={statuses[t.status]?.color}>
                  {statuses[t.status]?.text}
                </Tag>
              ),
            },
            {
              title: "耗时",
              dataIndex: "elapsed_ms",
              width: "8%",
              render: (v) => `${v} ms`,
            },
            {
              title: "执行时间",
              dataIndex: "created_at",
              width: "13%",
              render: utc,
            },
            {
              title: "操作",
              width: "6%",
              render: (_, t) => (
                <div className="history-actions">
                  <Button
                    type="default"
                    icon={<ArrowRightOutlined />}
                    onClick={() => onRestore(t.id)}
                  >
                    打开
                  </Button>
                </div>
              ),
            },
          ]}
          locale={{ emptyText: "还没有执行记录，去工作台运行第一条 SQL" }}
        />
      </div>
    </div>
  );
}
