import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e/frontline',
    timeout: 60_000,
    fullyParallel: false,
    workers: 1,
    forbidOnly: Boolean(process.env.CI),
    retries: 0,
    reporter: [['list'], ['json', { outputFile: '.artifacts/frontline-2d/e2e.json' }]],
    expect: { timeout: 15_000 },
    use: {
        baseURL: 'http://127.0.0.1:4188',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
    },
    projects: [
        { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    ],
    webServer: {
        command: 'node scripts/serve-candidate.mjs',
        url: 'http://127.0.0.1:4188',
        reuseExistingServer: false,
    },
});
