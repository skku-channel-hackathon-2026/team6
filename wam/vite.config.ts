import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  base: '',
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8797',
    },
  },
  build: {
    outDir: './dist',
  },
})
