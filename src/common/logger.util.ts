import { Logger } from '@nestjs/common';
import {
  LOGGING_CONFIG,
  shouldLogObject,
  maskSensitiveData,
  truncateLargeObject,
} from './logging.config';

export class SmartLogger {
  private logger: Logger;

  constructor(context: string) {
    this.logger = new Logger(context);
  }

  log(message: string, data?: any) {
    if (!LOGGING_CONFIG.enabled || !LOGGING_CONFIG.logInfo) return;

    if (data && !shouldLogObject(data)) {
      this.logger.log(`${message} [Object too large, size: ${this.getObjectSize(data)} bytes]`);
    } else {
      const processedData = data ? maskSensitiveData(truncateLargeObject(data)) : data;
      this.logger.log(message, processedData);
    }
  }

  debug(message: string, data?: any) {
    if (!LOGGING_CONFIG.enabled || !LOGGING_CONFIG.logDebug) return;

    if (data && !shouldLogObject(data)) {
      this.logger.debug(`${message} [Object too large, size: ${this.getObjectSize(data)} bytes]`);
    } else {
      const processedData = data ? maskSensitiveData(truncateLargeObject(data)) : data;
      this.logger.debug(message, processedData);
    }
  }

  warn(message: string, data?: any) {
    if (!LOGGING_CONFIG.logWarnings) return;

    if (data && !shouldLogObject(data)) {
      this.logger.warn(`${message} [Object too large, size: ${this.getObjectSize(data)} bytes]`);
    } else {
      const processedData = data ? maskSensitiveData(truncateLargeObject(data)) : data;
      this.logger.warn(message, processedData);
    }
  }

  error(message: string, error?: any) {
    if (!LOGGING_CONFIG.logErrors) return;

    if (error && !shouldLogObject(error)) {
      this.logger.error(`${message} [Error too large, size: ${this.getObjectSize(error)} bytes]`);
    } else {
      const processedError = error ? maskSensitiveData(truncateLargeObject(error)) : error;
      this.logger.error(message, processedError);
    }
  }

  private isLargeObject(obj: any): boolean {
    const size = this.getObjectSize(obj);
    return size > 1000; // Considera objetos com mais de 1KB como grandes
  }

  private getObjectSize(obj: any): number {
    try {
      return JSON.stringify(obj).length;
    } catch {
      return 0;
    }
  }

  // Método para logar apenas informações essenciais de objetos grandes
  logEssential(message: string, data: any, essentialKeys: string[] = []) {
    if (!LOGGING_CONFIG.enabled || !LOGGING_CONFIG.logInfo) return;

    if (this.isLargeObject(data)) {
      const essential = this.extractEssentialData(data, essentialKeys);
      this.logger.log(`${message} (essential data only):`, essential);
    } else {
      this.logger.log(message, data);
    }
  }

  private extractEssentialData(data: any, keys: string[]): any {
    if (Array.isArray(data)) {
      return data.map((item) => this.extractEssentialData(item, keys));
    }

    if (typeof data === 'object' && data !== null) {
      const result: any = {};
      for (const key of keys) {
        if (data.hasOwnProperty(key)) {
          result[key] = data[key];
        }
      }
      return result;
    }

    return data;
  }
}
