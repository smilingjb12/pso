import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Pages: the game (index.html) plus dev labs (model viewer, run / character / sound / Mag / area / armour labs).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        viewer: resolve(__dirname, 'viewer.html'),
        runlab: resolve(__dirname, 'runlab.html'),
        charlab: resolve(__dirname, 'charlab.html'),
        soundlab: resolve(__dirname, 'soundlab.html'),
        maglab: resolve(__dirname, 'maglab.html'),
        arealab: resolve(__dirname, 'arealab.html'),
        armorlab: resolve(__dirname, 'armorlab.html'),
        swinglab: resolve(__dirname, 'swinglab.html'),
      },
    },
  },
});
