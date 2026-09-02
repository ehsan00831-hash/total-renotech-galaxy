/**
 * Reminder comment / mention threads.
 *
 * One row per comment on the "Reminder Comments" tab, created on first use.
 * A comment can name teammates in `mentions` and carry an `actionDone` flag
 * that the mentioned person (or anyone) flips once the requested action is
 * actually done — the flip is itself audited like any other write.
 */

import {
  REMINDER_COMMENT_FIELDS, REMINDER_COMMENT_HEADERS, TABLES,
  type ReminderCommentInput,
} from './schema';
import { appendRecord, columnsFor, ensureSheet, readRecords, updateRow, type SheetRow } from './sheets';
import { recordAudit } from './audit';
import { normKey, sortComments } from './core';
import { loadTeamFleet } from './team';

export type ReminderComment = {
  row: number;
  commentId: string;
  reminderId: string;
  author: string;
  authorEmail: string;
  text: string;
  mentions: string[];
  actionDone: boolean;
  doneBy: string;
  doneAt: string;
  createdAt: string;
};

function toComment(r: SheetRow): ReminderComment {
  return {
    row: r.__row,
    commentId: r.commentId ?? '',
    reminderId: r.reminderId ?? '',
    author: r.author ?? '',
    authorEmail: r.authorEmail ?? '',
    text: r.text ?? '',
    mentions: (r.mentions ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    actionDone: (r.actionDone ?? '').trim().toLowerCase() === 'yes',
    doneBy: r.doneBy ?? '',
    doneAt: r.doneAt ?? '',
    createdAt: r.createdAt ?? '',
  };
}

let ready = false;
async function ensureReady(): Promise<void> {
  if (ready) return;
  await ensureSheet(TABLES.REMINDER_COMMENTS, REMINDER_COMMENT_HEADERS);
  ready = true;
}

async function readAll(): Promise<ReminderComment[]> {
  await ensureReady();
  const { rows } = await readRecords(TABLES.REMINDER_COMMENTS, REMINDER_COMMENT_FIELDS, 'commentId');
  return rows.map(toComment);
}

/** All comments for one reminder, oldest first. */
export async function listComments(reminderId: string): Promise<ReminderComment[]> {
  const all = await readAll();
  return sortComments(all.filter((c) => normKey(c.reminderId) === normKey(reminderId)));
}

/** Open (not-yet-done) mentions of one person, across every reminder. */
export async function listOpenMentions(personName: string): Promise<ReminderComment[]> {
  if (!personName.trim()) return [];
  const key = normKey(personName);
  const all = await readAll();
  return sortComments(
    all.filter((c) => !c.actionDone && c.mentions.some((m) => normKey(m) === key)),
  ).reverse();
}

function nextCommentId(list: ReminderComment[]): string {
  const nums = list
    .map((c) => /(\d{3,})/.exec(c.commentId)?.[1])
    .filter(Boolean)
    .map(Number);
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `CMT-${String(next).padStart(4, '0')}`;
}

/** Resolve the display name behind a session email; falls back to the email itself. */
export async function displayNameFor(email: string): Promise<string> {
  const e = email.trim().toLowerCase();
  if (!e) return email;
  try {
    const { people } = await loadTeamFleet();
    const hit = people.find((p) => p.email.trim().toLowerCase() === e);
    if (hit) return hit.displayName || hit.fullName;
  } catch {
    // Team & Fleet unreadable: fall through to the raw email.
  }
  return email;
}

export async function addComment(
  input: ReminderCommentInput,
  ctx: { authorEmail: string; source: string },
): Promise<ReminderComment> {
  const all = await readAll();
  const commentId = nextCommentId(all);
  const author = await displayNameFor(ctx.authorEmail);
  const createdAt = new Date().toISOString();

  const record = {
    commentId,
    reminderId: input.reminderId,
    author,
    authorEmail: ctx.authorEmail,
    text: input.text,
    mentions: (input.mentions ?? []).join(', '),
    actionDone: '',
    doneBy: '',
    doneAt: '',
    createdAt,
  };
  const { row } = await appendRecord(TABLES.REMINDER_COMMENTS, REMINDER_COMMENT_FIELDS, 'commentId', record);

  await recordAudit({
    user: ctx.authorEmail, source: ctx.source, action: 'add_reminder_comment',
    sheet: TABLES.REMINDER_COMMENTS.sheet, row, field: 'text', prev: '', next: input.text,
    result: 'ok',
  });

  return { row, ...record, mentions: input.mentions ?? [], actionDone: false };
}

export async function setCommentAction(
  commentId: string,
  actionDone: boolean,
  ctx: { user: string; source: string },
): Promise<ReminderComment> {
  const all = await readAll();
  const existing = all.find((c) => normKey(c.commentId) === normKey(commentId));
  if (!existing) throw new Error(`Comment ${commentId} not found.`);

  const { cols } = await columnsFor(TABLES.REMINDER_COMMENTS, REMINDER_COMMENT_FIELDS);
  const doneBy = await displayNameFor(ctx.user);
  const doneAt = actionDone ? new Date().toISOString() : '';
  await updateRow(TABLES.REMINDER_COMMENTS, existing.row, cols, {
    actionDone: actionDone ? 'Yes' : '',
    doneBy: actionDone ? doneBy : '',
    doneAt,
  });

  await recordAudit({
    user: ctx.user, source: ctx.source, action: actionDone ? 'complete_reminder_comment' : 'reopen_reminder_comment',
    sheet: TABLES.REMINDER_COMMENTS.sheet, row: existing.row, field: 'actionDone',
    prev: existing.actionDone ? 'Yes' : '', next: actionDone ? 'Yes' : '', result: 'ok',
  });

  return { ...existing, actionDone, doneBy: actionDone ? doneBy : '', doneAt };
}

/** Comment counts per reminder, for the card grid's badge. */
export async function commentCounts(): Promise<Map<string, { total: number; openMentions: number }>> {
  const all = await readAll();
  const out = new Map<string, { total: number; openMentions: number }>();
  for (const c of all) {
    const key = normKey(c.reminderId);
    const cur = out.get(key) ?? { total: 0, openMentions: 0 };
    cur.total += 1;
    if (!c.actionDone && c.mentions.length > 0) cur.openMentions += 1;
    out.set(key, cur);
  }
  return out;
}
