import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  build: {
    rollupOptions: {
      external: [],
      output: {
        format: 'umd',
        name: 'VuePasswordGenerator',
        globals: {
          vue: 'Vue'
        }
      }
    }
  }
})