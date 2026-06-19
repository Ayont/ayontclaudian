/**
 * Claudian - lightweight plugin logger
 *
 * Central replacement for ad-hoc `console.*` calls. Production builds default to
 * a no-op logger so released plugins stay quiet; development builds write to the
 * console with a consistent `[ayontclaudian:<scope>]` prefix.
 */

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

const NO_OP_LOGGER: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function isDevelopment(): boolean {
  return typeof process !== 'undefined' && process.env?.NODE_ENV === 'development';
}

function createConsoleLogger(scope: string): Logger {
  const prefix = `[ayontclaudian:${scope}]`;
  return {
    debug: (message: string, ...args: unknown[]) => {
      console.debug(prefix, message, ...args);
    },
    info: (message: string, ...args: unknown[]) => {
      console.info(prefix, message, ...args);
    },
    warn: (message: string, ...args: unknown[]) => {
      console.warn(prefix, message, ...args);
    },
    error: (message: string, ...args: unknown[]) => {
      console.error(prefix, message, ...args);
    },
  };
}

/** Returns a logger for the given scope. */
export function createLogger(scope: string): Logger {
  return isDevelopment() ? createConsoleLogger(scope) : NO_OP_LOGGER;
}

/** Plugin-wide logger for modules without DI access. */
export const pluginLogger: Logger = createLogger('claudian');
