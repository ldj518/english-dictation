import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    // 音频是独立构建产物（scripts/build-audio.py 生成到 public/audio），
    // 关闭自动清空避免误删 / 被安全机制拦截
    emptyOutDir: false,
  },
})
