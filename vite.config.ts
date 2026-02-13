import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { openClawOfficeApiPlugin } from './server/vite-office-plugin'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), openClawOfficeApiPlugin()],
  server: {
    host: true,
    port: 5179,
  },
})
