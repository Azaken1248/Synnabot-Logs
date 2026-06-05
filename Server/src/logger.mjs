import pino from 'pino';
import config from './config.mjs';

const isDevelopment = config.nodeEnv === 'development';

const transport = isDevelopment
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
        ignore: 'pid,hostname',
      },
    }
  : undefined;

const logger = pino({
  level: config.logLevel,
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
  },
  transport,
});

export default logger;
export const createChildLogger = (moduleName) => logger.child({ module: moduleName });
