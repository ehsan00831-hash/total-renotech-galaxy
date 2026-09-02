'use client';

import * as React from 'react';
import { signIn } from 'next-auth/react';
import { Logo } from '@/components/shell/AppShell';
import { Button, Card, Banner } from '@/components/ui';

type Health = { status: { auth: boolean; sheets: boolean; ai: boolean } };

export default function LoginPage() {
  const [health, setHealth] = React.useState<Health | null>(null);

  React.useEffect(() => {
    fetch('/api/health').then((r) => r.json()).then(setHealth).catch(() => undefined);
  }, []);

  const authReady = health?.status?.auth ?? true;

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6 flex justify-center">
          <Logo size={56} withWordmark={false} />
        </div>

        <h1 className="text-center text-lg font-bold tracking-tight">
          Operations Control Center
        </h1>
        <p className="mt-1 text-center text-xs text-[var(--text-muted)]">
          TotalRÊNOTECH · Plomberie &amp; Construction
        </p>

        <div className="mt-6 space-y-3">
          {authReady ? (
            // A plain HTML form POST to /api/auth/signin/google 401s with
            // MissingCSRF — NextAuth's built-in sign-in page injects the CSRF
            // token as a hidden field, but this custom page has no such page
            // to inject it, so it must fetch and submit the token itself.
            // next-auth/react's signIn() does exactly that.
            <Button
              className="w-full"
              onClick={() => signIn('google', { callbackUrl: '/' })}
            >
              Sign in with Google
            </Button>
          ) : (
            <Banner tone="warn">
              Google sign-in is not configured yet. Set AUTH_GOOGLE_ID and
              AUTH_GOOGLE_SECRET, then reload.
            </Banner>
          )}

          <p className="text-center text-[11px] leading-relaxed text-[var(--text-muted)]">
            Access is limited to approved staff accounts. If your address is not on the
            allowlist, sign-in is refused.
          </p>
        </div>
      </Card>
    </div>
  );
}
