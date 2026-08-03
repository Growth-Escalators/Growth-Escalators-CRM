// Runtime white-label mechanism: fetches the currently-authenticated tenant's
// branding row and injects it into the page — CSS custom-property color
// tokens (index.css's --color-primary-*/--color-accent-*), document.title,
// and the favicon <link>.
//
// KNOWN LIMITATION (disclosed in the PR body, not silently swept under the
// rug): most of the admin SPA is styled with Tailwind utility classes
// (`bg-primary-700`, `text-accent-500`, ...) compiled from tailwind.config.js's
// OWN hardcoded hex palette — a separate, manually-kept-in-sync copy of the
// same colors as index.css's CSS custom properties. Setting these CSS vars at
// runtime therefore only re-colors the handful of elements that read
// var(--color-primary-*) directly today (e.g. the focus-ring rule in
// index.css); it does not retint Tailwind-class-driven elements. Making the
// whole UI dynamically on-brand would mean migrating tailwind.config.js's
// palette to reference these same CSS vars — a materially bigger, separate
// change, out of scope for this pass.
import { apiFetch } from './api.js';
import { getTenantBranding, setTenantBranding } from './auth.js';

const PRIMARY_SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
const ACCENT_SHADES = [50, 100, 200, 400, 500, 600, 700];

// Target lightness (HSL) per Tailwind-style shade step, treating the tenant's
// single supplied hex as the "600" mid-tone brand color and interpolating a
// full scale around it — the same shade steps index.css already defines.
const LIGHTNESS_BY_SHADE = {
  50: 0.96, 100: 0.91, 200: 0.83, 300: 0.72, 400: 0.60,
  500: 0.50, 600: 0.42, 700: 0.34, 800: 0.27, 900: 0.20,
};

function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let hue = 0;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
  }
  return { h: hue, s, l };
}

function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function applyColorScale(root, prefix, hex, shades) {
  const hsl = hexToHsl(hex);
  if (!hsl) return;
  for (const shade of shades) {
    root.style.setProperty(`--color-${prefix}-${shade}`, hslToHex(hsl.h, hsl.s, LIGHTNESS_BY_SHADE[shade] ?? 0.5));
  }
}

// Applies a branding object (the shape returned by GET /api/tenant-branding's
// `branding` field) to the current document. Safe to call with a null/partial
// object — every field is optional and a missing one just leaves the current
// value in place.
export function applyTenantBranding(branding) {
  if (typeof document === 'undefined' || !branding) return;
  const root = document.documentElement;

  if (branding.primaryColor) applyColorScale(root, 'primary', branding.primaryColor, PRIMARY_SHADES);
  if (branding.accentColor) applyColorScale(root, 'accent', branding.accentColor, ACCENT_SHADES);

  if (branding.displayName) {
    document.title = `${branding.displayName} CRM`;
  }

  if (branding.faviconUrl) {
    let link = document.querySelector('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = branding.faviconUrl;
  }
}

// Fetches the current tenant's branding, caches it (admin/src/lib/auth.js),
// and applies it to the document. Best-effort and silent on failure —
// branding is cosmetic and must never block login, session-restore, or
// navigation. Returns the branding object on success, null otherwise.
export async function refreshTenantBranding() {
  try {
    const data = await apiFetch('/api/tenant-branding');
    if (data?.branding) {
      setTenantBranding(data.branding);
      applyTenantBranding(data.branding);
      return data.branding;
    }
  } catch {
    // best-effort — see module docstring
  }
  return null;
}

// Applies whatever branding is already cached (e.g. from a previous session)
// immediately, with no network round-trip — call this on boot before
// refreshTenantBranding() so a returning tenant never sees a flash of GE's
// default branding while the fresh fetch is in flight.
export function applyCachedTenantBranding(slug) {
  applyTenantBranding(getTenantBranding(slug));
}
