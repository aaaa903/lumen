import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

// 主进程与预加载走独立构建：产物为 CJS，直接由 Electron 加载。
// 渲染层是普通 Vite 应用，根目录就是仓库根，index.html 在根下。
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/main',
      rollupOptions: {
        input: { index: resolve(process.cwd(), 'electron/main.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/preload',
      rollupOptions: {
        input: { index: resolve(process.cwd(), 'electron/preload.ts') },
      },
    },
  },
  renderer: {
    root: '.',
    plugins: [react()],
    build: {
      outDir: 'dist/renderer',
      emptyOutDir: true,
      minify: true,
      rollupOptions: {
        input: resolve(process.cwd(), 'index.html'),
      },
    },
  },
})
