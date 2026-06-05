import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const parseEnvInt = (key, defaultValue) => {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a valid integer.`);
  }
  return parsed;
};

const parseCorsOrigins = (value) => {
  if (!value || value === '*') return '*';
  return value.split(',').map((origin) => origin.trim());
};

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseEnvInt('PORT', 6565),
  pm2AppName: process.env.PM2_APP_NAME || 'Synnabot',
  logLevel: process.env.LOG_LEVEL || 'info',
  corsOrigin: parseCorsOrigins(process.env.CORS_ORIGIN),
  rateLimitWindowMs: parseEnvInt('RATE_LIMIT_WINDOW_MS', 900000),
  rateLimitMax: parseEnvInt('RATE_LIMIT_MAX', 100),
  logBufferFlushMs: parseEnvInt('LOG_BUFFER_FLUSH_MS', 1000),
  sseHeartbeatMs: parseEnvInt('SSE_HEARTBEAT_MS', 15000),
  pm2ReconnectDelayMs: parseEnvInt('PM2_RECONNECT_DELAY_MS', 5000),
};

Object.freeze(config);

export default config;
