import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import fs from 'fs';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  
  // Try to load fallback from firebase config
  let firebaseApiKey = "";
  try {
    const firebaseConfigPath = path.resolve(__dirname, 'firebase-applet-config.json');
    if (fs.existsSync(firebaseConfigPath)) {
      const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf-8'));
      firebaseApiKey = firebaseConfig.apiKey || "";
    }
  } catch (e) {
    console.error("Failed to load firebase config for fallback key:", e);
  }

  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env': JSON.stringify(process.env),
      'process.env.GEMINI_API_KEY': JSON.stringify(
        process.env.GEMINI_API_KEY || 
        process.env.GOOGLE_API_KEY || 
        env.GEMINI_API_KEY || 
        firebaseApiKey || 
        ""
      ),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
