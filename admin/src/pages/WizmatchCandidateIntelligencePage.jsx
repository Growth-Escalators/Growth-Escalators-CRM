import { Navigate } from 'react-router-dom';

// Compatibility route. Candidate evidence review now lives in the entity-first
// Candidates workspace so users do not have to reconcile two candidate queues.
export default function WizmatchCandidateIntelligencePage() {
  return <Navigate to="/wizmatch/candidates?view=evidence" replace />;
}
