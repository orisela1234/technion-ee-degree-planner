import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// בונה קובץ HTML יחיד שנפתח בלחיצה כפולה, בלי שרת
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 10000,
    // pdf.js (קריאת גיליון הציונים) משתמש ב-top-level await
    target: 'es2022',
  },
})
