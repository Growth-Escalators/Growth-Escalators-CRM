import { Navigate } from 'react-router-dom';

// Compatibility route. Match decisions are now a view inside Candidates.
export default function WizmatchTalentMatchingPage() {
  return <Navigate to="/wizmatch/candidates?view=matching" replace />;
}
