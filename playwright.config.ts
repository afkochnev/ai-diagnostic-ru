import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:3000",
    channel: "chrome",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "mobile", testMatch: "landing.spec.ts", use: { viewport: { width: 393, height: 852 } } },
    { name: "tablet", testMatch: "landing.spec.ts", use: { viewport: { width: 768, height: 1024 } } },
    { name: "desktop", testMatch: "landing.spec.ts", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "identity", testMatch: "auth.spec.ts", use: { viewport: { width: 393, height: 852 } } },
    { name: "company", testMatch: "company.spec.ts", use: { viewport: { width: 393, height: 852 } } },
    { name: "company-tablet", testMatch: "company.spec.ts", use: { viewport: { width: 768, height: 1024 } } },
    { name: "company-desktop", testMatch: "company.spec.ts", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "result-page", testMatch: "result-page.spec.ts", use: { viewport: { width: 393, height: 852 } } },
    { name: "admin-shell", testMatch: "admin-shell.spec.ts", use: { viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: {
    command: "npm run start",
    url: "http://127.0.0.1:3000/ru",
    reuseExistingServer: !process.env.CI,
  },
});
