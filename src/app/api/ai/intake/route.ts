import { guarded, ok, fail } from '@/lib/route-utils';
import { IntakeSchema } from '@/lib/schema';
import { parseMessage } from '@/lib/ai';
import { commitIntent, mayAutoCommit, previewIntent } from '@/lib/intake';
import { crewOptions, loadTeamFleet, truckOptions } from '@/lib/team';
import { recordAudit, seenIdempotencyKey } from '@/lib/audit';
import { businessDay, stableIdempotencyKey } from '@/lib/core';

/**
 * Universal intake endpoint shared by the web app, the ChatGPT Action, the
 * Claude MCP server and any webhook.
 *
 * Two-phase by default: the first call returns a parsed preview, and nothing is
 * written until `confirm: true` comes back (or `autoCommit` is on and the model
 * is confident). Repeat calls carrying the same idempotency key are ignored.
 */
export const POST = guarded('ai', async (req, caller) => {
  const body = await req.json().catch(() => null);
  const parsed = IntakeSchema.safeParse(body);
  if (!parsed.success) {
    return fail('Invalid intake payload.', 422, { issues: parsed.error.issues });
  }
  const input = parsed.data;
  const source = input.source ?? caller.source;
  const user = input.user ?? caller.user;

  // When a client does not supply a key, derive one from the request itself so
  // an identical retry still collapses onto the same write.
  const key = input.idempotencyKey
    ?? stableIdempotencyKey(source, input.requestedAction ?? 'intake', {
      message: input.message,
      attachments: input.attachments,
    });

  if (await seenIdempotencyKey(key)) {
    return ok({
      duplicate: true,
      committed: false,
      message: 'This request was already applied. No second write was made.',
      idempotencyKey: key,
    });
  }

  const { people, trucks } = await loadTeamFleet().catch(() => ({ people: [], trucks: [] }));

  let intent;
  try {
    intent = await parseMessage(input.message, {
      knownCrew: crewOptions(people),
      knownTrucks: truckOptions(trucks),
      today: businessDay(new Date()),
      requestedAction: input.requestedAction,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Parse failed.';
    return fail(message, 503, { code: 'AI_UNAVAILABLE' });
  }

  const preview = await previewIntent(intent);
  const shouldCommit = input.confirm || mayAutoCommit(preview, input.autoCommit);

  if (!shouldCommit) {
    return ok({
      committed: false,
      preview,
      message: preview.blockers.length
        ? 'Cannot apply yet — see blockers.'
        : 'Review the parsed result, then send the same request with confirm: true.',
    });
  }

  if (preview.blockers.length) {
    return fail('Cannot apply this message.', 409, { preview });
  }

  try {
    const result = await commitIntent(intent, { user, source, idempotencyKey: key });
    return ok({ committed: true, preview, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Commit failed.';
    await recordAudit({
      user, source, action: intent.action, sheet: '-', row: 0,
      result: 'error', error: message, idempotencyKey: key,
    }).catch(() => undefined);
    return fail(message, 500, { preview });
  }
});
