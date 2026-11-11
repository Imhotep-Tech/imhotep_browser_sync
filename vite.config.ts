import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';

function getInputs() {
  const inputs: Record<string, string> = {};
  const popupPath = resolve(__dirname, 'src/popup/index.html');
  const swPath = resolve(__dirname, 'src/background/service-worker.ts');

  if (fs.existsSync(popupPath)) {
    inputs['popup'] = popupPath;
  }
  if (fs.existsSync(swPath)) {
    inputs['service-worker'] = swPath;
  }

  // If both exist or during final build
  if (Object.keys(inputs).length === 0) {
    inputs['popup'] = popupPath;
    inputs['service-worker'] = swPath;
  }

  return inputs;
}

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: getInputs(),
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'service-worker') {
            return 'service-worker.js';
          }
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
});
