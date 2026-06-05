import express from 'express';
import pm2Service from '../services/pm2Service.mjs';
import { getActiveClientsCount } from './logs.mjs';
import config from '../config.mjs';

const router = express.Router();

const getSystemMetrics = () => {
  const memUsage = process.memoryUsage();
  return {
    uptimeSec: Math.floor(process.uptime()),
    memory: {
      rssMb: Math.round(memUsage.rss / 1024 / 1024 * 100) / 100,
      heapTotalMb: Math.round(memUsage.heapTotal / 1024 / 1024 * 100) / 100,
      heapUsedMb: Math.round(memUsage.heapUsed / 1024 / 1024 * 100) / 100,
    },
    nodeVersion: process.version,
    platform: process.platform,
  };
};

router.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'UP',
    timestamp: new Date().toISOString(),
    env: config.nodeEnv,
  });
});

router.get('/health/ready', (_req, res) => {
  pm2Service.getProcessInfo((err, processInfo) => {
    const pm2Status = pm2Service.getStatus();
    const systemMetrics = getSystemMetrics();
    const activeSseClients = getActiveClientsCount();

    const isReady = pm2Status.connected && pm2Status.busReady;

    res.status(isReady ? 200 : 503).json({
      status: isReady ? 'READY' : 'NOT_READY',
      timestamp: new Date().toISOString(),
      pm2: pm2Status,
      process: processInfo || null,
      metrics: systemMetrics,
      activeConnections: activeSseClients,
    });
  });
});

export default router;
