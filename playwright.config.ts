import { defineConfig } from "@playwright/test";

// Uses the locally installed Edge (no browser download). Override with PW_CHANNEL=chrome, etc.
export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:4179",
    channel: process.env.PW_CHANNEL ?? "msedge",
    acceptDownloads: true,
  },
  webServer: {
    command: "npm run build && npx vite preview --port 4179 --strictPort",
    url: "http://localhost:4179",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
