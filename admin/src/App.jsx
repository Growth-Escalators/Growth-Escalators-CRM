import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage.jsx';
import ContactsPage from './pages/ContactsPage.jsx';
import PipelinePage from './pages/PipelinePage.jsx';
import AutomationsPage from './pages/AutomationsPage.jsx';

function PrivateRoute({ children }) {
  const token = localStorage.getItem('ge_crm_token');
  return token ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter basename="/crm">
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/contacts"
          element={
            <PrivateRoute>
              <ContactsPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/pipeline"
          element={
            <PrivateRoute>
              <PipelinePage />
            </PrivateRoute>
          }
        />
        <Route
          path="/automations"
          element={
            <PrivateRoute>
              <AutomationsPage />
            </PrivateRoute>
          }
        />
        <Route path="/" element={<Navigate to="/contacts" replace />} />
        <Route path="*" element={<Navigate to="/contacts" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
