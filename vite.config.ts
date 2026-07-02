import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// publicDir disabled per CG house style — brand assets are imported as
// modules from src/assets (see src/assets/BRAND.md).
export default defineConfig({
  plugins: [react()],
  publicDir: false,
})
