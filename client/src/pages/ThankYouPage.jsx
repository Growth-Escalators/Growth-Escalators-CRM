import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// Segment → destination route
const SEGMENT_ROUTES = {
  d2c: '/consulting',
  agency: '/whitelabel',
  freelancer: '/learn',
};

export default function ThankYouPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const segment = sessionStorage.getItem('ge_segment') || 'd2c';
    const bump1   = sessionStorage.getItem('ge_bump1') === '1';
    const bump2   = sessionStorage.getItem('ge_bump2') === '1';
    const name    = sessionStorage.getItem('ge_name') || '';
    const email   = sessionStorage.getItem('ge_email') || '';

    // Fire GTM purchase event
    if (window.dataLayer) {
      window.dataLayer.push({ event: 'purchase', segment, bump1, bump2 });
    }

    // Build query string for destination page
    const params = new URLSearchParams({
      segment,
      bump1: bump1 ? '1' : '0',
      bump2: bump2 ? '1' : '0',
      name,
      email,
    });

    const route = SEGMENT_ROUTES[segment] ?? '/consulting';
    navigate(`${route}?${params.toString()}`, { replace: true });
  }, [navigate]);

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: '#eef1f8' }}
    >
      <div className="text-center">
        <div className="text-5xl mb-4">✅</div>
        <p className="text-gray-600 font-medium">Payment confirmed — redirecting…</p>
      </div>
    </div>
  );
}
