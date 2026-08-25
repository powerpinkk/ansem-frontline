import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    timeout: 60_000,
    fullyParallel: false,
    workers: process.env.CI ? 1 : undefined,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 2 : 0,
    reporter: process.env.CI
        ? [['list'], ['github']]
        : [['list'], ['html', { open: 'never' }]],
    use: {
        baseURL: 'http://127.0.0.1:4173',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
    },
    projects: [
        { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    ],
    webServer: {
        command: 'npm run dev -- --host 127.0.0.1 --port 4173 --mode e2e',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: false,
        env: { ...process.env, VITE_STREAM_URL: 'disabled' },
    },
});
