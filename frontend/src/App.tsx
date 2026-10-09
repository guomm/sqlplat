import { useEffect, useState } from "react";
import {
  App as AntApp,
  Button,
  Dropdown,
  Form,
  Input,
  Modal,
  Spin,
} from "antd";
import {
  DatabaseOutlined,
  BookOutlined,
  HistoryOutlined,
  SettingOutlined,
  LogoutOutlined,
  KeyOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { api, send, setCsrf } from "./api";
import type { User } from "./types";
import Workbench from "./Workbench";
import History from "./History";
import Admin from "./Admin";
import SavedQueries from "./SavedQueries";

export default function App() {
  const { message } = AntApp.useApp();
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [page, setPage] = useState("workbench"),
    [restore, setRestore] = useState(""),
    [savedRestore, setSavedRestore] = useState(""),
    [passwordOpen, setPasswordOpen] = useState(false);
  const [form] = Form.useForm();
  const clear = () => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("sqlplat-drafts-")) localStorage.removeItem(key);
    }
    setUser(null);
    setCsrf("");
    setPage("workbench");
    setRestore("");
    setSavedRestore("");
  };
  useEffect(() => {
    api<{ user: User; csrf_token: string }>("/auth/me")
      .then((v) => {
        setUser(v.user);
        setCsrf(v.csrf_token);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    window.addEventListener("session-expired", clear);
    return () => window.removeEventListener("session-expired", clear);
  }, [user]);
  const fail = (e: unknown) =>
    message.error(e instanceof Error ? e.message : "请求失败");
  if (loading)
    return (
      <div className="boot">
        <Spin size="large" />
        <p>正在打开工作台…</p>
      </div>
    );
  if (!user)
    return (
      <div className="login-shell">
        <div className="login-story">
          <div className="brand light">
            <span className="brand-mark">a</span>SQL Atelier
          </div>
          <div className="story-body">
            <span className="eyebrow">A SPACE FOR YOUR DATA</span>
            <h1>
              每一次查询，
              <br />
              都离答案更近。
            </h1>
            <p>
              连接数据，专注探索。
              <br />
              你的 SQL 工作台，从这里开始。
            </p>
            <div className="code-art">
              <span>01</span> SELECT insight
              <br />
              <span>02</span> FROM your_data
              <br />
              <span>03</span> WHERE curiosity = TRUE;
            </div>
          </div>
          <div className="story-footer">
            MYSQL / DORIS <i /> 数据工作台
          </div>
        </div>
        <div className="login-form">
          <div className="login-inner">
            <span className="eyebrow">WELCOME BACK</span>
            <h2>登录工作台</h2>
            <p className="muted">使用管理员为你创建的账号继续</p>
            <Form
              layout="vertical"
              onFinish={async (values) => {
                try {
                  const v = await api<{ user: User; csrf_token: string }>(
                    "/auth/login",
                    send("POST", values),
                  );
                  setUser(v.user);
                  setCsrf(v.csrf_token);
                } catch (e) {
                  fail(e);
                }
              }}
            >
              <Form.Item
                label="账号"
                name="username"
                rules={[{ required: true, message: "请输入账号" }]}
              >
                <Input
                  size="large"
                  prefix={<UserOutlined />}
                  autoComplete="username"
                  placeholder="邮箱或自定义账号"
                />
              </Form.Item>
              <Form.Item
                label="密码"
                name="password"
                rules={[{ required: true, message: "请输入密码" }]}
              >
                <Input.Password
                  size="large"
                  autoComplete="current-password"
                  placeholder="请输入密码"
                />
              </Form.Item>
              <Button block size="large" type="primary" htmlType="submit">
                进入工作台 →
              </Button>
            </Form>
            <p className="login-note">账号由管理员管理 · 不开放公开注册</p>
          </div>
        </div>
      </div>
    );
  const nav = [
    ["workbench", "SQL 工作台", <DatabaseOutlined />],
    ["history", "执行历史", <HistoryOutlined />],
    ["saved", "我的 SQL", <BookOutlined />],
    ...(user.role === "admin"
      ? [["admin", "管理中心", <SettingOutlined />]]
      : []),
  ];
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">a</span>SQL Atelier
          <span className="brand-sub">数据工作台</span>
        </div>
        <nav>
          {nav.map(([id, label, icon]) => (
            <button
              key={String(id)}
              className={page === id ? "nav-active" : ""}
              onClick={() => setPage(String(id))}
            >
              {icon}
              {label}
            </button>
          ))}
        </nav>
        <Dropdown
          menu={{
            items: [
              { key: "password", label: "修改密码", icon: <KeyOutlined /> },
              { key: "logout", label: "退出登录", icon: <LogoutOutlined /> },
            ],
            onClick: async ({ key }) => {
              if (key === "password") setPasswordOpen(true);
              else {
                try {
                  await api("/auth/logout", { method: "POST" });
                  clear();
                } catch (e) {
                  fail(e);
                }
              }
            },
          }}
        >
          <button className="user-menu">
            <span className="avatar">{user.username[0].toUpperCase()}</span>
            {user.username}
            <span className="role-label">
              {user.role === "admin" ? "管理员" : "成员"}
            </span>
          </button>
        </Dropdown>
      </header>
      <main className="main-content">
        <div hidden={page !== "workbench"}>
          <Workbench
            user={user}
            restore={restore}
            savedRestore={savedRestore}
            onSavedRestored={() => setSavedRestore("")}
            onRestored={() => setRestore("")}
          />
        </div>
        {page === "history" && (
          <History
            onRestore={(id) => {
              setRestore(id);
              setPage("workbench");
            }}
          />
        )}
        {page === "saved" && (
          <SavedQueries
            onOpen={(id) => {
              setSavedRestore(id);
              setPage("workbench");
            }}
          />
        )}
        {page === "admin" && <Admin />}
      </main>
      <Modal
        title="修改密码"
        open={passwordOpen}
        onCancel={() => setPasswordOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            try {
              await api("/auth/password", send("POST", values));
              setPasswordOpen(false);
              clear();
              message.success("密码已修改，请重新登录");
            } catch (e) {
              fail(e);
            }
          }}
        >
          <Form.Item
            name="old_password"
            label="原密码"
            rules={[{ required: true }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item
            name="new_password"
            label="新密码"
            rules={[{ required: true, min: 8, message: "密码至少 8 位" }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            保存并重新登录
          </Button>
        </Form>
      </Modal>
    </div>
  );
}
