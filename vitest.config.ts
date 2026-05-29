import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode ?? 'test', process.cwd(), '')
  return {
    test: {
      include: ['tests/**/*.test.ts'],
      exclude: ['**/node_modules/**', '**/dist/**', 'tests/**/*.live.test.ts'],
      env,
    },
  }
})
