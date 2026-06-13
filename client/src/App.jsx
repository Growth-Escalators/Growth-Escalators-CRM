import React from 'react';
import { Routes, Route } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import CheckoutPage from './pages/CheckoutPage';
import ThankYouPage from './pages/ThankYouPage';
import ConsultingPage from './pages/ConsultingPage';
import WhitelabelPage from './pages/WhitelabelPage';
import LearnPage from './pages/LearnPage';
import AgencyPage from './pages/AgencyPage';
import CommunityPage from './pages/CommunityPage';

function App() {
    return (
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
    );
}

export default App;
