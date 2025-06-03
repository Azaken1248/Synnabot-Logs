import express from 'express';
import pm2 from 'pm2';
import http from 'http';
import cors from 'cors';

import { EventEmitter } from 'events';

const app = express();
const PORT = process.env.PORT || 6565;
const PM2_APP_NAME_TO_MONITOR = 'Synnabot';

app.use(cors());

const logEmitter = new EventEmitter();

let pm2Bus = null;

let logBuffer = [];
const isLikelyNewLine = (rawData) => {
    return rawData.trim() !== '' && !/^\s/.test(rawData);
};

function flushBuffer() {
    if (logBuffer.length > 0) {
        const fullLogEntry = logBuffer.join('\n');
        logEmitter.emit('log', fullLogEntry);
        logBuffer = [];
    }
}

function connectToPm2() {
    console.log('Attempting to connect to PM2 daemon...');
    pm2.connect((err) => {
        if (err) {
            console.error('Error connecting to PM2:', err);
            setTimeout(connectToPm2, 5000);
            return;
        }
        console.log('Connected to PM2 daemon.');

        pm2.launchBus((busErr, bus) => {
            if (busErr) {
                console.error('Error launching PM2 bus:', busErr);
                setTimeout(connectToPm2, 5000);
                return;
            }

            pm2Bus = bus;
            console.log('PM2 event bus launched.');

            bus.on('log:out', (data) => {
                if (data.process.name === PM2_APP_NAME_TO_MONITOR) {
                    const rawLogData = data.data;
                    const formattedLogLine = `[${new Date().toISOString()}] [${data.process.name}] [OUT] ${rawLogData}`;
                    const startsNewEntry = logBuffer.length === 0 || isLikelyNewLine(rawLogData);

                    if (startsNewEntry) {
                        flushBuffer();
                        logBuffer.push(formattedLogLine);
                    } else {
                        if (logBuffer.length === 0) {
                            logBuffer.push(formattedLogLine);
                        } else {
                            if (rawLogData.trim() !== '' && !/^\s/.test(rawLogData)) {
                                flushBuffer();
                                logBuffer.push(formattedLogLine);
                            } else {
                                logBuffer.push(rawLogData);
                            }
                        }
                    }
                }
            });

            bus.on('log:err', (data) => {
                if (data.process.name === PM2_APP_NAME_TO_MONITOR) {
                    const rawLogData = data.data;
                    const formattedLogLine = `[${new Date().toISOString()}] [${data.process.name}] [ERR] ${rawLogData}`;

                    if (logBuffer.length === 0) {
                        logBuffer.push(formattedLogLine);
                    } else {
                        if (rawLogData.trim() !== '' && !/^\s/.test(rawLogData)) {
                            flushBuffer();
                            logBuffer.push(formattedLogLine);
                        } else {
                            logBuffer.push(rawLogData);
                        }
                    }
                }
            });

            bus.on('reconnecting', () => {
                console.log('PM2 bus reconnecting...');
            });

            bus.on('close', () => {
                console.log('PM2 bus closed. Flushing buffer and attempting to reconnect PM2...');
                flushBuffer();
                pm2Bus = null;
                setTimeout(connectToPm2, 5000);
            });

            bus.on('error', (err) => {
                console.error('PM2 bus error:', err);
            });

            setInterval(flushBuffer, 1000);
        });
    });
}

connectToPm2();

app.get('/logs', (req, res) => {
    console.log('Client connected to /logs');

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const heartbeatInterval = setInterval(() => {
        res.write(':heartbeat\n\n');
    }, 15000);

    const sendLog = (fullLogEntry) => {
        res.write(`data: ${fullLogEntry}\n\n`);
    };

    logEmitter.on('log', sendLog);

    req.on('close', () => {
        console.log('Client disconnected from /logs');
        clearInterval(heartbeatInterval);
        logEmitter.removeListener('log', sendLog);
        res.end();
    });

    res.write(`data: Connected to logs stream for PM2 process "${PM2_APP_NAME_TO_MONITOR}".\n\n`);
});

app.get('/', (_req, res) => {
  res.send(`PM2 Log Broadcaster is running and listening for logs from "${PM2_APP_NAME_TO_MONITOR}". Access /logs for the real-time log stream.`);
});

const server = http.createServer(app);

server.listen(PORT, () => {
    console.log(`PM2 Log Broadcaster listening on port ${PORT}`);
    console.log(`Monitoring logs for PM2 process: "${PM2_APP_NAME_TO_MONITOR}"`);
    console.log(`Access logs at http://localhost:${PORT}/logs`);
});

const shutdown = () => {
    console.log('Shutting down gracefully...');
    flushBuffer();
    if (pm2Bus) {
         pm2Bus.close();
    }
    setTimeout(() => {
        pm2.disconnect(() => {
             console.log('Disconnected from PM2 daemon.');
             server.close(() => {
                console.log('HTTP server closed.');
                process.exit(0);
             });
        });
    }, 500);

    setTimeout(() => {
        console.error('Forcing shutdown due to timeout.');
        process.exit(1);
    }, 10000);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
