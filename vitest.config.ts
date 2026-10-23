import integrationFiles from './src/__test__/integration-files.json';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/__test__/setup-env.ts', 'src/__test__/setup-isolation.ts'],
    fileParallelism: process.env.TEST_INTEGRATION !== 'true',
    exclude: process.env.TEST_INTEGRATION === 'true' ? [] : integrationFiles,
    server: { deps: { inline: ['next-auth', '@auth/core'] } },
    include: process.env.TEST_INTEGRATION === 'true' ? integrationFiles : ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/**/*.ts'],
    },
  },
});
