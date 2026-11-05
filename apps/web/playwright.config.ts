import { defineConfig, devices } from '@playwright/test';

// `pnpm build` 済みの出力を `next start` でローカルに立てて検査する。外部には接続しない。
const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// E-21（07 §6）: WebKit と Firefox では、E-05〜E-09 だけを流す。
// `pnpm run e2e` は Chromium だけ（--project=chromium）。3 つとも流すのは `pnpm run e2e:browsers`。
// 先に `pnpm exec playwright install webkit firefox` が要る。
const CROSS_BROWSER_SPECS = /(routes|period|tables)\.spec\.ts$/;
const CROSS_BROWSER_TESTS = /E-0[5-9]:/;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: BASE_URL },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testMatch: CROSS_BROWSER_SPECS,
      grep: CROSS_BROWSER_TESTS,
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testMatch: CROSS_BROWSER_SPECS,
      grep: CROSS_BROWSER_TESTS,
    },
  ],
  webServer: {
    command: `pnpm exec next start --hostname 127.0.0.1 --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
