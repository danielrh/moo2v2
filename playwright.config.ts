import { defineConfig } from '@playwright/test';

// Uses the system Chrome (channel) to avoid a browser download; --no-sandbox and
// --disable-dev-shm-usage are required inside this dev sandbox.
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  retries: 0,
  reporter: [['list']],
  use: {
    channel: 'chrome',
    headless: true,
    launchOptions: {
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
    baseURL: 'http://localhost:5173',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
