// Frontend copy of the product catalog for display purposes.
// NOTE: The backend (backend/src/config/products.js) is the AUTHORITATIVE source for prices.
// The backend recalculates all totals server-side — these values are for UI display only.

export const PRODUCTS = {
  BASE: {
    id: 'funnel-breakdown-pack',
    name: 'Top 5 D2C Brand Funnel Breakdown',
    description: '5 complete funnel breakdowns from boAt, GIVA, Minimalist, Libas & SUGAR',
    price: 9,
    originalPrice: 999,
    emoji: '📦',
  },
  BUMP1: {
    id: 'advanced-growth-kit',
    name: 'Advanced D2C Growth Kit',
    description: '20 brand breakdowns + 600+ ad screenshots + CRO & SEO checklists. 67% of buyers add this.',
    price: 199,
    originalPrice: 1999,
    emoji: '🔥',
  },
  BUMP2: {
    id: 'personalized-growth-audit',
    name: 'Personalized Growth Audit (Meta + CRO)',
    description: 'Our experts audit YOUR ads + funnel. Get a custom report with specific fixes to boost ROAS.',
    price: 499,
    originalPrice: 4999,
    emoji: '🎯',
  },
};

export const OPTIONAL_BUMPS = [PRODUCTS.BUMP1, PRODUCTS.BUMP2];
