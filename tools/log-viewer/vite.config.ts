import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/log-viewer/',
  server: {
    port: 8107,
  },
});
