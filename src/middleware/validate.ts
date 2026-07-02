/**
 * Lightweight input validation middleware.
 *
 * No external dependency — uses simple schema objects instead of Zod/Joi.
 * Validates req.body, req.query, and req.params against a schema of rules.
 *
 * Usage:
 *   router.post('/',
 *     validateBody({ email: 'string|required', amount: 'number|required', tags: 'array|optional' }),
 *     handler
 *   );
 *
 * Supported types: string, number, boolean, uuid, email, array, object
 * Append `|required` or `|optional` (default is optional).
 */

import { type Request, type Response, type NextFunction } from 'express';

type ValidationRule = {
  type: string;
  required: boolean;
};

function parseRule(ruleStr: string): ValidationRule {
  const parts = ruleStr.split('|');
  const type = parts[0] || 'string';
  const required = parts.includes('required');
  return { type, required };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateValue(value: unknown, rule: ValidationRule): string | null {
  // Undefined / null check
  if (value === undefined || value === null || value === '') {
    return rule.required ? 'is required' : null;
  }

  switch (rule.type) {
    case 'string':
      if (typeof value !== 'string') return 'must be a string';
      break;
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) return 'must be a number';
      break;
    case 'boolean':
      if (typeof value !== 'boolean') return 'must be a boolean';
      break;
    case 'uuid':
      if (typeof value !== 'string' || !UUID_RE.test(value)) return 'must be a valid UUID';
      break;
    case 'email':
      if (typeof value !== 'string' || !EMAIL_RE.test(value)) return 'must be a valid email address';
      break;
    case 'array':
      if (!Array.isArray(value)) return 'must be an array';
      break;
    case 'object':
      if (typeof value !== 'object' || Array.isArray(value)) return 'must be an object';
      break;
    default:
      break;
  }
  return null;
}

function validate(
  source: Record<string, unknown>,
  schema: Record<string, string>,
): Record<string, string> | null {
  const errors: Record<string, string> = {};

  for (const [field, ruleStr] of Object.entries(schema)) {
    const rule = parseRule(ruleStr);
    const value = source[field];
    const err = validateValue(value, rule);
    if (err) errors[field] = err;
  }

  return Object.keys(errors).length > 0 ? errors : null;
}

/**
 * Validate fields in req.body.
 * On failure, returns 400 with { error: { code, message, details: { field: msg } } }
 */
export function validateBody(schema: Record<string, string>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors = validate(req.body as Record<string, unknown>, schema);
    if (errors) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: errors,
        },
      });
      return;
    }
    next();
  };
}

/**
 * Validate fields in req.query.
 */
export function validateQuery(schema: Record<string, string>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors = validate(req.query as Record<string, unknown>, schema);
    if (errors) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          details: errors,
        },
      });
      return;
    }
    next();
  };
}

/**
 * Validate fields in req.params.
 */
export function validateParams(schema: Record<string, string>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors = validate(req.params as Record<string, unknown>, schema);
    if (errors) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid path parameters',
          details: errors,
        },
      });
      return;
    }
    next();
  };
}