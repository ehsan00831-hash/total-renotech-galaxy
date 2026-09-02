import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppShell, LangProvider } from '@/components/shell/AppShell';
import { ToastHost } from '@/components/ui';
import { APP_NAME, BRAND } from '@/lib/brand';
import { auth } from '@/lib/auth';

export const metadata: Metadata = {
  metadataBase: new URL('https://trt-ops-roan.vercel.app'),
  title: 'TotalRÊNOTECH Operations',
  description: 'Work planning and operations management',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'TRT Ops', statusBarStyle: 'black-translucent' },
  icons: { icon: '/brand/icon-192.png', apple: '/brand/apple-touch-icon.png' },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://trt-ops-roan.vercel.app',
    title: 'TotalRÊNOTECH Operations',
    description: 'Work planning and operations management',
    images: [
      {
        url: 'https://trt-ops-roan.vercel.app/social-preview.png',
        width: 1200,
        height: 630,
        alt: 'TotalRÊNOTECH Operations Control Center',
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'TotalRÊNOTECH Operations',
    description: 'Work planning and operations management',
    images: ['https://trt-ops-roan.vercel.app/social-preview.png'],
  },
};

export const viewport: Viewport = {
  themeColor: BRAND.blue,
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth().catch(() => null);
  const user = session?.user
    ? {
        name: session.user.name,
        email: session.user.email,
        role: (session.user as { role?: string }).role,
      }
    : undefined;

  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <body className="antialiased">
        <LangProvider>
          <ToastHost>
            <AppShell user={user}>{children}</AppShell>
          </ToastHost>
        </LangProvider>
      </body>
    </html>
  );
}
