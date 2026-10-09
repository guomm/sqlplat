import { useEffect, useState } from "react";
import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
  Table,
  Tabs,
  Tag,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  ApiOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import { api, send } from "./api";
import type { Connection, User } from "./types";
export default function Admin() {
  const { message, modal } = App.useApp();
  const [connections, setConnections] = useState<Connection[]>([]),
    [users, setUsers] = useState<User[]>([]),
    [view, setView] = useState("connections"),
    [connOpen, setConnOpen] = useState(false),
    [editing, setEditing] = useState<Connection | null>(null),
    [userOpen, setUserOpen] = useState(false),
    [editingUser, setEditingUser] = useState<User | null>(null),
    [saving, setSaving] = useState(false),
    [testing, setTesting] = useState<number | null>(null);
  const [connForm] = Form.useForm(),
    [userForm] = Form.useForm();
  const load = async () => {
    try {
      const [c, u] = await Promise.all([
        api<Connection[]>("/connections"),
        api<User[]>("/users"),
      ]);
      setConnections(c);
      setUsers(u);
    } catch (e) {
      message.error((e as Error).message);
    }
  };
  useEffect(() => {
    load();
  }, []);
  function openConnection(conn: Connection | null) {
    setEditing(conn);
    connForm.resetFields();
    connForm.setFieldsValue(
      conn
        ? { ...conn, password: undefined }
        : { kind: "mysql", port: 3306, enabled: true, tls: { enabled: false } },
    );
    setConnOpen(true);
  }
  function openUser(user: User | null) {
    setEditingUser(user);
    userForm.resetFields();
    userForm.setFieldsValue(user || { role: "user" });
    setUserOpen(true);
  }
  return (
    <div className="page-container admin-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">ADMINISTRATION</span>
          <h1>管理中心</h1>
          <p>维护团队账号与数据连接，让每一次查询顺畅开始。</p>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() =>
            view === "connections" ? openConnection(null) : openUser(null)
          }
        >
          {view === "connections" ? "新建连接" : "创建用户"}
        </Button>
      </div>
      <div className="page-card">
        <Tabs
          activeKey={view}
          onChange={setView}
          items={[
            {
              key: "connections",
              label: `数据库连接 · ${connections.length}`,
              children: (
                <Table
                  rowKey="id"
                  dataSource={connections}
                  scroll={{ x: 1000 }}
                  columns={[
                    {
                      title: "连接名称",
                      dataIndex: "name",
                      render: (v) => <strong>{v}</strong>,
                    },
                    {
                      title: "类型",
                      dataIndex: "kind",
                      render: (v) => (
                        <Tag color={v === "doris" ? "cyan" : "blue"}>
                          {v.toUpperCase()}
                        </Tag>
                      ),
                    },
                    {
                      title: "地址",
                      render: (_, c) => (
                        <code>
                          {c.host}:{c.port}
                        </code>
                      ),
                    },
                    {
                      title: "默认数据库",
                      dataIndex: "database",
                      render: (v) => v || "—",
                    },
                    {
                      title: "状态",
                      dataIndex: "enabled",
                      render: (v) => (
                        <Tag color={v ? "success" : "default"}>
                          {v ? "启用" : "禁用"}
                        </Tag>
                      ),
                    },
                    {
                      title: "操作",
                      width: 314,
                      render: (_, c) => (
                        <div className="connection-actions">
                          <Button
                            type="default"
                            icon={<ApiOutlined />}
                            loading={testing === c.id}
                            onClick={async () => {
                              setTesting(c.id);
                              try {
                                await api(`/connections/${c.id}/test`, {
                                  method: "POST",
                                });
                                message.success("连接测试成功");
                              } catch (e) {
                                message.error((e as Error).message);
                              } finally {
                                setTesting(null);
                              }
                            }}
                          >
                            测试连接
                          </Button>
                          <Button
                            type="default"
                            icon={<EditOutlined />}
                            onClick={() => openConnection(c)}
                          >
                            编辑
                          </Button>
                          <Button
                            danger
                            aria-label="删除"
                            icon={<DeleteOutlined />}
                            onClick={() => {
                              const confirm = modal.confirm({
                                title: "删除数据连接？",
                                content: `“${c.name}”将从所有用户的连接列表移除并清除连接凭据。执行历史和保存的 SQL 会保留，后续执行需重新选择连接。`,
                                okText: "删除连接",
                                okButtonProps: {
                                  danger: true,
                                  "aria-label": "删除连接",
                                },
                                cancelText: "取消",
                                maskClosable: false,
                                onOk: async () => {
                                  confirm.update({
                                    cancelButtonProps: { disabled: true },
                                    keyboard: false,
                                  });
                                  try {
                                    await api(`/connections/${c.id}`, {
                                      method: "DELETE",
                                    });
                                    setConnections((old) =>
                                      old.filter((item) => item.id !== c.id),
                                    );
                                    window.dispatchEvent(
                                      new Event("connections-changed"),
                                    );
                                    message.success("数据连接已删除");
                                  } catch (error) {
                                    message.error((error as Error).message);
                                    throw error;
                                  } finally {
                                    confirm.update({
                                      cancelButtonProps: { disabled: false },
                                      keyboard: true,
                                    });
                                  }
                                },
                              });
                            }}
                          >
                            删除
                          </Button>
                        </div>
                      ),
                    },
                  ]}
                  locale={{ emptyText: "添加第一个 MySQL 或 Doris 连接" }}
                />
              ),
            },
            {
              key: "users",
              label: `团队成员 · ${users.length}`,
              children: (
                <Table
                  rowKey="id"
                  dataSource={users}
                  columns={[
                    {
                      title: "账号",
                      dataIndex: "username",
                      render: (v) => <strong>{v}</strong>,
                    },
                    {
                      title: "角色",
                      dataIndex: "role",
                      render: (v) => (v === "admin" ? "管理员" : "普通用户"),
                    },
                    {
                      title: "状态",
                      dataIndex: "enabled",
                      render: (v) => (
                        <Tag color={v ? "success" : "default"}>
                          {v ? "正常" : "已禁用"}
                        </Tag>
                      ),
                    },
                    {
                      title: "操作",
                      render: (_, u) => (
                        <Button
                          type="default"
                          icon={<EditOutlined />}
                          onClick={() => openUser(u)}
                        >
                          管理
                        </Button>
                      ),
                    },
                  ]}
                  locale={{ emptyText: "暂无用户" }}
                />
              ),
            },
          ]}
        />
      </div>
      <Modal
        width={620}
        title={editing ? "编辑数据库连接" : "新建数据库连接"}
        open={connOpen}
        onCancel={() => setConnOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <Form
          form={connForm}
          layout="vertical"
          onFinish={async (values) => {
            setSaving(true);
            try {
              const payload = {
                ...values,
                database: values.database || "",
                tls: {
                  enabled: false,
                  ca: "",
                  cert: "",
                  key: "",
                  ...values.tls,
                },
              };
              if (!editing || values.empty_password)
                payload.password = values.password || "";
              else if (!values.password) delete payload.password;
              if (values.empty_password) payload.password = "";
              delete payload.empty_password;
              await api(
                editing ? `/connections/${editing.id}` : "/connections",
                send(editing ? "PUT" : "POST", payload),
              );
              setConnOpen(false);
              message.success("连接已保存");
              load();
            } catch (e) {
              message.error((e as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        >
          <Form.Item
            name="name"
            label="连接名称"
            rules={[{ required: true, max: 100 }]}
          >
            <Input placeholder="例如：生产 Doris / 分析 MySQL" />
          </Form.Item>
          <div className="form-grid">
            <Form.Item
              name="kind"
              label="数据库类型"
              rules={[{ required: true }]}
            >
              <Select
                options={[
                  { value: "mysql", label: "MySQL" },
                  { value: "doris", label: "Doris" },
                ]}
                onChange={(v) => {
                  if (!editing)
                    connForm.setFieldValue("port", v === "doris" ? 9030 : 3306);
                }}
              />
            </Form.Item>
            <Form.Item name="port" label="端口" rules={[{ required: true }]}>
              <InputNumber min={1} max={65535} style={{ width: "100%" }} />
            </Form.Item>
          </div>
          <Form.Item name="host" label="主机地址" rules={[{ required: true }]}>
            <Input placeholder="数据库服务地址" />
          </Form.Item>
          <div className="form-grid">
            <Form.Item
              name="username"
              label="数据库账号"
              rules={[{ required: true }]}
            >
              <Input autoComplete="off" />
            </Form.Item>
            <Form.Item name="password" label="数据库密码">
              <Input.Password
                autoComplete="new-password"
                placeholder={editing ? "留空保留原密码" : "允许空密码"}
              />
            </Form.Item>
          </div>
          {editing && (
            <Form.Item
              name="empty_password"
              label="将数据库密码设为空"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          )}
          <Form.Item name="database" label="默认数据库（可选）">
            <Input />
          </Form.Item>
          <div className="form-grid">
            <Form.Item name="enabled" label="连接启用" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item
              name={["tls", "enabled"]}
              label="启用 TLS（校验证书）"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          </div>
          <Form.Item noStyle shouldUpdate>
            {() =>
              connForm.getFieldValue(["tls", "enabled"]) && (
                <>
                  <p className="muted">
                    以下路径为 API 服务器中的证书文件路径；不填 CA
                    时使用系统信任库。
                  </p>
                  <Form.Item name={["tls", "ca"]} label="CA 证书路径">
                    <Input />
                  </Form.Item>
                  <div className="form-grid">
                    <Form.Item name={["tls", "cert"]} label="客户端证书路径">
                      <Input />
                    </Form.Item>
                    <Form.Item name={["tls", "key"]} label="客户端密钥路径">
                      <Input />
                    </Form.Item>
                  </div>
                </>
              )
            }
          </Form.Item>
          <Button block type="primary" htmlType="submit" loading={saving}>
            保存连接
          </Button>
        </Form>
      </Modal>
      <Modal
        title={editingUser ? "管理用户" : "创建用户"}
        open={userOpen}
        onCancel={() => setUserOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <Form
          form={userForm}
          layout="vertical"
          onFinish={async (values) => {
            setSaving(true);
            try {
              const payload = editingUser
                ? {
                    role: values.role,
                    enabled: values.enabled,
                    ...(values.password ? { password: values.password } : {}),
                  }
                : values;
              await api(
                editingUser ? `/users/${editingUser.id}` : "/users",
                send(editingUser ? "PATCH" : "POST", payload),
              );
              setUserOpen(false);
              message.success("用户已保存");
              load();
            } catch (e) {
              message.error((e as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        >
          <Form.Item
            name="username"
            label="账号"
            rules={[
              {
                required: true,
                transform: (value: string) => value?.trim(),
                max: 80,
                pattern:
                  /^(?:[\p{L}\p{N}_.-]+|[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+)$/u,
                message:
                  "填写邮箱或自定义账号，最多 80 位；名称可用中文、字母、数字、点、下划线或短横线",
              },
            ]}
          >
            <Input disabled={!!editingUser} placeholder="邮箱或自定义账号" />
          </Form.Item>
          <Form.Item
            name="password"
            label={editingUser ? "重置密码（留空不修改）" : "初始密码"}
            rules={[
              { required: !editingUser, min: 8, message: "密码至少 8 位" },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "user", label: "普通用户" },
                { value: "admin", label: "管理员" },
              ]}
            />
          </Form.Item>
          {editingUser && (
            <Form.Item name="enabled" label="账号启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
          <Button block htmlType="submit" type="primary" loading={saving}>
            保存用户
          </Button>
        </Form>
      </Modal>
    </div>
  );
}
