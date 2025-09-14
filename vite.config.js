import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  // Update this to match your GitHub repository name
  // For example: base: '/my-password-generator/'
  base: process.env.NODE_ENV === 'production' ? '/REPOSITORY/' : '/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['vue']
        }
      }
    }
  },
  server: {
    port: 3000,
    open: true
  }
})