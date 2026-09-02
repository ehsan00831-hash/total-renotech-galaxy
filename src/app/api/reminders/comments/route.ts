import {
  guarded, ok, fail, searchParams, idempotencyKeyFor, replayGuard,
} from '@/lib/route-utils';
import {
  addComment, displayNameFor, listComments, listOpenMentions, setCommentAction,
} from '@/lib/reminder-comments';
import { ReminderCommentActionSchema, ReminderCommentSchema } from '@/lib/schema';

export const GET = guarded('read', async (req, caller) => {
  const params = searchParams(req);
  const mentionsFor = params.get('mentionsFor');

  if (mentionsFor === 'me') {
    const name = await displayNameFor(caller.user);
    const mentions = await listOpenMentions(name);
    return ok({ mentions, count: mentions.length });
  }

  const reminderId = params.get('reminderId');
  if (!reminderId) return fail('reminderId is required.', 400);
  const comments = await listComments(reminderId);
  return ok({ comments, count: comments.length });
});

export const POST = guarded('log', async (req, caller) => {
  const body = await req.json().catch(() => null);
  const parsed = ReminderCommentSchema.safeParse(body);
  if (!parsed.success) {
    return fail('Invalid comment payload.', 422, { issues: parsed.error.issues });
  }
  const key = idempotencyKeyFor(req, caller, 'add_reminder_comment', parsed.data);
  const replay = await replayGuard(key);
  if (replay) return replay;

  const comment = await addComment(parsed.data, { authorEmail: caller.user, source: caller.source });
  return ok({ comment, idempotencyKey: key });
});

export const PATCH = guarded('log', async (req, caller) => {
  const body = await req.json().catch(() => null);
  const parsed = ReminderCommentActionSchema.safeParse(body);
  if (!parsed.success) {
    return fail('Invalid comment action payload.', 422, { issues: parsed.error.issues });
  }
  const comment = await setCommentAction(
    parsed.data.commentId, parsed.data.actionDone, { user: caller.user, source: caller.source },
  );
  return ok({ comment });
});
