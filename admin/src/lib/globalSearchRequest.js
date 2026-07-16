export function invalidateGlobalSearchRequest(requestRef) {
  requestRef.current += 1;
  return requestRef.current;
}
