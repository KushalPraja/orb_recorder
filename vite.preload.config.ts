import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';

// Preload-script Vite config — entry/outDir are controlled by the Forge Vite plugin.
export default defineConfig({
  build: {
    minify: false,
    sourcemap: true,
    rollupOptions: {
      external: [
        'electron',
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
      ],
    },
  },
});
