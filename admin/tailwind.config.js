/** @type {import('tailwindcss').Config} */
// Growth Escalators CRM — Fluent design tokens
// Drop-in replacement for admin/tailwind.config.js
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Blue — trust, primary actions
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        // Orange — energy, CTAs, highlights, notification badges
        accent: {
          50: '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c',
        },
        // White/gray — clean canvas
        neutral: {
          0: '#ffffff',
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
        },
        success: { 500: '#22c55e', 600: '#16a34a', 700: '#15803d' },
        warning: { 500: '#f59e0b', 600: '#d97706', 700: '#b45309' },
        // 700 added for PR 8A hardening: badge-danger's text-600-on-500/10
        // combination measures ~4.22:1 contrast, just under WCAG AA's 4.5:1
        // for normal-size text — a pre-existing gap (success/warning already
        // had a 700 shade; danger did not) that stayed latent until the
        // Decision Workbench started rendering a `deny` decision with its
        // correct (non-neutral) tone. Completes the existing 500/600/700
        // pattern rather than introducing a new one.
        danger: { 500: '#ef4444', 600: '#dc2626', 700: '#b91c1c' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        hover: 'var(--shadow-hover)',
        modal: 'var(--shadow-modal)',
        sidebar: 'var(--shadow-sidebar)',
      },
      borderRadius: {
        sm: '4px',   // inputs
        md: '6px',   // buttons
        lg: '8px',   // cards, tables (Fluent standard)
        xl: '12px',  // modals
      },
      transitionTimingFunction: {
        fluent: 'cubic-bezier(0.4, 0, 0.2, 1)',
        'fluent-decelerate': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'fluent-accelerate': 'cubic-bezier(0.4, 0, 1, 1)',
      },
    },
  },
  plugins: [],
};