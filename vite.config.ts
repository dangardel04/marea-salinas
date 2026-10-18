import { defineConfig } from 'vite';

// base relativa: el mismo build sirve en la raíz de un dominio (Cloudflare Pages)
// y en una subruta (GitHub Pages: https://usuario.github.io/repositorio/).
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 700 },
});
