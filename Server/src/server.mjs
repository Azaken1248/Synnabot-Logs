import express from 'express';
import http from 'http';
import config from './config.mjs';
import logger, { createChildLogger } from './logger.mjs';
import { setupSecurity } from './middleware/security.mjs';
import pm2Service from './services/pm2Service.mjs';
import healthRouter from './routes/health.mjs';
import logsRouter from './routes/logs.mjs';
import historyRouter from './routes/history.mjs';

const serverLogger = createChildLogger('bootstrap');
const app = express();

logger.info({
  environment: config.nodeEnv,
  port: config.port,
  logLevel: config.logLevel,
  pm2TargetApp: config.pm2AppName,
}, 'Starting PM2 Log Broadcaster Server...');

app.set('trust proxy', 1);

setupSecurity(app);

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

app.use('/', healthRouter);
app.use('/', logsRouter);
app.use('/', historyRouter);

app.get('/', (_req, res) => {
  res.send(`PM2 Log Broadcaster is running and listening for logs from "${config.pm2AppName}". Access /logs for the real-time log stream.`);
});

app.use((req, res) => {
  res.status(404).json({
    status: 404,
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.path}`,
  });
});

app.use((err, req, res, _next) => {
  logger.error({ err, path: req.path }, 'Unhandled request error');
  res.status(500).json({
    status: 500,
    error: 'Internal Server Error',
    message: config.nodeEnv === 'production' ? 'An unexpected error occurred.' : err.message,
  });
});

const server = http.createServer(app);

server.listen(config.port, () => {
  serverLogger.info(`Server listening on port ${config.port}`);
  serverLogger.info(`Monitoring logs for PM2 process: "${config.pm2AppName}"`);
  serverLogger.info(`Access logs stream at: http://localhost:${config.port}/logs`);
  
  pm2Service.connect();
});

let isShuttingDown = false;

const shutdown = (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  serverLogger.info(`Received ${signal}. Starting graceful shutdown...`);

  const forceExitTimeout = setTimeout(() => {
    serverLogger.fatal('Graceful shutdown timed out, forcing exit.');
    process.exit(1);
  }, 10000);
  forceExitTimeout.unref();

  server.close(() => {
    serverLogger.info('HTTP server closed. No longer accepting connections.');

    pm2Service.disconnect(() => {
      serverLogger.info('PM2 service disconnected. Cleanup complete.');
      
      clearTimeout(forceExitTimeout);
      serverLogger.info('Shutdown complete. Exiting process.');
      process.exit(0);
    });
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught Exception detected!');
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.fatal({ reason, promise }, 'Unhandled Promise Rejection detected!');
  shutdown('unhandledRejection');
});
