// electron.vite.config.ts
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import tailwindcss from "@tailwindcss/vite";
var __electron_vite_injected_dirname = "C:\\Users\\krish\\Projects\\orb_recorder";
function copyStaticPlugin(files) {
  return {
    name: "copy-static",
    closeBundle() {
      for (const { src, dest } of files) {
        const destDir = path.dirname(dest);
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(src, dest);
      }
    }
  };
}
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [
      copyStaticPlugin([
        {
          src: path.resolve(__electron_vite_injected_dirname, "src/main/recording-overlay.html"),
          dest: path.resolve(__electron_vite_injected_dirname, "dist-electron/main/recording-overlay.html")
        }
      ])
    ],
    build: {
      outDir: "dist-electron/main",
      rollupOptions: {
        input: "src/main/index.ts"
      }
    }
  },
  preload: {
    build: {
      outDir: "dist-electron/preload",
      rollupOptions: {
        input: "src/main/preload.ts"
      }
    }
  },
  renderer: {
    root: "src/renderer",
    plugins: [react(), tailwindcss()],
    build: {
      outDir: path.resolve(__electron_vite_injected_dirname, "dist"),
      rollupOptions: {
        input: path.resolve(__electron_vite_injected_dirname, "src/renderer/index.html")
      }
    },
    resolve: {
      alias: {
        "@": path.resolve(__electron_vite_injected_dirname, "src/renderer")
      }
    }
  }
});
export {
  electron_vite_config_default as default
};
