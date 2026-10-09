import React from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider, App as AntApp } from "antd";
import zhCN from "antd/locale/zh_CN";
import App from "./App";
import "./style.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      button={{ autoInsertSpace: false }}
      theme={{
        components: {
          Button: {
            controlHeight: 32,
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 500,
            iconGap: 6,
            defaultBg: "#126c5e",
            defaultColor: "#ffffff",
            defaultBorderColor: "transparent",
            defaultHoverBg: "#0e594e",
            defaultHoverColor: "#ffffff",
            defaultHoverBorderColor: "transparent",
            defaultActiveBg: "#0a493f",
            defaultActiveColor: "#ffffff",
            defaultActiveBorderColor: "transparent",
            defaultShadow: "none",
            primaryShadow: "none",
            dangerShadow: "none",
            paddingInline: 12,
          },
          Input: {
            controlHeight: 40,
            borderRadius: 9,
            colorBgContainer: "#f4f7fa",
            colorBorder: "#e1e7ee",
            hoverBg: "#edf2f7",
            activeBg: "#f4f7fa",
            hoverBorderColor: "#93b4a6",
            activeBorderColor: "#126c5e",
            activeShadow: "0 0 0 2px #166f5c12",
            addonBg: "#f4f7fa",
          },
          Select: {
            controlHeight: 40,
            borderRadius: 9,
            selectorBg: "#f4f7fa",
            colorBorder: "#e1e7ee",
            hoverBorderColor: "#93b4a6",
            activeBorderColor: "#126c5e",
            activeOutlineColor: "#166f5c12",
          },
        },
        token: {
          colorPrimary: "#126c5e",
          colorInfo: "#126c5e",
          borderRadius: 7,
          fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
          colorText: "#243443",
        },
      }}
    >
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
