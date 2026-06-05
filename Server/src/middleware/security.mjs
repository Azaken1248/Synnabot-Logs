import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import config from '../config.mjs';
import { createChildLogger } from '../logger.mjs';

const logger = createChildLogger('security-middleware');

export const setupSecurity = (app) => {
  logger.debug('Configuring security headers with Helmet...');
  app.use(helmet());

  logger.debug('Configuring CORS policy...');
  const corsOptions = {
    origin: config.corsOrigin,
    methods: ['GET', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  };
  app.use(cors(corsOptions));

  logger.debug('Configuring rate limiting...');
  const apiLimiter = rateLimit({
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, _next) => {
      logger.warn({ ip: req.ip, path: req.path }, 'Rate limit exceeded by client');
      res.status(429).json({
        status: 429,
        error: 'Too Many Requests',
        message: 'Too many requests from this IP, please try again later.',
      });
    },
    skip: (req) => req.path.startsWith('/logs') || req.path === '/health' || req.path === '/health/ready',
  });

  app.use(apiLimiter);
};
