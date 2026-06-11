import { EventEmitter } from 'events';
import WebSocket from 'ws';

export interface NetworkLogData {
    id: string;
    request: {
        method: string;
        url: string;
        headers: Record<string, string>;
        postData?: string;
        startTime: number;
    };
    response?: {
        status: number;
        headers: Record<string, string>;
        endTime: number;
        duration: number;
    };
    responseBody?: string;
    base64Encoded?: boolean;
    status: 'pending' | 'success' | 'error';
}

export class NetworkServer extends EventEmitter {
    private wss: WebSocket.Server | null = null;
    private port: number;
    private clients: Set<WebSocket> = new Set();

    constructor(port: number = 8347) {
        super();
        this.port = port;
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
                        if (portToTry < 8399) {
                            tryPort(portToTry + 1);
                        } else {
                            reject(new Error("No available ports found for Network Monitor."));
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
                            this.emit('log', data);
                        } catch (e) {
                            console.error('Failed to parse incoming network log:', e);
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
