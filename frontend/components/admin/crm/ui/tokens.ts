// AutoLenis CRM — Design Token Contract (#2 → inherited by #2b)
// ---------------------------------------------------------------------------
// Single source of truth for the CRM primitive kit. Every primitive consumes
// these CSS custom properties (defined in app/globals.css under `.crm-root`,
// flipped for dark via `.crm-root[data-theme="dark"]`). Dark mode flips the
// VARIABLES, never the component code.
//
// Brand authority:
//   primary  #0B5FD1  — interactive / brand
//   trust    #643293  — RESERVED: consent, FCRA/adverse-action, audit,
//                       Contract Shield. Never decorative.
//
// Aesthetic: flat, dense, calm (Linear / Attio / Stripe lineage).
// No drop shadows, no gradients — focus rings only. 0.5px borders. 4px grid.
// ---------------------------------------------------------------------------

/** Raw brand constants (authoritative — mirror lib/constants.ts intent). */
export const BRAND = {
  primary: '#0B5FD1',
  trust: '#643293',
} as const;

/**
 * CSS variable names consumed by primitives. Use via Tailwind arbitrary
 * values, e.g. `bg-[var(--crm-bg-primary)]` / `text-[var(--crm-text-secondary)]`.
 */
export const cssVar = {
  // surfaces
  bgPrimary: 'var(--crm-bg-primary)',
  bgSecondary: 'var(--crm-bg-secondary)',
  bgTertiary: 'var(--crm-bg-tertiary)',
  // borders (0.5px)
  border: 'var(--crm-border)',
  borderStrong: 'var(--crm-border-strong)',
  // text
  textPrimary: 'var(--crm-text-primary)',
  textSecondary: 'var(--crm-text-secondary)',
  textTertiary: 'var(--crm-text-tertiary)',
  // brand primary
  primary: 'var(--crm-primary)',
  primaryHover: 'var(--crm-primary-hover)',
  primaryActive: 'var(--crm-primary-active)',
  primarySubtle: 'var(--crm-primary-subtle)',
  onPrimary: 'var(--crm-on-primary)',
  // trust / compliance (#643293 family) — compliance surfaces ONLY
  trust: 'var(--crm-trust)',
  trustSubtle: 'var(--crm-trust-subtle)',
  // semantic
  success: 'var(--crm-success)',
  successSubtle: 'var(--crm-success-subtle)',
  warning: 'var(--crm-warning)',
  warningSubtle: 'var(--crm-warning-subtle)',
  danger: 'var(--crm-danger)',
  dangerSubtle: 'var(--crm-danger-subtle)',
  info: 'var(--crm-info)',
  infoSubtle: 'var(--crm-info-subtle)',
  // focus
  ring: 'var(--crm-ring)',
} as const;

/** Type scale (px) — 22/18/16/13/12. Weights: 400 + 500 only. Sentence case. */
export const type = {
  family: 'var(--font-heading)', // confirmed existing self-hosted Space Grotesk
  size: {
    title: '22px',
    heading: '18px',
    body: '16px',
    sm: '13px',
    xs: '12px',
  },
  weight: {
    regular: 400,
    medium: 500,
  },
  leading: {
    title: '28px',
    heading: '24px',
    body: '22px',
    sm: '18px',
    xs: '16px',
  },
} as const;

/** Geometry — radius + a 4px spacing grid. No shadows / gradients. */
export const geometry = {
  radius: {
    sm: 'var(--crm-radius-sm)', // 4px
    md: 'var(--crm-radius-md)', // 6px
    lg: 'var(--crm-radius-lg)', // 8px
  },
  borderWidth: '0.5px',
  // 4px grid
  space: {
    0.5: '2px',
    1: '4px',
    2: '8px',
    3: '12px',
    4: '16px',
    5: '20px',
    6: '24px',
    8: '32px',
  },
} as const;

/** Density — operators want `compact`; `comfortable` is the default. */
export type Density = 'comfortable' | 'compact';

export const density: Record<Density, { rowPy: string; cellPx: string; text: string }> = {
  comfortable: { rowPy: 'py-2.5', cellPx: 'px-4', text: 'text-[13px]' },
  compact: { rowPy: 'py-1.5', cellPx: 'px-3', text: 'text-[12px]' },
};

/** Lead temperature → semantic mapping (hot→danger, warm→warning, cold→neutral). */
export type Temperature = 'hot' | 'warm' | 'cold';

export const temperatureTone: Record<Temperature, 'danger' | 'warning' | 'neutral'> = {
  hot: 'danger',
  warm: 'warning',
  cold: 'neutral',
};

/** Shared semantic tone union used by Badge / StatusPill. */
export type Tone =
  | 'neutral'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'trust';
