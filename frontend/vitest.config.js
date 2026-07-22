import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Config mínima do Vitest para componentes React (jsdom + React Testing
// Library). Reaproveita os mesmos plugins do vite.config.js (react +
// tailwind) para que os componentes testados renderizem exatamente como em
// dev/build.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setupTests.js'],
  },
});
