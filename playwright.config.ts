import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', workers: 1, fullyParallel: false, timeout: 40_000,
  use: { baseURL: 'http://127.0.0.1:3100', browserName: 'chromium', channel: 'chrome', viewport: { width: 1120, height: 780 } },
  webServer: { command: 'npm run demo:build && npm run demo', url: 'http://127.0.0.1:3100', reuseExistingServer: false, timeout: 60_000 },
});
