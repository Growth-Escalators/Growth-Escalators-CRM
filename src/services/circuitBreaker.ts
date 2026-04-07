import logger from '../utils/logger';

export class CircuitBreaker {
  private failures = 0;
  private lastFailure: Date | null = null;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private name: string,
    private threshold = 3,
    private resetTimeoutMs = 60000,
  ) {}

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (this.lastFailure && Date.now() - this.lastFailure.getTime() > this.resetTimeoutMs) {
        this.state = 'half-open';
      } else {
        throw new Error(`${this.name} circuit breaker is open — skipping call`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailure = new Date();
    if (this.failures >= this.threshold) {
      this.state = 'open';
      logger.error(`[circuit-breaker] ${this.name} OPENED after ${this.failures} failures — will retry in ${this.resetTimeoutMs / 1000}s`);
    }
  }

  getState(): string { return this.state; }
  getFailures(): number { return this.failures; }
}

// Pre-configured breakers for external APIs
export const metaApiBreaker = new CircuitBreaker('Meta API', 3, 120_000);
export const saleshandyBreaker = new CircuitBreaker('Saleshandy', 3, 60_000);
export const slackBreaker = new CircuitBreaker('Slack', 5, 60_000);
