// src/utils/Logger.ts

/**
 * Production-grade logger that suppresses output in non-dev environments
 * and helps sanitize sensitive data.
 */

// Basic check for dev environment
// Use process.env.NODE_ENV check if __DEV__ is not available (though it should be in RN)
const IS_DEV = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class LoggerService {
  private prefix = '[BulkBlast]';

  private formatMessage(level: LogLevel, message: string, data?: any): string {
    return `${this.prefix} [${level.toUpperCase()}] ${message}`;
  }

  debug(message: string, ...args: any[]) {
    if (IS_DEV) {
      console.debug(this.formatMessage('debug', message), ...args);
    }
  }

  info(message: string, ...args: any[]) {
    if (IS_DEV) {
      console.info(this.formatMessage('info', message), ...args);
    }
  }

  warn(message: string, ...args: any[]) {
    // Warnings might be useful in prod for crash reporting services (e.g. Sentry)
    // For now, we just log to console
    console.warn(this.formatMessage('warn', message), ...args);
  }

  error(message: string, error?: any, ...args: any[]) {
    // Errors should always be visible or reported
    // In a real app, you'd send this to Sentry/Bugsnag
    console.error(this.formatMessage('error', message), error, ...args);
  }

  /**
   * Safe stringify that handles circular references and sanitizes potential secrets
   * (Primitive sanitization - simplistic)
   */
  sanitize(data: any): string {
    try {
      return JSON.stringify(data, (key, value) => {
        if (key.match(/key|secret|password|mnemonic|seed/i)) {
          return '***REDACTED***';
        }
        return value;
      }, 2);
    } catch (e) {
      return '[Unable to stringify]';
    }
  }
}

export const Logger = new LoggerService();
