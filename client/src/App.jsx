import React from 'react';
import { Routes, Route } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import CheckoutPage from './pages/CheckoutPage';
import ThankYouPage from './pages/ThankYouPage';
import ConsultingPage from './pages/ConsultingPage';
import AgencyPage from './pages/AgencyPage';
import CommunityPage from './pages/CommunityPage';

function App() {
    return (
        <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/checkout" element={<CheckoutPage />} />
            <Route path="/thank-you" element={<ThankYouPage />} />
            <Route path="/consulting" element={<ConsultingPage />} />
            <Route path="/agency" element={<AgencyPage />} />
            <Route path="/community" element={<CommunityPage />} />
        </Routes>
    );
}

export default App;
