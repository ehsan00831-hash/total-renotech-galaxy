import type { MetadataRoute } from 'next';
import { APP_NAME, APP_SHORT, BRAND } from '@/lib/brand';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_SHORT,
    description: 'Jobs, crews, materials, daily logs and reminders for TotalRENOTech.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: BRAND.white,
    theme_color: BRAND.blue,
    categories: ['business', 'productivity'],
    icons: [
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    ],
  };
}
