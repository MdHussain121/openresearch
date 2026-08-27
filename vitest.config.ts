import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  oxc: {
    jsx: {
      runtime: 'automatic',
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: [
      'packages/**/*.{test,spec}.ts',
      'packages/**/*.{test,spec}.tsx',
      'apps/**/*.{test,spec}.ts',
      'apps/**/*.{test,spec}.tsx',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
      include: [
        'packages/citations/src/**/*.ts',
        'packages/research/src/**/*.ts',
        'packages/ai/src/**/*.ts',
        'packages/plugins/src/**/*.ts',
        'packages/ui/src/**/*.ts',
        'packages/editor/src/extensions/**/*.ts',
        'packages/editor/src/types.ts',
      ],
      exclude: [
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.test-d.ts',
        '**/index.ts',
        '**/types.ts',
        '**/providers/base.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@openresearch/citations': path.resolve(import.meta.dirname, 'packages/citations/src'),
      '@openresearch/ai': path.resolve(import.meta.dirname, 'packages/ai/src'),
      '@openresearch/research': path.resolve(import.meta.dirname, 'packages/research/src'),
      '@openresearch/plugins': path.resolve(import.meta.dirname, 'packages/plugins/src'),
      '@openresearch/tokens': path.resolve(import.meta.dirname, 'packages/tokens'),
      '@openresearch/ui': path.resolve(import.meta.dirname, 'packages/ui/src'),
      '@openresearch/editor': path.resolve(import.meta.dirname, 'packages/editor/src'),
    },
  },
});
