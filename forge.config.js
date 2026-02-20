module.exports = {
  packagerConfig: {
    name: "Orb",
    icon: "./assets/icons/Document",

    asar: {
      unpack: "**/{uiohook-napi,Wallpapers}/**",
    },

    extraResource: ["./bin"],

    ignore: [
      // Renderer source — Vite output already in dist/
      /^\/src\/renderer/,
      /^\/\.vite/,
      /^\/vite\.config/,
      /^\/forge\.config/,
      /^\/bin/,
      /^\/\.pybuild/,
      /^\/node_modules\/@electron-forge/,
      /^\/node_modules\/@vitejs/,
      /^\/node_modules\/vite/,
      /^\/node_modules\/electron($|\/)/,
      /^\/node_modules\/concurrently/,
      /^\/node_modules\/wait-on/,
      /^\/node_modules\/.*\/(\.github|\.travis\.yml|test|tests|__tests__|docs|examples|coverage|benchmark|benchmarks|typings|types)($|\/)/,
      /^\/node_modules\/.*\.(md|map|ts|flow|coffee|patch|bat|sh)$/,
      /^\/(CONTRIBUTING|README|todolist|implementation_plan)\.md$/,
      /^\/\.eslint/,
      /^\/\.prettier/,
      /^\/\.git($|\/)/,
    ],
  },
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "Orb",
      },
    },
  ],
};
