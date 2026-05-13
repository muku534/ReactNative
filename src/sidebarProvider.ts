import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getAllDevices, Device, bootIOSSimulator, launchAndroidEmulator } from './deviceManager';
import { waitThenArrange } from './windowManager';

export class SidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _devices: Device[] = [];

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtml();

    // Handle messages from WebView
    webviewView.webview.onDidReceiveMessage(async (msg) => {
      const projectPath =
        vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || '';

      switch (msg.type) {
        case 'refresh':
          await this.refresh();
          break;

        case 'run': {
          const device = this._devices.find(d => d.id === msg.deviceId);
          if (!device) { return; }

          // ── Auto-boot if device is offline ──────────────
          if (device.status === 'offline') {
            if (device.platform === 'ios') {
              // Boot iOS Simulator first
              await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Booting ${device.name}...`,
                cancellable: false
              }, async () => {
                const success = await bootIOSSimulator(device.id);
                if (!success) {
                  vscode.window.showErrorMessage(`Failed to boot ${device.name}. Check Xcode installation.`);
                  return;
                }
                // Wait for simulator to fully boot
                await new Promise(r => setTimeout(r, 4000));
              });
            } else if (device.avdName) {
              // Launch Android Emulator
              await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Launching ${device.name}...`,
                cancellable: false
              }, async () => {
                await launchAndroidEmulator(device.avdName!);
                // Wait for emulator to start
                await new Promise(r => setTimeout(r, 8000));
              });
            }
            // Refresh device list after boot
            await this.refresh();
          }

          // ── Now run the app ────────────────────────────
          if (!projectPath) {
            vscode.window.showWarningMessage('Open a React Native project folder first.');
            return;
          }

          const terminal = vscode.window.createTerminal({
            name: `RN → ${device.name}`,
            cwd: projectPath
          });
          terminal.show();

          if (device.platform === 'ios') {
            // Use the actual UDID (not the avd: prefix)
            terminal.sendText(
              `npx react-native run-ios --udid ${device.id}`
            );
          } else {
            // For AVD devices, don't pass deviceId — let RN CLI pick the running emulator
            if (device.avdName) {
              terminal.sendText(`npx react-native run-android`);
            } else {
              terminal.sendText(
                `npx react-native run-android --deviceId ${device.id}`
              );
            }
          }

          waitThenArrange(device.platform);
          break;
        }

        case 'boot': {
          // Standalone boot — just start the device without running app
          const bootDevice = this._devices.find(d => d.id === msg.deviceId);
          if (!bootDevice) { return; }

          if (bootDevice.platform === 'ios') {
            await vscode.window.withProgress({
              location: vscode.ProgressLocation.Notification,
              title: `Booting ${bootDevice.name}...`,
              cancellable: false
            }, async () => {
              const success = await bootIOSSimulator(bootDevice.id);
              if (success) {
                vscode.window.showInformationMessage(`📱 ${bootDevice.name} is now running!`);
              } else {
                vscode.window.showErrorMessage(`Failed to boot ${bootDevice.name}.`);
              }
              await new Promise(r => setTimeout(r, 3000));
            });
          } else if (bootDevice.avdName) {
            await vscode.window.withProgress({
              location: vscode.ProgressLocation.Notification,
              title: `Launching ${bootDevice.name}...`,
              cancellable: false
            }, async () => {
              await launchAndroidEmulator(bootDevice.avdName!);
              vscode.window.showInformationMessage(`🤖 ${bootDevice.name} is launching!`);
              await new Promise(r => setTimeout(r, 5000));
            });
          }
          await this.refresh();
          break;
        }

        case 'metro': {
          const existing = vscode.window.terminals.find(
            t => t.name === 'Metro Bundler'
          );
          if (existing) {
            existing.dispose();
            // Update webview that metro stopped
            this._view?.webview.postMessage({ type: 'metroStatus', running: false });
            break;
          }
          const metro = vscode.window.createTerminal({
            name: 'Metro Bundler',
            cwd: projectPath
          });
          metro.show();
          metro.sendText('npx react-native start');
          this._view?.webview.postMessage({ type: 'metroStatus', running: true });
          break;
        }
      }
    });

    // Auto-refresh on panel open
    this.refresh();
  }

  async refresh() {
    this._devices = await getAllDevices();
    this._view?.webview.postMessage({
      type: 'devices',
      data: this._devices
    });
  }

  private _getHtml(): string {
    const htmlPath = path.join(
      this._extensionUri.fsPath,
      'webview',
      'sidebar.html'
    );
    if (fs.existsSync(htmlPath)) {
      return fs.readFileSync(htmlPath, 'utf8');
    }
    return this._loadingHtml();
  }

  private _loadingHtml(): string {
    return `<!DOCTYPE html>
<html>
<body style="padding:12px;font-family:var(--vscode-font-family);color:var(--vscode-foreground);">
  <p>Loading devices...</p>
</body>
</html>`;
  }
}
