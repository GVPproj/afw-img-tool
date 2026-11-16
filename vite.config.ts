import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { redact } from '@tanstack/redact/vite'

export default defineConfig({
  plugins: [react(), ...(process.env.NATIVE_REACT ? [] : [redact()]), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 12302,
    strictPort: true,
    // Tailscale Serve forwards this hostname to the loopback dev server.
    allowedHosts: ['asahi-mini.tail40c3ca.ts.net'],
  },
  test: { include: ['src/**/*.test.ts'] },
})
