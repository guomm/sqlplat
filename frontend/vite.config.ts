import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: "/sqlplat/",
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      "/sqlplat/api": {
        target: "http://127.0.0.1:8001",
        rewrite: (path) => path.replace(/^\/sqlplat(?=\/api(?:\/|$))/, ""),
        cookiePathRewrite: "/sqlplat/",
      },
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
