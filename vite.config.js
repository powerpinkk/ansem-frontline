import { defineConfig } from 'vite';

export default defineConfig({
    build: {
        // Three is intentionally isolated as one long-lived engine chunk.
        chunkSizeWarningLimit: 600,
        rollupOptions: {
            output: {
                // The engine changes far less often than the simulation. Keeping
                // it separate lets repeat visitors retain the large cached chunk.
                manualChunks(id) {
                    if (id.includes('node_modules/three/')) return 'three';
                    return undefined;
                },
            },
        },
    },
});
