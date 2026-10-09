import { useRef, useState } from "react";
import { App, Button, Form, Input, Modal } from "antd";
import { api, send } from "./api";
import type { SavedQuery } from "./types";

export type SaveSnapshot = {
  draftId: string;
  savedSqlId?: string;
  name: string;
  sql: string;
  connection_id: number | null;
  database: string;
};
export default function SaveQueryModal({
  snapshot,
  onClose,
  onSaved,
}: {
  snapshot: SaveSnapshot;
  onClose: () => void;
  onSaved: (draftId: string, saved: SavedQuery) => void;
}) {
  const { message } = App.useApp();
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  return (
    <Modal
      title={snapshot.savedSqlId ? "更新已保存 SQL" : "保存 SQL"}
      open
      onCancel={() => {
        if (!savingRef.current) onClose();
      }}
      keyboard={!saving}
      footer={null}
      maskClosable={!saving}
      closable={!saving}
    >
      <p className="muted">保存当前标签的全部 SQL 和连接信息，仅自己可见。</p>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ name: snapshot.name }}
        onFinish={async ({ name }) => {
          if (savingRef.current) return;
          savingRef.current = true;
          setSaving(true);
          try {
            const saved = await api<SavedQuery>(
              snapshot.savedSqlId
                ? `/saved-queries/${snapshot.savedSqlId}`
                : "/saved-queries",
              send(snapshot.savedSqlId ? "PUT" : "POST", {
                name: name.trim(),
                sql: snapshot.sql,
                connection_id: snapshot.connection_id,
                database: snapshot.database,
              }),
            );
            onSaved(snapshot.draftId, saved);
            message.success(snapshot.savedSqlId ? "SQL 已更新" : "SQL 已保存");
            onClose();
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
            { max: 100, message: "名称最多 100 字" },
          ]}
        >
          <Input autoFocus maxLength={100} placeholder="例如：每日订单汇总" />
        </Form.Item>
        <div className="modal-actions">
          <Button aria-label="取消" disabled={saving} onClick={onClose}>
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
  );
}
