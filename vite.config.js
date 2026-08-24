import { defineConfig } from 'vite';

export default defineConfig({
    build: {
        // Three.js is intentionally shipped as one cacheable engine bundle.
        chunkSizeWarningLimit: 600,
    },
});
