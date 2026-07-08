export function isTerminalOutcome(outcome) {
  return outcome === 'won' || outcome === 'lost' || outcome === 'abandoned';
}

export function isWonOutcome(outcome) {
  return outcome === 'won';
}

export function isLostOutcome(outcome) {
  return outcome === 'lost';
}

export function isAbandonedOutcome(outcome) {
  return outcome === 'abandoned';
}
