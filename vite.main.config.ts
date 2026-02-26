import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';

// Main-process Vite config — entry/outDir are controlled by the Forge Vite plugin.
export default defineConfig({
  build: {
    minify: false,
    sourcemap: true,
    rollupOptions: {
      external: [
        'electron',
        'electron-squirrel-startup',
        'uiohook-napi',
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
      ],
    },
  },
});
