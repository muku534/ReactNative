import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { NetworkServer, NetworkLogData } from './networkServer';

export class NetworkPanelManager {
    public static readonly viewType = 'rnNetworkMonitor';
    private static currentPanel: NetworkPanelManager | undefined;

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private networkServer: NetworkServer | null = null;
    private logs: NetworkLogData[] = [];

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (NetworkPanelManager.currentPanel) {
            NetworkPanelManager.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            NetworkPanelManager.viewType,
            'Network Monitor',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri],
                retainContextWhenHidden: true
            }
        );

        NetworkPanelManager.currentPanel = new NetworkPanelManager(panel, extensionUri);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.type) {
                    case 'clearLogs':
                        this.logs = [];
                        break;
                }
            },
            null,
            this._disposables
        );

        this.startServer();
    }

    private async startServer() {
        const port = vscode.workspace.getConfiguration().get<number>('reactnative.networkMonitorPort') || 8347;
        this.networkServer = new NetworkServer(port);

        this.networkServer.on('listening', (p) => {
            this._panel.webview.postMessage({ type: 'serverStatus', status: 'listening', port: p });
        });

        this.networkServer.on('clientConnected', (count) => {
            this._panel.webview.postMessage({ type: 'clientStatus', count });
        });

        this.networkServer.on('clientDisconnected', (count) => {
            this._panel.webview.postMessage({ type: 'clientStatus', count });
        });

        this.networkServer.on('log', (log: NetworkLogData) => {
            const existingIndex = this.logs.findIndex(l => l.id === log.id);
            if (existingIndex >= 0) {
                // Update existing
                this.logs[existingIndex] = { ...this.logs[existingIndex], ...log };
                this._panel.webview.postMessage({ type: 'updateLog', data: this.logs[existingIndex] });
            } else {
                // New log
                this.logs.push(log);
                this._panel.webview.postMessage({ type: 'newLog', data: log });
            }
        });

        try {
            await this.networkServer.start();
        } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to start Network Monitor server: ${e.message}`);
        }
    }

    public dispose() {
        NetworkPanelManager.currentPanel = undefined;

        this._panel.dispose();

        if (this.networkServer) {
            this.networkServer.stop();
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
        const htmlPath = path.join(this._extensionUri.fsPath, 'webview', 'network.html');
        if (fs.existsSync(htmlPath)) {
             return fs.readFileSync(htmlPath, 'utf8');
        }
        return `<!DOCTYPE html><html><body><h1>Error loading network.html</h1></body></html>`;
    }
}
