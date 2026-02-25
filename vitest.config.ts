import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        setupFiles: ['./src/setupTests.ts'],
        globals: true,
        coverage: {
            provider: 'v8',
            include: ['src/**/*.{ts,tsx}', 'electron/**/*.ts'],
            exclude: [
                '**/*.test.*',
                '**/*.spec.*',
                '**/setupTests.*',
                'src/test-utils/**',
                'electron/main.ts',
                'electron/preload.ts',
            ],
            reporter: ['text', 'text-summary'],
            thresholds: {
                lines: 70,
                functions: 70,
                branches: 65,
                statements: 70,
            },
        },
    },
});
