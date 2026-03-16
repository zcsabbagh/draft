import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    port: 3000,
    reuseExistingServer: true,
    timeout: 15_000,
  },
  projects: [
    {
      name: 'Desktop Chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'iPhone 14',
      use: {
        ...devices['iPhone 14'],
        // Use Chromium instead of WebKit for CI compatibility
        browserName: 'chromium',
      },
    },
    {
      name: 'iPad Mini',
      use: {
        ...devices['iPad Mini'],
        browserName: 'chromium',
      },
    },
  ],
});
