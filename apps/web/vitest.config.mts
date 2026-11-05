import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// src/lib と静的な規則のテストは node、部品のテストは jsdom で動かす。
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/lib/**/*.test.ts', 'tests/lint/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['tests/components/**/*.test.tsx'],
          setupFiles: ['tests/setup-dom.ts'],
        },
      },
    ],
  },
});
