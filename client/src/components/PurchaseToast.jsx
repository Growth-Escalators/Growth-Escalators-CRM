import { useEffect, useState, useRef } from 'react';

export default function PurchaseToast({
  show,
  onClose,
  autoDismissMs = 5000
}) {
  const [visible, setVisible] = useState(false);
  const [animateBar, setAnimateBar] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (show) {
      // Small delay so CSS transition fires correctly after mount
      const mountDelay = setTimeout(() => {
        setVisible(true);
        setAnimateBar(true);
      }, 100);

      timerRef.current = setTimeout(() => {
        handleClose();
      }, autoDismissMs);

      return () => {
        clearTimeout(mountDelay);
        if (timerRef.current) clearTimeout(timerRef.current);
      };
    }
  }, [show]);

  const handleClose = () => {
    setVisible(false);
    setAnimateBar(false);
    setTimeout(onClose, 400); // Wait for slide-out animation
  };

  if (!show && !visible) return null;

  return (
    <>
      <style>{`
        @keyframes ge-shrink {
          from { width: 100%; }
          to { width: 0%; }
        }
        .ge-toast-enter {
          transform: translate(-50%, 0) !important;
          opacity: 1 !important;
        }
      `}</style>
      <div
        style={{
          position: 'fixed',
          bottom: '24px',
          left: '50%',
          transform: visible ? 'translate(-50%, 0)' : 'translate(-50%, 120px)',
          opacity: visible ? 1 : 0,
          transition: 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease',
          background: '#1B2E5E',
          borderRadius: '12px',
          border: '1px solid rgba(255,255,255,0.1)',
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          minWidth: '300px',
          maxWidth: '380px',
          width: 'calc(100vw - 48px)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
          zIndex: 9999,
          overflow: 'hidden',
        }}
        role="alert"
        aria-live="polite"
      >
        {/* Green check icon */}
        <div style={{
          width: '36px',
          height: '36px',
          borderRadius: '50%',
          background: '#22c55e',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '18px',
          flexShrink: 0,
        }}>
          ✓
        </div>

        {/* Text content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: '13px',
            fontWeight: 700,
            color: '#fff',
            marginBottom: '2px',
            fontFamily: 'Inter, system-ui, sans-serif',
          }}>
            Your pack is on its way!
          </div>
          <div style={{
            fontSize: '11px',
            color: 'rgba(255,255,255,0.6)',
            marginBottom: '5px',
            fontFamily: 'Inter, system-ui, sans-serif',
          }}>
            Arriving within 60 seconds via
          </div>
          <div style={{ display: 'flex', gap: '5px' }}>
            <span style={{
              fontSize: '10px',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: '4px',
              background: 'rgba(37,211,102,0.2)',
              color: '#4ade80',
              fontFamily: 'Inter, system-ui, sans-serif',
            }}>
              📱 WhatsApp
            </span>
            <span style={{
              fontSize: '10px',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: '4px',
              background: 'rgba(96,165,250,0.2)',
              color: '#93c5fd',
              fontFamily: 'Inter, system-ui, sans-serif',
            }}>
              ✉️ Email
            </span>
          </div>
        </div>

        {/* Close button */}
        <button
          onClick={handleClose}
          style={{
            color: 'rgba(255,255,255,0.35)',
            fontSize: '20px',
            cursor: 'pointer',
            background: 'none',
            border: 'none',
            lineHeight: 1,
            padding: '2px 4px',
            flexShrink: 0,
            fontFamily: 'inherit',
          }}
          aria-label="Close notification"
        >
          ×
        </button>

        {/* Orange progress bar at bottom */}
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          height: '3px',
          background: '#F47B20',
          borderRadius: '0 0 12px 12px',
          width: animateBar ? '0%' : '100%',
          transition: animateBar
            ? `width ${autoDismissMs}ms linear`
            : 'none',
        }} />
      </div>
    </>
  );
}
