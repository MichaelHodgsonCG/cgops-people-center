import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// publicDir disabled per CG house style — brand assets are imported as
// modules from src/assets (see src/assets/BRAND.md).
// Two pages: the internal app (index.html) and the public Team Member
// application form (apply.html — no auth, talks only to the hiring-intake
// edge function). vercel.json rewrites /apply to the built page.
export default defineConfig({
  plugins: [react()],
  publicDir: false,
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        apply: resolve(__dirname, 'apply.html'),
      },
    },
  },
})
