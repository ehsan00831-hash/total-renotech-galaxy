/**
 * TotalRENOTech brand tokens.
 * Single source of truth for colour so the palette never drifts between
 * Tailwind classes, inline styles and chart series.
 */

export const BRAND = {
  blue: '#006EB8',
  blueDark: '#00548C',
  blueLight: '#2D8FD0',
  blueWash: '#EAF5FC',
  black: '#0B0F14',
  white: '#FFFFFF',
  gold: '#D4AF37',
  success: '#2E7D32',
  warning: '#F9A825',
  error: '#C62828',
  neutral: '#F5F7FA',
  border: '#DDE4EC',
  muted: '#5C6B7A',
} as const;

/** Ordered palette for chart series. Blue-led, gold as a single accent. */
export const CHART_COLORS = [
  BRAND.blue,
  BRAND.blueLight,
  BRAND.gold,
  BRAND.success,
  BRAND.warning,
  BRAND.error,
  '#82C6EE',
  '#4FA5DC',
  '#8A6100',
  '#9AA7B4',
];

export const APP_NAME = 'TotalRÊNOTECH Operations Control Center';
export const APP_SHORT = 'TRT Ops';

/**
 * Logo.
 *
 * Derived from the supplied master artwork by `scripts/build-logo.mjs`, which
 * removes only fully transparent margin — every line of the lockup, including
 * "Hamed Tabrizi", is present at every size. There is deliberately no remote
 * fallback: the public web copy is a different, shorter variant that drops the
 * name, so falling back to it would silently ship the wrong mark.
 *
 * The artwork is white and gold, so it always sits on the dark plate.
 */
export const LOGO_LOCAL = '/brand/trt-logo.png';
export const LOGO_PLATE = '/brand/trt-logo-plate.png';
export const LOGO_ICON_192 = '/brand/icon-192.png';
export const LOGO_ICON_512 = '/brand/icon-512.png';
export const LOGO_APPLE_TOUCH = '/brand/apple-touch-icon.png';

/** Status vocabulary as it exists in the live workbook. */
export const JOB_STATUSES = [
  'NEW LEAD',
  'NEED INFO',
  'NEED SCHEDULING',
  'UPCOMING',
  'TOMORROW PLAN',
  'SCHEDULED',
  'ONGOING',
  'WAITING MATERIAL',
  'WAITING APPROVAL',
  'NEED FOLLOW-UP',
  'ON HOLD',
  'DONE',
  'COMPLETED',
  'CANCELLED',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT', 'EMERGENCY'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PROJECT_TYPES = [
  'NATIONAL PROJECT',
  'PRIVATE',
  'INTERNAL',
  'WARRANTY',
] as const;

export const MATERIAL_STATUSES = [
  'NONE',
  'NEED LIST',
  'NEED PURCHASE',
  'ORDERED',
  'READY',
  'DELIVERED',
  'USED',
] as const;

/** Statuses that mean the job is finished. */
export const CLOSED_STATUSES: string[] = ['DONE', 'COMPLETED'];
/** Statuses that mean the job is no longer actionable. */
export const INACTIVE_STATUSES: string[] = [...CLOSED_STATUSES, 'CANCELLED'];

export function statusTone(status: string): 'success' | 'info' | 'warn' | 'danger' | 'muted' {
  const s = (status || '').toUpperCase().trim();
  if (CLOSED_STATUSES.includes(s)) return 'success';
  if (s === 'CANCELLED' || s === 'ON HOLD') return 'muted';
  if (s.startsWith('WAITING') || s.startsWith('NEED')) return 'warn';
  if (s === 'ONGOING' || s === 'UPCOMING' || s === 'SCHEDULED' || s === 'TOMORROW PLAN')
    return 'info';
  return 'muted';
}

export function priorityTone(p: string): 'danger' | 'warn' | 'muted' {
  const v = (p || '').toUpperCase().trim();
  if (v === 'URGENT' || v === 'EMERGENCY') return 'danger';
  if (v === 'HIGH') return 'warn';
  return 'muted';
}
