/**
 * Standardized API error utilities.
 *
 * Problem being solved: routes across the codebase return errors in
 * inconsistent shapes — `{ error: "..." }`, `{ message: "..." }`,
 * `{ success: false, error: { code, detail } }`, raw strings, etc.
 *
 * This module provides a single `HttpError` class and `sendError` helper
 * so all error responses follow the same envelope:
 *
 *   { error: { code: "VALIDATION_ERROR", message: "email is required" } }
 *
 * Usage in route handlers:
 *   if (!email) throw new HttpError(400, 'email is required', 'VALIDATION_ERROR');
 *   // or:
 *   if (!email) return sendError(res, 400, 'email is required', 'VALIDATION_ERROR');
 *
 * The global error handler in src/index.ts catches thrown HttpError instances
 * and serializes them automatically.
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'EXTERNAL_SERVICE_ERROR'
  | 'INTERNAL_ERROR';

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code: ErrorCode = 'INTERNAL_ERROR',
    public details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Send a standardized error response. Use this directly in handlers that
 * can't use throw (e.g., inside callbacks).
 */
export function sendError(
  res: import('express').Response,
  statusCode: number,
  message: string,
  code: ErrorCode = 'INTERNAL_ERROR',
  details?: unknown,
): void {
  res.status(statusCode).json({
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  });
}

/**
 * Serialize an HttpError for the global error handler.
 * Non-HttpError exceptions get a generic 500 to avoid leaking internals.
 */
export function serializeError(err: unknown): { status: number; body: unknown } {
  if (err instanceof HttpError) {
    return {
      status: err.statusCode,
      body: {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
        },
      },
    };
  }
  // Don't leak internal error messages/stacks in production
  return {
    status: 500,
    body: { error: { code: 'INTERNAL_ERROR' as ErrorCode, message: 'internal server error' } },
  };
}