import pm2 from 'pm2';
import { EventEmitter } from 'events';
import fs from 'fs';
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

  getProcessInfo(callback) {
    if (!this.connected) {
      return callback(null, null);
    }
    pm2.describe(config.pm2AppName, (err, processDescriptionList) => {
      if (err) {
        logger.error({ err }, 'Error in pm2.describe');
        return callback(err, null);
      }
      if (!processDescriptionList || processDescriptionList.length === 0) {
        return callback(null, null);
      }
      const processInfo = processDescriptionList[0];
      const name = processInfo.name;
      const pid = processInfo.pid;
      const status = processInfo.pm2_env?.status;
      const uptime = processInfo.pm2_env?.pm_uptime;
      const restarts = processInfo.pm2_env?.restart_time;
      const cpu = processInfo.monit?.cpu || 0;
      const memory = processInfo.monit?.memory || 0;
      const outLog = processInfo.pm2_env?.pm_out_log_path;
      const errLog = processInfo.pm2_env?.pm_err_log_path;

      callback(null, {
        name,
        pid,
        status,
        uptime,
        restarts,
        cpu,
        memory,
        outLog,
        errLog,
      });
    });
  }

  getLogHistory(linesCount, callback) {
    this.getProcessInfo(async (err, info) => {
      if (err) return callback(err, []);
      if (!info) return callback(new Error('Process not found'), []);

      try {
        const outLines = info.outLog ? await readLastLines(info.outLog, linesCount) : [];
        const errLines = info.errLog ? await readLastLines(info.errLog, linesCount) : [];

        const stdoutLogs = outLines.map((line) => ({
          type: 'out',
          text: line,
          timestamp: parseTimestamp(line) || 0,
        }));

        const stderrLogs = errLines.map((line) => ({
          type: 'err',
          text: line,
          timestamp: parseTimestamp(line) || 0,
        }));

        const combined = [...stdoutLogs, ...stderrLogs];
        if (combined.some((c) => c.timestamp > 0)) {
          combined.sort((a, b) => a.timestamp - b.timestamp);
        }

        const resultLines = combined.map((c) => {
          const hasTime = /^\[\d{4}-\d{2}-\d{2}/.test(c.text) || /^\d{4}-\d{2}-\d{2}/.test(c.text);
          if (hasTime) return c.text;

          const prefix = c.type === 'err' ? 'ERR' : 'OUT';
          return `[${new Date().toISOString()}] [${info.name}] [${prefix}] ${c.text}`;
        });

        callback(null, resultLines.slice(Math.max(0, resultLines.length - linesCount)));
      } catch (historyErr) {
        logger.error({ err: historyErr }, 'Error reading PM2 log history files');
        callback(historyErr, []);
      }
    });
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

const readLastLines = (filePath, maxLines) => {
  return new Promise((resolve) => {
    try {
      const stats = fs.statSync(filePath);
      if (!stats.isFile()) return resolve([]);

      const fd = fs.openSync(filePath, 'r');
      const bufferSize = 8192;
      const buffer = Buffer.alloc(bufferSize);
      let lines = [];
      let filePosition = stats.size;
      let leftOver = '';

      while (filePosition > 0 && lines.length <= maxLines) {
        const amountToRead = Math.min(bufferSize, filePosition);
        filePosition -= amountToRead;

        fs.readSync(fd, buffer, 0, amountToRead, filePosition);
        const chunk = buffer.toString('utf8', 0, amountToRead) + leftOver;
        const chunkLines = chunk.split('\n');

        if (filePosition > 0) {
          leftOver = chunkLines.shift();
        } else {
          leftOver = '';
        }

        lines = chunkLines.concat(lines);
      }

      fs.closeSync(fd);

      if (leftOver) {
        lines.unshift(leftOver);
      }

      if (lines.length > maxLines) {
        lines = lines.slice(lines.length - maxLines);
      }

      lines = lines
        .map((line) => line.replace(/\r$/, ''))
        .filter((line) => line.trim() !== '');

      resolve(lines);
    } catch (err) {
      resolve([]);
    }
  });
};

const parseTimestamp = (line) => {
  const match = line.match(/^\[?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\]?/);
  if (match) {
    const d = Date.parse(match[1]);
    if (!isNaN(d)) return d;
  }
  return null;
};

const pm2Service = new PM2Service();
export default pm2Service;
export { PM2Service };
