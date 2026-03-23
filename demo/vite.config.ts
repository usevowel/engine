/**
 * Vite Configuration
 * 
 * Configuration for the demo development server with HTTPS support
 * (required for microphone access in browsers)
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    port: 5173,
    open: false, // Don't auto-open browser
    https: true, // Enable HTTPS for microphone access
  },
});
