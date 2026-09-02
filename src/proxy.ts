import { NextResponse, type NextRequest } from 'next/server';

/**
 * Route protection (Next 16 renamed Middleware to Proxy; behaviour is unchanged). Pages require a session cookie; API routes do their own
 * bearer-token check so ChatGPT and Claude can reach them without a session.
 */
const PUBLIC_PATHS = ['/login', '/api/auth', '/api/health', '/api/openapi', '/brand', '/manifest.webmanifest', '/social-preview.png'];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (pathname.startsWith('/api/')) return NextResponse.next();

  // No Google credentials configured yet: leave the app open locally rather
  // than locking everyone out of a half-provisioned deployment.
  if (!process.env.AUTH_GOOGLE_ID) return NextResponse.next();

  const hasSession =
    req.cookies.has('authjs.session-token') ||
    req.cookies.has('__Secure-authjs.session-token');

  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
