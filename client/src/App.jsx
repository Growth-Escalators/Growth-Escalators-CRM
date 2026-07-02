import React, { Suspense, lazy, Component } from 'react';
import { Routes, Route, Link } from 'react-router-dom';

// Code splitting — each page is loaded on demand, reducing initial bundle size.
const LandingPage = lazy(() => import('./pages/LandingPage'));
const CheckoutPage = lazy(() => import('./pages/CheckoutPage'));
const ThankYouPage = lazy(() => import('./pages/ThankYouPage'));
const ConsultingPage = lazy(() => import('./pages/ConsultingPage'));
const WhitelabelPage = lazy(() => import('./pages/WhitelabelPage'));
const LearnPage = lazy(() => import('./pages/LearnPage'));
const AgencyPage = lazy(() => import('./pages/AgencyPage'));
const CommunityPage = lazy(() => import('./pages/CommunityPage'));

// Loading fallback shown while a lazy page chunk downloads.
function PageLoader() {
    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            fontFamily: 'system-ui, sans-serif',
            color: '#666',
        }}>
            <div>Loading…</div>
        </div>
    );
}

// Error boundary — catches render errors so a broken page doesn't blank the
// entire app. Shows a friendly fallback with a link back to safety.
class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error('[ErrorBoundary]', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: '100vh',
                    fontFamily: 'system-ui, sans-serif',
                    color: '#333',
                    gap: '1rem',
                    padding: '2rem',
                    textAlign: 'center',
                }}>
                    <h1 style={{ fontSize: '1.5rem', margin: 0 }}>Something went wrong</h1>
                    <p style={{ margin: 0, color: '#666' }}>
                        We're sorry for the inconvenience. Please try reloading the page.
                    </p>
                    <Link
                        to="/"
                        style={{
                            color: '#2563eb',
                            textDecoration: 'underline',
                            cursor: 'pointer',
                        }}
                        onClick={() => this.setState({ hasError: false, error: null })}
                    >
                        Go to homepage
                    </Link>
                </div>
            );
        }
        return this.props.children;
    }
}

function App() {
    return (
        <ErrorBoundary>
            <Suspense fallback={<PageLoader />}>
                <Routes>
                    <Route path="/" element={<LandingPage />} />
                    <Route path="/checkout" element={<CheckoutPage />} />
                    <Route path="/thank-you" element={<ThankYouPage />} />
                    <Route path="/consulting" element={<ConsultingPage />} />
                    <Route path="/whitelabel" element={<WhitelabelPage />} />
                    <Route path="/learn" element={<LearnPage />} />
                    <Route path="/agency" element={<AgencyPage />} />
                    <Route path="/community" element={<CommunityPage />} />
                    {/* Path-routed funnels — slug detected from the URL path by
                        useFunnelConfig. Pages are identical to the canonical ones;
                        the hook + bundled config handle the per-funnel difference. */}
                    <Route path="/creative-kit" element={<LandingPage />} />
                    <Route path="/creative-kit/checkout" element={<CheckoutPage />} />
                    <Route path="/creative-kit/thank-you" element={<ThankYouPage />} />
                </Routes>
            </Suspense>
        </ErrorBoundary>
    );
}

export default App;