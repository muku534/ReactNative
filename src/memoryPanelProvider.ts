import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { MemoryServer, MemorySnapshot } from './memoryServer';

export class MemoryPanelManager {
    public static readonly viewType = 'rnMemoryMonitor';
    private static currentPanel: MemoryPanelManager | undefined;

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private memoryServer: MemoryServer | null = null;
    private snapshots: MemorySnapshot[] = [];

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (MemoryPanelManager.currentPanel) {
            MemoryPanelManager.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            MemoryPanelManager.viewType,
            'Memory Monitor',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri],
                retainContextWhenHidden: true
            }
        );

        MemoryPanelManager.currentPanel = new MemoryPanelManager(panel, extensionUri);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.type) {
                    case 'clearSnapshots':
                        this.snapshots = [];
                        break;
                    case 'requestGC':
                        if (this.memoryServer) {
                            this.memoryServer.broadcast({ type: 'forceGC' });
                        }
                        break;
                }
            },
            null,
            this._disposables
        );

        this.startServer();
    }

    private async startServer() {
        const port = vscode.workspace.getConfiguration().get<number>('reactnative.memoryMonitorPort') || 8348;
        this.memoryServer = new MemoryServer(port);

        this.memoryServer.on('listening', (p) => {
            this._panel.webview.postMessage({ type: 'serverStatus', status: 'listening', port: p });
        });

        this.memoryServer.on('clientConnected', (count) => {
            this._panel.webview.postMessage({ type: 'clientStatus', count });
        });

        this.memoryServer.on('clientDisconnected', (count) => {
            this._panel.webview.postMessage({ type: 'clientStatus', count });
        });

        this.memoryServer.on('snapshot', (snapshot: MemorySnapshot) => {
            this.snapshots.push(snapshot);
            // Keep last 150 snapshots (5 min at 2s interval)
            if (this.snapshots.length > 150) {
                this.snapshots.shift();
            }
            this._panel.webview.postMessage({ type: 'memorySnapshot', data: snapshot });
        });

        try {
            await this.memoryServer.start();
        } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to start Memory Monitor server: ${e.message}`);
        }
    }

    public dispose() {
        MemoryPanelManager.currentPanel = undefined;

        this._panel.dispose();

        if (this.memoryServer) {
            this.memoryServer.stop();
        }

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _update() {
        const webview = this._panel.webview;
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(_webview: vscode.Webview) {
        const htmlPath = path.join(this._extensionUri.fsPath, 'webview', 'memory.html');
        if (fs.existsSync(htmlPath)) {
            return fs.readFileSync(htmlPath, 'utf8');
        }
        return `<!DOCTYPE html><html><body><h1>Error loading memory.html</h1></body></html>`;
    }
}
