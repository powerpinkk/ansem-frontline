import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        env: { VITE_RELAY_ORIGIN: 'https://relay.frontline.test', VITE_STREAM_URL: 'wss://relay.frontline.test/stream' },
        include: ['tests/**/*.test.js'],
        exclude: ['tests/e2e/**'],
    },
});
