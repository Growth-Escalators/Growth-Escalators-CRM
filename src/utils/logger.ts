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

// Wrapper that accepts console.error-style args: logger.error('msg', data)
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
    } else {
      pinoLogger.warn(withRequestId({}), String(msg));
    }
  },
  info(msg: unknown, ...args: unknown[]) {
    if (typeof msg === 'string' && args.length > 0) {
      pinoLogger.info(withRequestId({ data: args.length === 1 ? args[0] : args }), msg);
    } else {
      pinoLogger.info(withRequestId({}), String(msg));
    }
  },
  debug(msg: unknown, ...args: unknown[]) {
    if (typeof msg === 'string' && args.length > 0) {
      pinoLogger.debug(withRequestId({ data: args.length === 1 ? args[0] : args }), msg);
    } else {
      pinoLogger.debug(withRequestId({}), String(msg));
    }
  },
  child: pinoLogger.child.bind(pinoLogger),
};

export default logger;
