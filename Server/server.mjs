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
                    const logLine = `[${new Date().toISOString()}] [${data.process.name}] [OUT] ${data.data}`;
                    logEmitter.emit('log', logLine);
                }
            });

            bus.on('log:err', (data) => {

                 if (data.process.name === PM2_APP_NAME_TO_MONITOR) {
                    const logLine = `[${new Date().toISOString()}] [${data.process.name}] [ERR] ${data.data}`;
                    logEmitter.emit('log', logLine);
                }
            });

            bus.on('reconnecting', () => {
                console.log('PM2 bus reconnecting...');
            });

            bus.on('close', () => {
                console.log('PM2 bus closed. Attempting to reconnect PM2...');
                pm2Bus = null;
                setTimeout(connectToPm2, 5000);
            });

             bus.on('error', (err) => {
                console.error('PM2 bus error:', err);
                setTimeout(connectToPm2, 5000);
            });
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

    const sendLog = (logLine) => {
        res.write(`data: ${logLine}\n\n`);
         res.flush && res.flush();
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
    if (pm2Bus) {
         pm2Bus.close();
    }
    pm2.disconnect(() => {
         console.log('Disconnected from PM2 daemon.');
         server.close(() => {
            console.log('HTTP server closed.');
            process.exit(0);
         });
    });

    setTimeout(() => {
        console.error('Forcing shutdown due to timeout.');
        process.exit(1);
    }, 10000);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);