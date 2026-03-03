import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

// Simple plugin to copy static files into the main process output
function copyStaticPlugin(files: { src: string; dest: string }[]) {
  return {
    name: 'copy-static',
    closeBundle() {
      for (const { src, dest } of files) {
        const destDir = path.dirname(dest);
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(src, dest);
      }
    },
  };
}

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin(),
      copyStaticPlugin([
        {
          src: path.resolve(__dirname, 'src/main/recording-overlay.html'),
          dest: path.resolve(__dirname, 'dist-electron/main/recording-overlay.html'),
        },
      ]),
    ],
    build: {
      outDir: 'dist-electron/main',
      rollupOptions: {
        input: 'src/main/index.ts',
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron/preload',
      rollupOptions: {
        input: 'src/main/preload.ts',
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    build: {
      outDir: path.resolve(__dirname, 'dist'),
      rollupOptions: {
        input: path.resolve(__dirname, 'src/renderer/index.html'),
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src/renderer'),
      },
    },
  },
});
