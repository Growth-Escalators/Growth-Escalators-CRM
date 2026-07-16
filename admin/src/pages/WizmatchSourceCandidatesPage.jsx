import { Navigate } from 'react-router-dom';

// Compatibility route. Sourcing is requirement-first: users start from an
// accepted, skill-reviewed requirement and the results appear as candidate leads.
export default function WizmatchSourceCandidatesPage() {
  return <Navigate to="/wizmatch/candidates?view=leads" replace />;
}
