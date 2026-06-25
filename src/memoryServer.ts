import { EventEmitter } from 'events';
import WebSocket from 'ws';

export interface MemorySnapshot {
    type: 'memory';
    timestamp: number;
    heapUsed: number;
    heapTotal: number;
    gcCount: number;
    gcTime: number;
    mallocSize: number;
    objectCount: number;
}

export class MemoryServer extends EventEmitter {
    private wss: WebSocket.Server | null = null;
    private port: number;
    private clients: Set<WebSocket> = new Set();

    constructor(port: number = 8348) {
        super();
        this.port = port;
    }

    public getPort(): number {
        return this.port;
    }

    public start(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.wss) {
                resolve();
                return;
            }

            const tryPort = (portToTry: number) => {
                const server = new WebSocket.Server({ port: portToTry });

                server.on('listening', () => {
                    this.wss = server;
                    this.port = portToTry;
                    this.emit('listening', this.port);
                    resolve();
                });

                server.on('error', (err: any) => {
                    if (err.code === 'EADDRINUSE') {
                        if (portToTry < 8449) {
                            tryPort(portToTry + 1);
                        } else {
                            reject(new Error("No available ports found for Memory Monitor."));
                        }
                    } else {
                        this.emit('error', err);
                        reject(err);
                    }
                });

                server.on('connection', (ws) => {
                    this.clients.add(ws);
                    this.emit('clientConnected', this.clients.size);

                    ws.on('message', (message) => {
                        try {
                            const dataStr = message.toString();
                            const data = JSON.parse(dataStr);
                            this.emit('snapshot', data);
                        } catch (e) {
                            console.error('Failed to parse incoming memory snapshot:', e);
                        }
                    });

                    ws.on('close', () => {
                        this.clients.delete(ws);
                        this.emit('clientDisconnected', this.clients.size);
                    });
                });
            };

            tryPort(this.port);
        });
    }

    public broadcast(message: object) {
        const data = JSON.stringify(message);
        for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(data);
            }
        }
    }

    public stop() {
        if (this.wss) {
            this.wss.close();
            this.wss = null;
        }
        for (const client of this.clients) {
            client.terminate();
        }
        this.clients.clear();
        this.emit('stopped');
    }
}
