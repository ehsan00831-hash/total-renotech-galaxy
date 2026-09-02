import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign In — TotalRÊNOTECH Operations',
  description: 'Sign in to TotalRÊNOTECH Operations — work planning and operations management',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://trt-ops-roan.vercel.app/login',
    title: 'Sign In — TotalRÊNOTECH Operations',
    description: 'Sign in to TotalRÊNOTECH Operations — work planning and operations management',
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
    title: 'Sign In — TotalRÊNOTECH Operations',
    description: 'Sign in to TotalRÊNOTECH Operations — work planning and operations management',
    images: ['https://trt-ops-roan.vercel.app/social-preview.png'],
  },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
