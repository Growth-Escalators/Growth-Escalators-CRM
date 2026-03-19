import React from 'react';
import { Routes, Route } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import CheckoutPage from './pages/CheckoutPage';
import ThankYouPage from './pages/ThankYouPage';

function App() {
    return (
        <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/checkout" element={<CheckoutPage />} />
            <Route path="/thank-you" element={<ThankYouPage />} />
        </Routes>
    );
}

export default App;
