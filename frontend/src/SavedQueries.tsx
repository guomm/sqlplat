import { useEffect, useRef, useState } from "react";
import { App, Button, Form, Input, Modal, Table } from "antd";
import { ArrowRightOutlined, ReloadOutlined } from "@ant-design/icons";
import { api, query, send } from "./api";
import type { SavedQuery } from "./types";
import { utc } from "./Results";

export default function SavedQueries({
  onOpen,
}: {
  onOpen: (id: string) => void;
}) {
  const { message, modal } = App.useApp();
  const [items, setItems] = useState<SavedQuery[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [rename, setRename] = useState<SavedQuery | null>(null);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api<{ items: SavedQuery[]; total: number }>(
      `/saved-queries?${query({ page, q })}`,
    )
      .then((v) => {
        if (!alive) return;
        if (page > 1 && !v.items.length && v.total) {
          setPage(page - 1);
          return;
        }
        setItems(v.items);
        setTotal(v.total);
      })
      .catch((e) => {
        if (alive) message.error(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [page, q, revision]);
  return (
    <div className="page-container">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR SQL LIBRARY</span>
          <h1>我的 SQL</h1>
          <p>把常用查询留在这里，下次从熟悉的地方开始。</p>
        </div>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => setRevision((v) => v + 1)}
        >
          刷新列表
        </Button>
      </div>
      <div className="page-card">
        <div className="filter-row">
          <Input.Search
            placeholder="搜索名称或 SQL"
            allowClear
            style={{ width: 340 }}
            onSearch={(v) => {
              setQ(v);
              setPage(1);
            }}
          />
          <span className="muted">共 {total} 条 SQL</span>
        </div>
        <Table<SavedQuery>
          className="saved-query-table"
          rowKey="id"
          loading={loading}
          dataSource={items}
          tableLayout="fixed"
          scroll={{ x: 1100 }}
          pagination={{
            current: page,
            pageSize: 20,
            total,
            showSizeChanger: false,
            onChange: setPage,
          }}
          locale={{
            emptyText: "还没有保存 SQL，在工作台点击“保存 SQL”开始积累",
          }}
          columns={[
            {
              title: "名称 / SQL",
              width: "43%",
              render: (_, item) => (
                <div>
                  <div className="saved-query-name">{item.name}</div>
                  <code className="sql-preview">{item.sql}</code>
                </div>
              ),
            },
            {
              title: "连接 / 数据库",
              width: "18%",
              render: (_, item) => (
                <div>
                  {item.connection_name}
                  <div className="muted">{item.database || "默认数据库"}</div>
                </div>
              ),
            },
            {
              title: "更新时间",
              width: "17%",
              dataIndex: "updated_at",
              render: utc,
            },
            {
              title: "操作",
              width: "22%",
              render: (_, item) => (
                <div className="saved-query-actions">
                  <Button
                    type="default"
                    icon={<ArrowRightOutlined />}
                    onClick={() => onOpen(item.id)}
                  >
                    打开
                  </Button>
                  <Button
                    type="default"
                    onClick={async () => {
                      try {
                        const full = await api<SavedQuery>(
                          `/saved-queries/${item.id}`,
                        );
                        form.setFieldsValue({ name: full.name });
                        setRename(full);
                      } catch (e) {
                        message.error((e as Error).message);
                      }
                    }}
                  >
                    重命名
                  </Button>
                  <Button
                    type="default"
                    danger
                    onClick={() =>
                      modal.confirm({
                        title: "删除已保存的 SQL？",
                        content: `“${item.name}”将从你的 SQL 列表移除。`,
                        okText: "确认删除",
                        okButtonProps: { "aria-label": "确认删除" },
                        cancelText: "取消",
                        onOk: async () => {
                          try {
                            await api(`/saved-queries/${item.id}`, {
                              method: "DELETE",
                            });
                            setRevision((v) => v + 1);
                            message.success("已删除");
                          } catch (e) {
                            message.error((e as Error).message);
                            throw e;
                          }
                        },
                      })
                    }
                  >
                    删除
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </div>
      <Modal
        title="重命名 SQL"
        open={!!rename}
        onCancel={() => {
          if (!savingRef.current) setRename(null);
        }}
        keyboard={!saving}
        footer={null}
        closable={!saving}
        maskClosable={!saving}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async ({ name }) => {
            if (!rename || savingRef.current) return;
            savingRef.current = true;
            setSaving(true);
            try {
              await api(
                `/saved-queries/${rename.id}`,
                send("PATCH", { name: name.trim() }),
              );
              setRename(null);
              setRevision((v) => v + 1);
            } catch (e) {
              message.error((e as Error).message);
            } finally {
              savingRef.current = false;
              setSaving(false);
            }
          }}
        >
          <Form.Item
            name="name"
            label="名称"
            rules={[
              { required: true, whitespace: true, message: "请输入名称" },
            ]}
          >
            <Input maxLength={100} />
          </Form.Item>
          <div className="modal-actions">
            <Button disabled={saving} onClick={() => setRename(null)}>
              取消
            </Button>
            <Button
              type="primary"
              aria-label="保存"
              htmlType="submit"
              loading={saving}
            >
              保存
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
