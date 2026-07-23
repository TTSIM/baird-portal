import { defineConfig, devices } from "@playwright/test";

const live = process.env.RUN_LIVE_DR_HASSAN === "1";
const baseURL = live ? process.env.DR_HASSAN_BASE_URL : "http://127.0.0.1:4173";

if (live && !baseURL) {
  throw new Error("DR_HASSAN_BASE_URL is required when RUN_LIVE_DR_HASSAN=1.");
}

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure"
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } }
  ],
  webServer: live ? undefined : {
    command: "npm run build:static && node scripts/serve-static.mjs",
    url: "http://127.0.0.1:4173/ask-dr-hassan.html",
    reuseExistingServer: true
  }
});
