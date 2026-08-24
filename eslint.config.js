import js from '@eslint/js';
import globals from 'globals';

export default [
    { ignores: ['dist/**', 'coverage/**', '.wrangler-dist/**', '.wrangler/**', 'playwright-report/**', 'test-results/**'] },
    js.configs.recommended,
    {
        files: ['js/**/*.js', 'worker/**/*.js', 'tests/**/*.js', '*.config.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: { ...globals.browser, ...globals.node },
        },
        rules: {
            'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            'no-console': ['warn', { allow: ['warn', 'error'] }],
        },
    },
    {
        files: ['worker/**/*.js'],
        languageOptions: { globals: { WebSocketPair: 'readonly' } },
    },
];
