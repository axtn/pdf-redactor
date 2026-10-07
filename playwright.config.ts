import { defineConfig } from '@playwright/test';

const port = Number(process.env.PDF_REDACTOR_TEST_PORT ?? 3015);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests',
  use: { baseURL, headless: true, channel: 'chrome' },
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    env: { PDF_REDACTOR_TEST_BUILD: '1' },
  },
  reporter: 'list',
});
