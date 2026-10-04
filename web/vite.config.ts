import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/__admin/',
  plugins: [react()],
  server: {
    proxy: {
      '/__admin/api': 'http://localhost:3000',
      '/m': 'http://localhost:3000',
    },
  },
});
