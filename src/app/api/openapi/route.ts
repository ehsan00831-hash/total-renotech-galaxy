import { buildSpec } from '@/lib/openapi';

/**
 * Served live so the specification always carries the deployment's real base
 * URL. Paste this URL into a ChatGPT Custom GPT Action.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = process.env.PUBLIC_BASE_URL ?? url.origin;
  return Response.json(buildSpec(origin), {
    headers: { 'cache-control': 'public, max-age=300' },
  });
}
