'use client';

import React from 'react';
import { AlertCircle, Inbox, Loader2, X } from 'lucide-react';

// LabSubmit shared design system.
//
// One place for the primitives every page composes from, so visual decisions are made once
// here rather than re-invented per page. Pages should import from this module rather than
// hand-rolling a card, badge or button — if something is missing, add it here.
//
// Conventions:
//  - Olive is the primary action colour (CBIT's identity). Blue is secondary/informational.
//  - Colour never carries meaning alone: every status also has a label, and often an icon.
//  - Radius and shadow come from the theme tokens (rounded-card / rounded-control /
//    shadow-card), never ad-hoc values.

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/* ------------------------------------------------------------------ Button */

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-olive-700 hover:bg-brand-olive-600 text-white border border-transparent shadow-card',
  secondary:
    'bg-brand-blue-600 hover:bg-brand-blue-500 text-white border border-transparent shadow-card',
  outline:
    'bg-white dark:bg-transparent hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700',
  ghost:
    'bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 border border-transparent',
  danger:
    'bg-rose-600 hover:bg-rose-500 text-white border border-transparent shadow-card',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'text-xs px-3 py-1.5 gap-1.5',
  md: 'text-xs sm:text-sm px-4 py-2 gap-2',
  lg: 'text-sm px-5 py-2.5 gap-2',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, fullWidth = false, className, children, disabled, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      // aria-busy rather than swapping the label, so a screen reader announces the state
      // without the accessible name changing under the user.
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center font-semibold rounded-control transition-colors',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        fullWidth && 'w-full',
        className
      )}
      {...rest}
    >
      {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
});

/* -------------------------------------------------------------------- Card */

export const Card: React.FC<React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }> = ({
  interactive = false,
  className,
  children,
  ...rest
}) => (
  <div
    className={cn(
      'bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-slate-800/80 rounded-card shadow-card',
      interactive && 'transition-shadow hover:shadow-cardHover',
      className
    )}
    {...rest}
  >
    {children}
  </div>
);

/** A card with a titled header — the default container for a group of related settings. */
export const SectionCard: React.FC<{
  title: string;
  description?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}> = ({ title, description, icon, actions, className, bodyClassName, children }) => (
  <Card className={className}>
    <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 dark:border-slate-800/80 flex items-start justify-between gap-3">
      <div className="flex items-start gap-2.5 min-w-0">
        {icon && <span className="text-slate-400 dark:text-slate-500 mt-0.5 flex-shrink-0">{icon}</span>}
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h2>
          {description && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
    <div className={cn('p-4 sm:p-5', bodyClassName)}>{children}</div>
  </Card>
);

/* --------------------------------------------------------------- PageHeader */

export const PageHeader: React.FC<{
  title: string;
  description?: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}> = ({ title, description, meta, actions }) => (
  <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
    <div className="space-y-1.5 min-w-0">
      <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{title}</h1>
      {description && (
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-2xl">{description}</p>
      )}
      {meta && <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400 font-mono pt-0.5">{meta}</div>}
    </div>
    {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
  </header>
);

/* ----------------------------------------------------------------- StatCard */

export const StatCard: React.FC<{
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  hint?: string;
  tone?: 'neutral' | 'olive' | 'blue' | 'amber' | 'rose' | 'emerald';
}> = ({ label, value, icon, hint, tone = 'neutral' }) => {
  const TONES = {
    neutral: 'text-slate-900 dark:text-white',
    olive: 'text-brand-olive-700 dark:text-brand-olive-400',
    blue: 'text-brand-blue-700 dark:text-brand-blue-400',
    amber: 'text-amber-600 dark:text-amber-400',
    rose: 'text-rose-600 dark:text-rose-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
  };
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
        {icon && <span className="text-slate-300 dark:text-slate-600 flex-shrink-0">{icon}</span>}
      </div>
      <p className={cn('text-2xl font-bold tabular mt-1.5', TONES[tone])}>{value}</p>
      {hint && <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{hint}</p>}
    </Card>
  );
};

/* --------------------------------------------------------------- StatusBadge */

export type BadgeTone = 'neutral' | 'olive' | 'blue' | 'amber' | 'rose' | 'emerald' | 'indigo';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700',
  olive: 'bg-brand-olive-50 dark:bg-brand-olive-900/40 text-brand-olive-800 dark:text-brand-olive-300 border-brand-olive-200 dark:border-brand-olive-800/60',
  blue: 'bg-brand-blue-50 dark:bg-brand-blue-900/30 text-brand-blue-700 dark:text-brand-blue-300 border-brand-blue-200 dark:border-brand-blue-800/60',
  amber: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/60',
  rose: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800/60',
  emerald: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60',
  indigo: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800/60',
};

/** Status is always conveyed by the label text, never by colour alone. */
export const StatusBadge: React.FC<{ tone?: BadgeTone; icon?: React.ReactNode; children: React.ReactNode; className?: string }> = ({
  tone = 'neutral',
  icon,
  children,
  className,
}) => (
  <span
    className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wide whitespace-nowrap',
      BADGE_TONES[tone],
      className
    )}
  >
    {icon}
    {children}
  </span>
);

/** The exam lifecycle has one canonical colour mapping, shared by every view. */
export const EXAM_STATUS_TONE: Record<string, BadgeTone> = {
  DRAFT: 'neutral',
  UPCOMING: 'blue',
  RUNNING: 'olive',
  COMPLETED: 'neutral',
  PENDING: 'amber',
  APPROVED: 'emerald',
  REJECTED: 'rose',
  NEEDS_CORRECTION: 'amber',
  NOT_STARTED: 'neutral',
};

/* ------------------------------------------------------------------- Fields */

export const Label: React.FC<{ htmlFor?: string; required?: boolean; children: React.ReactNode; className?: string }> = ({
  htmlFor,
  required,
  children,
  className,
}) => (
  <label htmlFor={htmlFor} className={cn('block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5', className)}>
    {children}
    {required && (
      <>
        <span aria-hidden="true" className="text-rose-500 ml-0.5">*</span>
        <span className="sr-only"> (required)</span>
      </>
    )}
  </label>
);

const CONTROL_BASE =
  'w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-control px-3 py-2 text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...rest }, ref) {
    return <input ref={ref} aria-invalid={invalid || undefined} className={cn(CONTROL_BASE, invalid && 'border-rose-500 dark:border-rose-600', className)} {...rest} />;
  }
);

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ className, invalid, ...rest }, ref) {
    return <textarea ref={ref} aria-invalid={invalid || undefined} className={cn(CONTROL_BASE, 'resize-y leading-relaxed', invalid && 'border-rose-500', className)} {...rest} />;
  }
);

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select ref={ref} className={cn(CONTROL_BASE, 'cursor-pointer', className)} {...rest}>
        {children}
      </select>
    );
  }
);

/** Label + control + help/error, so spacing and error wiring are identical everywhere. */
export const Field: React.FC<{
  label: string;
  htmlFor?: string;
  required?: boolean;
  help?: string;
  error?: string;
  children: React.ReactNode;
}> = ({ label, htmlFor, required, help, error, children }) => (
  <div>
    <Label htmlFor={htmlFor} required={required}>
      {label}
    </Label>
    {children}
    {error ? (
      <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1 flex items-center gap-1">
        <AlertCircle className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
        {error}
      </p>
    ) : help ? (
      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{help}</p>
    ) : null}
  </div>
);

/* -------------------------------------------------------------------- Tabs */

export interface TabItem {
  id: string;
  label: string;
  shortLabel?: string;
  count?: number;
  icon?: React.ReactNode;
}

/** Horizontal, scrollable on narrow screens, with proper tab semantics. */
export const Tabs: React.FC<{ items: TabItem[]; active: string; onChange: (id: string) => void; className?: string }> = ({
  items,
  active,
  onChange,
  className,
}) => (
  <div role="tablist" className={cn('flex items-center gap-1.5 overflow-x-auto border-b border-slate-200 dark:border-slate-800/80 pb-2', className)}>
    {items.map((t) => {
      const isActive = t.id === active;
      return (
        <button
          key={t.id}
          role="tab"
          aria-selected={isActive}
          onClick={() => onChange(t.id)}
          className={cn(
            'px-3 sm:px-4 py-2 rounded-control text-xs font-semibold transition-colors flex items-center gap-2 flex-shrink-0',
            isActive
              ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
          )}
        >
          {t.icon}
          {t.shortLabel ? (
            <span>
              <span className="sm:hidden">{t.shortLabel}</span>
              <span className="hidden sm:inline">{t.label}</span>
            </span>
          ) : (
            <span>{t.label}</span>
          )}
          {t.count !== undefined && <span className="tabular opacity-70">({t.count})</span>}
        </button>
      );
    })}
  </div>
);

/* ------------------------------------------------------------------- Table */

/** Scroll container + minimum width, so columns are never crushed while scrolled. */
export const TableWrap: React.FC<{ children: React.ReactNode; minWidth?: string; className?: string }> = ({
  children,
  minWidth = '640px',
  className,
}) => (
  <div className={cn('overflow-x-auto', className)}>
    <table className="w-full text-left text-xs" style={{ minWidth }}>
      {children}
    </table>
  </div>
);

export const Th: React.FC<React.ThHTMLAttributes<HTMLTableCellElement>> = ({ className, children, ...rest }) => (
  <th
    scope="col"
    className={cn('px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400', className)}
    {...rest}
  >
    {children}
  </th>
);

export const Td: React.FC<React.TdHTMLAttributes<HTMLTableCellElement>> = ({ className, children, ...rest }) => (
  <td className={cn('px-4 py-3 text-slate-700 dark:text-slate-300 align-middle', className)} {...rest}>
    {children}
  </td>
);

export const THead: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">{children}</thead>
);

export const TBody: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">{children}</tbody>
);

export const Tr: React.FC<React.HTMLAttributes<HTMLTableRowElement>> = ({ className, children, ...rest }) => (
  <tr className={cn('hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors', className)} {...rest}>
    {children}
  </tr>
);

/* ------------------------------------------------------------------ States */

export const EmptyState: React.FC<{
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}> = ({ title, description, icon, action, className }) => (
  <div className={cn('flex flex-col items-center justify-center text-center py-12 px-6', className)}>
    <div className="w-11 h-11 rounded-card bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 dark:text-slate-500 mb-3">
      {icon || <Inbox className="w-5 h-5" aria-hidden="true" />}
    </div>
    <h3 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h3>
    {description && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">{description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export const LoadingState: React.FC<{ label?: string; className?: string }> = ({ label = 'Loading…', className }) => (
  <div role="status" aria-live="polite" className={cn('flex flex-col items-center justify-center py-12 gap-2.5', className)}>
    <Loader2 className="w-5 h-5 animate-spin text-brand-olive-600" aria-hidden="true" />
    <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">{label}</span>
  </div>
);

export const ErrorState: React.FC<{ title?: string; description?: string; action?: React.ReactNode; className?: string }> = ({
  title = 'Something went wrong',
  description,
  action,
  className,
}) => (
  <div role="alert" className={cn('flex flex-col items-center justify-center text-center py-12 px-6', className)}>
    <div className="w-11 h-11 rounded-card bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 flex items-center justify-center text-rose-500 mb-3">
      <AlertCircle className="w-5 h-5" aria-hidden="true" />
    </div>
    <h3 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h3>
    {description && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">{description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

/** Inline banner for a message that belongs beside content rather than replacing it. */
export const Alert: React.FC<{ tone?: 'info' | 'success' | 'warning' | 'danger'; title?: string; children: React.ReactNode; className?: string }> = ({
  tone = 'info',
  title,
  children,
  className,
}) => {
  const TONES = {
    info: 'bg-brand-blue-50 dark:bg-brand-blue-950/30 border-brand-blue-200 dark:border-brand-blue-800/60 text-brand-blue-900 dark:text-brand-blue-200',
    success: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/60 text-emerald-900 dark:text-emerald-200',
    warning: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200',
    danger: 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800/60 text-rose-900 dark:text-rose-200',
  };
  return (
    <div className={cn('rounded-card border px-3.5 py-3 text-xs leading-relaxed', TONES[tone], className)}>
      {title && <p className="font-bold mb-0.5">{title}</p>}
      {children}
    </div>
  );
};

/* ------------------------------------------------------------------- Modal */

// Open dialogs, innermost last. Escape must dismiss only the topmost one — without this,
// every mounted Modal hears the same window keydown and a nested preview would take its
// parent down with it.
const modalStack: symbol[] = [];

export const Modal: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  footer?: React.ReactNode;
  /**
   * Whether clicking the backdrop dismisses the dialog. Defaults to true for read-only and
   * informational dialogs. Set FALSE for anything holding unsaved input — a stray click
   * beside a half-filled form must not throw the work away. Escape still closes, because a
   * deliberate keypress is not a stray click.
   */
  dismissOnBackdrop?: boolean;
  /** Raises a dialog opened from within another dialog above its parent. */
  elevated?: boolean;
  /** Fills the viewport height — for review workspaces rather than short forms. */
  fullHeight?: boolean;
  children: React.ReactNode;
}> = ({
  open,
  onClose,
  title,
  description,
  size = 'md',
  footer,
  dismissOnBackdrop = true,
  elevated = false,
  fullHeight = false,
  children,
}) => {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const restoreFocusRef = React.useRef<HTMLElement | null>(null);
  const idRef = React.useRef<symbol>(Symbol('labsubmit-modal'));

  // Register in the stack while open, so this dialog knows whether it is the topmost.
  React.useEffect(() => {
    if (!open) return;
    const id = idRef.current;
    modalStack.push(id);
    return () => {
      const i = modalStack.lastIndexOf(id);
      if (i !== -1) modalStack.splice(i, 1);
    };
  }, [open]);

  // Escape closes the dialog — expected of any modal, and the one keyboard affordance whose
  // absence is immediately felt. Only the topmost dialog reacts, so closing a nested preview
  // does not also close the workspace that opened it.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (modalStack[modalStack.length - 1] !== idRef.current) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Focus moves into the dialog on open and returns to whatever opened it on close, so
  // keyboard users are not dropped back at the top of the document.
  React.useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const focusable = panelRef.current?.querySelector<HTMLElement>(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    );
    (focusable || panelRef.current)?.focus();
    return () => {
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  // Tab is kept inside the dialog while it is open, so the page behind cannot be reached by
  // keyboard while it is meant to be inert.
  const onKeyDownTrap = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const nodes = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => el.offsetParent !== null);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // The page behind must not scroll under the dialog.
  React.useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  const SIZES = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-6xl',
  };

  return (
    <div
      className={cn(
        'fixed inset-0 bg-slate-900/60 dark:bg-black/70 backdrop-blur-sm flex items-start sm:items-center justify-center p-2 sm:p-4 overflow-y-auto animate-fade-in',
        elevated ? 'z-[60]' : 'z-50'
      )}
      onClick={dismissOnBackdrop ? onClose : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={onKeyDownTrap}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'bg-white dark:bg-surface-darkCard border border-slate-200 dark:border-slate-800 rounded-card shadow-overlay w-full my-auto flex flex-col animate-slide-up focus:outline-none',
          fullHeight ? 'h-[94vh]' : 'max-h-[94vh]',
          SIZES[size]
        )}
      >
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3 flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h2>
            {description && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{description}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1.5 rounded-control text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 flex-shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="p-4 sm:p-5 overflow-y-auto flex-1 min-h-0">{children}</div>

        {footer && (
          <div className="px-4 sm:px-5 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2 flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------- Toast */

export const Toast: React.FC<{ tone?: 'success' | 'error'; message: string; onDismiss?: () => void }> = ({
  tone = 'success',
  message,
  onDismiss,
}) => (
  <div
    role="status"
    aria-live="polite"
    className={cn(
      'fixed top-20 right-3 sm:right-5 z-[60] max-w-sm rounded-card border px-4 py-3 shadow-overlay text-xs font-semibold flex items-start gap-2 animate-slide-up',
      tone === 'success'
        ? 'bg-emerald-50 dark:bg-emerald-950/90 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100'
        : 'bg-rose-50 dark:bg-rose-950/90 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-100'
    )}
  >
    <span className="min-w-0">{message}</span>
    {onDismiss && (
      <button onClick={onDismiss} aria-label="Dismiss notification" className="flex-shrink-0 opacity-60 hover:opacity-100">
        <X className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    )}
  </div>
);
