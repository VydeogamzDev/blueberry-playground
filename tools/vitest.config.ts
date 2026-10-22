import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['tools/**/*.ts'], exclude: ['tools/vitest.config.ts'] } });
