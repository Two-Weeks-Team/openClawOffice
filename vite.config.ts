import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { openClawOfficeApiPlugin } from './server/vite-office-plugin'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), openClawOfficeApiPlugin()],
  server: {
    host: '127.0.0.1',
    port: 5179,
  },
  preview: {
    host: '127.0.0.1',
    port: 5180,
  },
})
