import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:5180/sqlplat/",
    viewport: { width: 1440, height: 1000 },
    channel: "chrome",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command:
        "PYTHONPATH=backend uv run uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8001 --workers 1",
      cwd: "..",
      url: "http://127.0.0.1:8001/api/health",
      reuseExistingServer: true,
    },
    {
      command: "npm run dev -- --port 5180 --strictPort",
      url: "http://127.0.0.1:5180/sqlplat/",
      reuseExistingServer: true,
    },
  ],
});
