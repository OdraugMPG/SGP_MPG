import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// PWA mínima: solo cachea el app-shell (JS/CSS/manifest/iconos) para que sea
// instalable. A propósito NO se cachean las llamadas a /api/movil/* — marcar
// exige cámara + GPS + confirmación del servidor en el momento, y encolar
// marcaciones offline metería la hora de un reloj de dispositivo no
// confiable justo en el dato que hay que comparar con Talana durante el
// piloto. Si en el futuro se agrega soporte offline, que sea una decisión
// explícita, no un efecto colateral de "mejorar" el service worker acá.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Marcación SGP',
        short_name: 'Marcación',
        description: 'Marcación de entrada/salida desde el celular (piloto SGP).',
        display: 'standalone',
        background_color: '#0f172a',
        theme_color: '#1e3a8a',
        start_url: '/',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg}'],
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
});
