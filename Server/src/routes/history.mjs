import express from 'express';
import pm2Service from '../services/pm2Service.mjs';
import { createChildLogger } from '../logger.mjs';

const logger = createChildLogger('history-router');
const router = express.Router();

router.get('/logs/history', (req, res) => {
  let linesCount = parseInt(req.query.lines, 10);
  if (isNaN(linesCount) || linesCount <= 0) {
    linesCount = 500;
  }
  linesCount = Math.min(linesCount, 2000);

  logger.debug({ linesCount }, 'Client requested historical log lines');

  pm2Service.getLogHistory(linesCount, (err, historyLines) => {
    if (err) {
      logger.error({ err }, 'Error retrieving PM2 historical logs');
      return res.status(500).json({
        status: 500,
        error: 'Internal Server Error',
        message: 'Could not retrieve PM2 process logs.',
      });
    }

    res.status(200).json({
      status: 200,
      count: historyLines.length,
      lines: historyLines,
    });
  });
});

export default router;
