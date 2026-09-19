import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/integration',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'web-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'h5-mobile', use: { ...devices['iPhone 13'] } },
    { name: 'pad-landscape', use: { ...devices['iPad Pro 11 landscape'] } },
  ],
});
