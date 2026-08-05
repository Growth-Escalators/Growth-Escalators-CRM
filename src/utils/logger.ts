import pino from 'pino';
import { getRequestId } from './requestContext';

const isProduction = process.env.NODE_ENV === 'production';

const pinoLogger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      }),
});

// Merges the current request's ID (set by index.ts's request-id middleware
// via runWithRequestContext) into every log line, including ones written
// from deep inside a service call — not just the route handler. Without
// this, a prod error line has no requestId, no path, no way to correlate
// it back to the request that triggered it.
function withRequestId(data: Record<string, unknown>): Record<string, unknown> {
  const requestId = getRequestId();
  return requestId ? { ...data, requestId } : data;
}

// Wrapper accepting BOTH call styles, because the codebase uses both:
//   console-style — logger.warn('message', data)
//   pino-style    — logger.warn({ err, id }, 'message')
//
// Only `error` handled the pino form originally. `warn`, `info` and `debug`
// fell through to `String(msg)`, which renders an object as the literal
// "[object Object]" and DISCARDS the message argument entirely — so 31 warn
// and 15 info call sites across the repo were logging a useless line with no
// message and no structured fields. Found via a cost-guard test whose output
// showed `WARN: [object Object]` where a blocked-spend reason should have
// been: precisely the log you need when money is being refused.
const logger = {
  error(msg: unknown, ...args: unknown[]) {
    if (typeof msg === 'string' && args.length > 0) {
      pinoLogger.error(withRequestId({ data: args.length === 1 ? args[0] : args }), msg);
    } else if (typeof msg === 'object' && msg !== null) {
      pinoLogger.error(withRequestId(msg as Record<string, unknown>), args[0] as string);
    } else {
      pinoLogger.error(withRequestId({}), String(msg));
    }
  },
  warn(msg: unknown, ...args: unknown[]) {
    if (typeof msg === 'string' && args.length > 0) {
      pinoLogger.warn(withRequestId({ data: args.length === 1 ? args[0] : args }), msg);
    } else if (typeof msg === 'object' && msg !== null) {
      pinoLogger.warn(withRequestId(msg as Record<string, unknown>), args[0] as string);
    } else {
      pinoLogger.warn(withRequestId({}), String(msg));
    }
  },
  info(msg: unknown, ...args: unknown[]) {
    if (typeof msg === 'string' && args.length > 0) {
      pinoLogger.info(withRequestId({ data: args.length === 1 ? args[0] : args }), msg);
    } else if (typeof msg === 'object' && msg !== null) {
      pinoLogger.info(withRequestId(msg as Record<string, unknown>), args[0] as string);
    } else {
      pinoLogger.info(withRequestId({}), String(msg));
    }
  },
  debug(msg: unknown, ...args: unknown[]) {
    if (typeof msg === 'string' && args.length > 0) {
      pinoLogger.debug(withRequestId({ data: args.length === 1 ? args[0] : args }), msg);
    } else if (typeof msg === 'object' && msg !== null) {
      pinoLogger.debug(withRequestId(msg as Record<string, unknown>), args[0] as string);
    } else {
      pinoLogger.debug(withRequestId({}), String(msg));
    }
  },
  child: pinoLogger.child.bind(pinoLogger),
};

export default logger;
