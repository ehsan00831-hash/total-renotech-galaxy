'use client';

/**
 * Small, dependency-light UI primitives. Everything is styled from the brand
 * tokens in globals.css so a colour change never has to be chased through JSX.
 */

import * as React from 'react';
import { clsx } from 'clsx';

/* ---------------------------------------------------------------- Card */

export function Card({
  className, children, onClick, title, style,
}: {
  className?: string; children: React.ReactNode; onClick?: () => void; title?: string;
  /** Escapes the Tailwind cascade for a caller-specific override — e.g. a
   * conditional accent colour that must always win over the default surface,
   * regardless of which utility class's rule happens to compile later. */
  style?: React.CSSProperties;
}) {
  const interactive = Boolean(onClick);
  return (
    <div
      onClick={onClick}
      title={title}
      style={style}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); }
      } : undefined}
      className={clsx(
        'rounded-xl border bg-[var(--surface)] shadow-sm',
        'border-[var(--line)]',
        interactive && 'cursor-pointer transition hover:shadow-md hover:border-brand focus-visible:border-brand',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
      <h2 className="text-sm font-semibold tracking-wide text-[var(--text)]">{title}</h2>
      {action}
    </div>
  );
}

/* -------------------------------------------------------------- Button */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
};

export function Button({
  variant = 'primary', size = 'md', className, ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition',
        'disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm',
        variant === 'primary' && 'bg-brand text-white hover:bg-brand-dark',
        variant === 'secondary' &&
          'border border-[var(--line)] bg-[var(--surface)] text-[var(--text)] hover:border-brand hover:text-brand',
        variant === 'ghost' && 'text-[var(--text-muted)] hover:bg-brand-wash hover:text-brand',
        variant === 'danger' && 'bg-bad text-white hover:opacity-90',
        className,
      )}
    />
  );
}

/* --------------------------------------------------------------- Chips */

export type Tone = 'success' | 'info' | 'warn' | 'danger' | 'muted' | 'gold';

const TONE: Record<Tone, string> = {
  success: 'bg-[#E7F2E8] text-[#1B5E20] border-[#C6E0C8]',
  info: 'bg-[#EAF5FC] text-[#00548C] border-[#C5E3F5]',
  warn: 'bg-[#FEF5DC] text-[#8A6100] border-[#F2DFA8]',
  danger: 'bg-[#FBE6E6] text-[#C62828] border-[#F1C4C4]',
  muted: 'bg-[#F1F3F5] text-[#5C6B7A] border-[#E1E5EA]',
  gold: 'bg-[#FBF3DC] text-[#8A6100] border-[#E8D191]',
};

export function Chip({
  children, tone = 'muted', className,
}: { children: React.ReactNode; tone?: Tone; className?: string }) {
  return (
    <span className={clsx(
      'inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-tight',
      TONE[tone], className,
    )}>
      {children}
    </span>
  );
}

/* --------------------------------------------------------------- Input */

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={clsx(
        'w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm',
        'text-[var(--text)] placeholder:text-[var(--text-muted)]',
        'focus:border-brand focus:outline-none',
        className,
      )}
    />
  );
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={clsx(
        'w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm',
        'text-[var(--text)] placeholder:text-[var(--text-muted)]',
        'focus:border-brand focus:outline-none',
        className,
      )}
    />
  );
}

export function Select({
  className, children, ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={clsx(
        'w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm',
        'text-[var(--text)] focus:border-brand focus:outline-none',
        className,
      )}
    >
      {children}
    </select>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </span>
      {children}
    </label>
  );
}

/* ------------------------------------------------- Multi-select (crew) */

export function MultiSelect({
  options, value, onChange, placeholder, max = 5,
}: {
  options: string[]; value: string[]; onChange: (v: string[]) => void;
  placeholder?: string; max?: number;
}) {
  const toggle = (name: string) => {
    if (value.includes(name)) onChange(value.filter((v) => v !== name));
    else if (value.length < max) onChange([...value, name]);
  };
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2">
      {value.length === 0 && (
        <p className="px-1 pb-1 text-xs text-[var(--text-muted)]">
          {placeholder ?? `Pick up to ${max}`}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value.includes(o);
          const full = !on && value.length >= max;
          return (
            <button
              key={o}
              type="button"
              disabled={full}
              onClick={() => toggle(o)}
              className={clsx(
                'rounded-full border px-2.5 py-1 text-xs font-medium transition',
                on
                  ? 'border-brand bg-brand text-white'
                  : 'border-[var(--line)] text-[var(--text-muted)] hover:border-brand hover:text-brand',
                full && 'cursor-not-allowed opacity-40',
              )}
            >
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Feedback */

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton h-4 w-full', className)} />;
}

export function EmptyState({ title, hint, action }: {
  title: string; hint?: string; action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <p className="text-sm font-semibold text-[var(--text)]">{title}</p>
      {hint && <p className="max-w-sm text-xs text-[var(--text-muted)]">{hint}</p>}
      {action}
    </div>
  );
}

export function Banner({ tone = 'warn', children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <div className={clsx('rounded-lg border px-3 py-2 text-xs font-medium', TONE[tone])}>
      {children}
    </div>
  );
}

/* --------------------------------------------------------------- Drawer */

export function Drawer({
  open, onClose, title, children, footer,
}: {
  open: boolean; onClose: () => void; title: string;
  children: React.ReactNode; footer?: React.ReactNode;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="flex-1 bg-black/40 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex h-full w-full max-w-xl flex-col border-s border-[var(--line)] bg-[var(--surface)] shadow-2xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">✕</Button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && (
          <footer className="border-t border-[var(--line)] px-4 py-3">{footer}</footer>
        )}
      </aside>
    </div>
  );
}

/* ---------------------------------------------------------------- Toast */

type Toast = { id: number; message: string; tone: Tone };
const ToastCtx = React.createContext<(m: string, t?: Tone) => void>(() => {});
export const useToast = () => React.useContext(ToastCtx);

export function ToastHost({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<Toast[]>([]);

  const push = React.useCallback((message: string, tone: Tone = 'info') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, message, tone }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 5000);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-20 end-4 z-[60] flex flex-col gap-2 md:bottom-4">
        {items.map((i) => (
          <div
            key={i.id}
            className={clsx(
              'pointer-events-auto max-w-sm rounded-lg border px-3 py-2 text-xs font-medium shadow-lg',
              TONE[i.tone],
            )}
          >
            {i.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
