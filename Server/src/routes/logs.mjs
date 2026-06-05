import express from 'express';
import pm2Service from '../services/pm2Service.mjs';
import config from '../config.mjs';
import { createChildLogger } from '../logger.mjs';

const logger = createChildLogger('logs-router');
const router = express.Router();

const activeClients = new Set();

export const getActiveClientsCount = () => activeClients.size;

router.get('/logs', (req, res) => {
  const clientIp = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  
  logger.info({ clientIp }, 'Client requested SSE log stream connection');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  activeClients.add(res);
  logger.debug({ activeCount: activeClients.size }, 'Active client connection added');

  res.write(`data: Connected to logs stream for PM2 process "${config.pm2AppName}".\n\n`);

  const heartbeatInterval = setInterval(() => {
    res.write(':heartbeat\n\n');
  }, config.sseHeartbeatMs);

  const sendLog = (fullLogEntry) => {
    try {
      const sseData = fullLogEntry.split('\n').map(line => `data: ${line}`).join('\n');
      res.write(`${sseData}\n\n`);
    } catch (writeErr) {
      logger.error({ err: writeErr, clientIp }, 'Error writing to SSE stream');
    }
  };

  pm2Service.on('log', sendLog);

  req.on('close', () => {
    logger.info({ clientIp }, 'Client disconnected from SSE log stream');
    
    clearInterval(heartbeatInterval);
    pm2Service.removeListener('log', sendLog);
    activeClients.delete(res);
    
    logger.debug({ activeCount: activeClients.size }, 'Active client connection removed');
    res.end();
  });
});

export default router;
