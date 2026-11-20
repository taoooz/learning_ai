import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:3000';
const e2eAccount = 'eeee-eeee-eeee';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: '.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000',
      cwd: './python-agent',
      url: 'http://127.0.0.1:8000/docs',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "node -e \"require('fs').rmSync('.next-e2e',{recursive:true,force:true})\" && npm run build && npx next start -p 3000",
      url: `${baseURL}/login`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        ...process.env,
        NEXT_PUBLIC_LESSON_STORE: 'server',
        NEXT_DIST_DIR: '.next-e2e',
        INVITE_CODES: e2eAccount,
        PYTHON_AGENT_URL: 'http://127.0.0.1:8000',
      },
    },
  ],
});
