import pm2 from 'pm2';
import { EventEmitter } from 'events';
import config from '../config.mjs';
import { createChildLogger } from '../logger.mjs';

const logger = createChildLogger('pm2-service');

class PM2Service extends EventEmitter {
  constructor() {
    super();
    this.pm2Bus = null;
    this.logBuffer = [];
    this.connected = false;
    this.busReady = false;
    this.flushInterval = null;
    this.reconnectTimeout = null;
    this.currentReconnectDelay = config.pm2ReconnectDelayMs;
  }

  isLikelyNewLine(rawData) {
    return rawData.trim() !== '' && !/^\s/.test(rawData);
  }

  flushBuffer() {
    if (this.logBuffer.length > 0) {
      const fullLogEntry = this.logBuffer.join('\n');
      this.emit('log', fullLogEntry);
      this.logBuffer = [];
    }
  }

  connect() {
    logger.info('Attempting to connect to PM2 daemon...');
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    pm2.connect((err) => {
      if (err) {
        this.connected = false;
        logger.error({ err }, 'Error connecting to PM2 daemon');
        this.scheduleReconnect();
        return;
      }

      this.connected = true;
      this.currentReconnectDelay = config.pm2ReconnectDelayMs;
      logger.info('Successfully connected to PM2 daemon.');

      pm2.launchBus((busErr, bus) => {
        if (busErr) {
          this.busReady = false;
          logger.error({ err: busErr }, 'Error launching PM2 event bus');
          this.scheduleReconnect();
          return;
        }

        this.pm2Bus = bus;
        this.busReady = true;
        logger.info('PM2 event bus launched.');

        if (!this.flushInterval) {
          this.flushInterval = setInterval(() => this.flushBuffer(), config.logBufferFlushMs);
        }

        bus.on('log:out', (data) => {
          if (data.process.name === config.pm2AppName) {
            const rawLogData = data.data;
            const formattedLogLine = `[${new Date().toISOString()}] [${data.process.name}] [OUT] ${rawLogData}`;
            const startsNewEntry = this.logBuffer.length === 0 || this.isLikelyNewLine(rawLogData);

            if (startsNewEntry) {
              this.flushBuffer();
              this.logBuffer.push(formattedLogLine);
            } else {
              if (this.logBuffer.length === 0) {
                this.logBuffer.push(formattedLogLine);
              } else {
                if (rawLogData.trim() !== '' && !/^\s/.test(rawLogData)) {
                  this.flushBuffer();
                  this.logBuffer.push(formattedLogLine);
                } else {
                  this.logBuffer.push(rawLogData);
                }
              }
            }
          }
        });

        bus.on('log:err', (data) => {
          if (data.process.name === config.pm2AppName) {
            const rawLogData = data.data;
            const formattedLogLine = `[${new Date().toISOString()}] [${data.process.name}] [ERR] ${rawLogData}`;

            if (this.logBuffer.length === 0) {
              this.logBuffer.push(formattedLogLine);
            } else {
              if (rawLogData.trim() !== '' && !/^\s/.test(rawLogData)) {
                this.flushBuffer();
                this.logBuffer.push(formattedLogLine);
              } else {
                this.logBuffer.push(rawLogData);
              }
            }
          }
        });

        bus.on('reconnecting', () => {
          logger.warn('PM2 bus reconnecting...');
          this.busReady = false;
        });

        bus.on('close', () => {
          logger.warn('PM2 bus closed. Flushing buffer and attempting to reconnect...');
          this.cleanupBus();
          this.scheduleReconnect();
        });

        bus.on('error', (busError) => {
          logger.error({ err: busError }, 'PM2 bus error encountered');
        });
      });
    });
  }

  scheduleReconnect() {
    if (this.reconnectTimeout) return;

    logger.info(`Scheduling PM2 connection retry in ${this.currentReconnectDelay}ms...`);
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, this.currentReconnectDelay);

    this.currentReconnectDelay = Math.min(this.currentReconnectDelay * 2, 30000);
  }

  cleanupBus() {
    this.flushBuffer();
    this.busReady = false;
    this.pm2Bus = null;
    
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
  }

  disconnect(callback) {
    logger.info('Initiating PM2 service disconnect...');
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.cleanupBus();

    if (this.connected) {
      pm2.disconnect(() => {
        this.connected = false;
        logger.info('Disconnected from PM2 daemon.');
        if (callback) callback();
      });
    } else {
      if (callback) callback();
    }
  }

  getStatus() {
    return {
      connected: this.connected,
      busReady: this.busReady,
      bufferSize: this.logBuffer.length,
      targetApp: config.pm2AppName,
    };
  }
}

const pm2Service = new PM2Service();
export default pm2Service;
export { PM2Service };
