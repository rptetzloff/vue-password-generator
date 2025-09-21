import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2015',
    minify: 'esbuild',
    rollupOptions: {
      external: [],
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        manualChunks: undefined
      }
    }
  },
  server: {
    port: 3000,
    open: true,
    host: true
  },
  preview: {
    port: process.env.PORT || 4173,
    host: '0.0.0.0'
  },
  resolve: {
    alias: {
      'vue': 'vue/dist/vue.esm-bundler.js'
    }
  }
})