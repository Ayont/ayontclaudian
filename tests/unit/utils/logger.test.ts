import { createLogger, pluginLogger } from '@/utils/logger';

describe('logger', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalConsole = {
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  let calls: Array<{ level: string; args: unknown[] }> = [];

  beforeEach(() => {
    calls = [];
    console.debug = jest.fn((...args: unknown[]) => { calls.push({ level: 'debug', args }); });
    console.info = jest.fn((...args: unknown[]) => { calls.push({ level: 'info', args }); });
    console.warn = jest.fn((...args: unknown[]) => { calls.push({ level: 'warn', args }); });
    console.error = jest.fn((...args: unknown[]) => { calls.push({ level: 'error', args }); });
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    console.debug = originalConsole.debug;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  });

  it('prefixes messages with scope in development', () => {
    process.env.NODE_ENV = 'development';
    const logger = createLogger('test');
    logger.info('hello');
    expect(calls).toEqual([{ level: 'info', args: ['[ayontclaudian:test]', 'hello'] }]);
  });

  it('no-ops in production by default', () => {
    process.env.NODE_ENV = 'production';
    const logger = createLogger('test');
    logger.info('hello');
    logger.warn('warning');
    logger.error('error');
    logger.debug('debug');
    expect(calls).toHaveLength(0);
  });

  it('includes extra args in development', () => {
    process.env.NODE_ENV = 'development';
    const logger = createLogger('test');
    logger.error('boom', { detail: 1 });
    expect(calls).toEqual([{ level: 'error', args: ['[ayontclaudian:test]', 'boom', { detail: 1 }] }]);
  });

  it('pluginLogger is a stable singleton', () => {
    expect(pluginLogger).toBe(pluginLogger);
  });
});
