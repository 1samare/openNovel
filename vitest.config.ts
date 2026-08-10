import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  test: {
    environment: 'happy-dom',
    include: ['tests/ui/**/*.spec.ts'],
    setupFiles: ['./tests/ui/setup.ts'],
    clearMocks: true,
    restoreMocks: true
  }
})
