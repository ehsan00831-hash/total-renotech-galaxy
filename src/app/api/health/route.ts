import { credentialsPresent, listSheets } from '@/lib/sheets';
import { authConfigured } from '@/lib/auth';
import { aiConfigured } from '@/lib/ai';
import { ok, handleError } from '@/lib/route-utils';

/** Unauthenticated but non-sensitive: reports wiring status, never data. */
export async function GET() {
  const status = {
    sheets: credentialsPresent(),
    auth: authConfigured(),
    ai: aiConfigured(),
    apiToken: Boolean(process.env.API_SHARED_TOKEN),
    tabs: [] as Array<{ title: string; sheetId: number }>,
    sheetsError: null as string | null,
  };
  if (status.sheets) {
    try {
      status.tabs = await listSheets();
    } catch (err) {
      status.sheetsError = err instanceof Error ? err.message : 'unknown';
      try { return ok({ status }); } catch { return handleError(err); }
    }
  }
  return ok({ status });
}
