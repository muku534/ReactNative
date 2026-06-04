import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  getAllDevices,
  Device,
  bootIOSSimulator,
  launchAndroidEmulator,
  pairAndroidWiFi,
  connectAndroidWiFi,
  switchToWiFiMode,
  disconnectAndroidWiFi,
  checkScrcpyInstalled
} from './deviceManager';
import { waitThenArrange } from './windowManager';
import { isExpoProject } from './utils';

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

          // ── iOS Signing Pre-check for Physical Devices ──
          if (device.isPhysical && device.platform === 'ios') {
            const proceed = await vscode.window.showWarningMessage(
              '⚠️ Running on a physical iPhone requires an Apple Developer certificate. Make sure signing is configured in Xcode before proceeding.',
              'Continue',
              'Cancel'
            );
            if (proceed !== 'Continue') { return; }
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

          const config = vscode.workspace.getConfiguration('reactnative');
          const customIOSCommand = config.get<string>('customStartCommandIOS') || '';
          const customAndroidCommand = config.get<string>('customStartCommandAndroid') || '';
          const customCommand = device.platform === 'ios' ? customIOSCommand : customAndroidCommand;

          if (customCommand) {
            const formattedCommand = customCommand
              .replace(/\${deviceId}/g, device.id)
              .replace(/\${deviceName}/g, device.name);
            vscode.window.showInformationMessage(`🚀 Running custom command for ${device.name}...`);
            terminal.sendText(formattedCommand);
          } else {
            const isExpo = isExpoProject(projectPath);
            vscode.window.showInformationMessage(
              isExpo ? '📦 Detected Expo project.' : '⚛️ Detected React Native CLI project.'
            );

            if (device.platform === 'ios') {
              if (isExpo) {
                terminal.sendText(`npx expo start --ios`);
              } else if (device.isPhysical) {
                // Physical iOS device — use --device flag with device name
                terminal.sendText(
                  `npx react-native run-ios --device "${device.name}"`
                );
              } else {
                // Simulator — use --udid
                terminal.sendText(
                  `npx react-native run-ios --udid ${device.id}`
                );
              }
            } else {
              if (isExpo) {
                terminal.sendText(`npx expo start --android`);
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
          const isExpo = isExpoProject(projectPath);
          if (isExpo) {
            metro.sendText('npx expo start');
          } else {
            metro.sendText('npx react-native start');
          }
          this._view?.webview.postMessage({ type: 'metroStatus', running: true });
          break;
        }

        // ── WiFi Device Connection ──────────────────────
        case 'connectWifi': {
          const method = await vscode.window.showQuickPick(
            [
              {
                label: '$(radio-tower) Android 11+ (Wireless Debugging)',
                description: 'Pair using IP, Port & Pairing Code',
                value: 'pair'
              },
              {
                label: '$(plug) Older Android (USB → WiFi)',
                description: 'Switch a USB-connected device to WiFi mode',
                value: 'tcpip'
              },
              {
                label: '$(info) iOS WiFi Setup Guide',
                description: 'Learn how to connect iPhone wirelessly',
                value: 'ios-guide'
              }
            ],
            { placeHolder: 'Select connection method' }
          );

          if (!method) { break; }

          if (method.value === 'pair') {
            // ── Android 11+ Wireless Debugging Pairing ──
            const ipPort = await vscode.window.showInputBox({
              prompt: 'Step 1/3: Enter the IP:Port from your phone\'s Wireless Debugging screen',
              placeHolder: 'e.g. 192.168.1.100:37123',
              validateInput: (v) => {
                if (!v || !v.includes(':')) { return 'Format: IP:Port (e.g. 192.168.1.100:37123)'; }
                return null;
              }
            });
            if (!ipPort) { break; }

            const pairingCode = await vscode.window.showInputBox({
              prompt: 'Step 2/3: Enter the Pairing Code shown on your phone',
              placeHolder: 'e.g. 123456',
              validateInput: (v) => {
                if (!v || v.length < 4) { return 'Enter the pairing code from your phone'; }
                return null;
              }
            });
            if (!pairingCode) { break; }

            const [pairIp, pairPort] = ipPort.split(':');

            await vscode.window.withProgress({
              location: vscode.ProgressLocation.Notification,
              title: 'Pairing with device...',
              cancellable: false
            }, async () => {
              const pairResult = await pairAndroidWiFi(pairIp, pairPort, pairingCode);
              if (!pairResult.success) {
                vscode.window.showErrorMessage(`❌ Pairing failed: ${pairResult.message}`);
                return;
              }
              vscode.window.showInformationMessage('✅ Paired successfully!');
            });

            // Step 3: Connect
            const connectPort = await vscode.window.showInputBox({
              prompt: 'Step 3/3: Enter the IP:Port from Wireless Debugging (NOT the pairing port)',
              placeHolder: 'e.g. 192.168.1.100:43567',
              value: `${pairIp}:`,
              validateInput: (v) => {
                if (!v || !v.includes(':')) { return 'Format: IP:Port'; }
                return null;
              }
            });
            if (!connectPort) { break; }

            const [connIp, connPort] = connectPort.split(':');
            await vscode.window.withProgress({
              location: vscode.ProgressLocation.Notification,
              title: 'Connecting to device...',
              cancellable: false
            }, async () => {
              const connResult = await connectAndroidWiFi(connIp, connPort);
              if (connResult.success) {
                vscode.window.showInformationMessage(`📡 Connected wirelessly to ${connIp}:${connPort}!`);
              } else {
                vscode.window.showErrorMessage(`❌ Connection failed: ${connResult.message}`);
              }
            });

            await this.refresh();

          } else if (method.value === 'tcpip') {
            // ── Older Android: USB → WiFi ──
            vscode.window.showInformationMessage(
              '🔌 Make sure your Android device is connected via USB first.'
            );

            const deviceIp = await vscode.window.showInputBox({
              prompt: 'Enter your device\'s WiFi IP address (Settings → About Phone → IP Address)',
              placeHolder: 'e.g. 192.168.1.100',
              validateInput: (v) => {
                if (!v || !v.match(/^\d+\.\d+\.\d+\.\d+$/)) { return 'Enter a valid IP address'; }
                return null;
              }
            });
            if (!deviceIp) { break; }

            await vscode.window.withProgress({
              location: vscode.ProgressLocation.Notification,
              title: 'Switching device to WiFi mode...',
              cancellable: false
            }, async () => {
              const switchResult = await switchToWiFiMode();
              if (!switchResult.success) {
                vscode.window.showErrorMessage(`❌ Failed: ${switchResult.message}`);
                return;
              }
              // Wait a moment for the mode switch
              await new Promise(r => setTimeout(r, 2000));

              const connResult = await connectAndroidWiFi(deviceIp, '5555');
              if (connResult.success) {
                vscode.window.showInformationMessage(
                  `📡 Connected wirelessly! You can now unplug the USB cable.`
                );
              } else {
                vscode.window.showErrorMessage(`❌ Connection failed: ${connResult.message}`);
              }
            });

            await this.refresh();

          } else if (method.value === 'ios-guide') {
            // ── iOS WiFi Setup Guide ──
            const action = await vscode.window.showInformationMessage(
              '📱 To connect your iPhone wirelessly:\n\n' +
              '1. Connect iPhone via USB (one-time)\n' +
              '2. Open Xcode → Window → Devices and Simulators\n' +
              '3. Select your device and check "Connect via network"\n' +
              '4. After setup, your iPhone will appear automatically!',
              'Open Xcode'
            );
            if (action === 'Open Xcode') {
              const term = vscode.window.createTerminal({ name: 'Xcode', hideFromUser: true });
              term.sendText('open -a Xcode');
              term.dispose();
            }
          }
          break;
        }

        // ── Disconnect WiFi Device ──────────────────────
        case 'disconnectWifi': {
          const device = this._devices.find(d => d.id === msg.deviceId);
          if (!device) { return; }
          await disconnectAndroidWiFi(device.id);
          vscode.window.showInformationMessage(`📡 Disconnected ${device.name}`);
          await this.refresh();
          break;
        }

        // ── Screen Mirroring ────────────────────────────
        case 'mirror': {
          const device = this._devices.find(d => d.id === msg.deviceId);
          if (!device) { return; }

          if (device.platform === 'android') {
            // Check if scrcpy is installed
            const isInstalled = await checkScrcpyInstalled();
            if (!isInstalled) {
              const platform = os.platform();
              let installCmd = '';
              if (platform === 'darwin') {
                installCmd = 'brew install scrcpy';
              } else if (platform === 'win32') {
                installCmd = 'Download from: https://github.com/Genymobile/scrcpy/releases';
              } else {
                installCmd = 'sudo apt install scrcpy';
              }

              const action = await vscode.window.showWarningMessage(
                `🪞 scrcpy is required for screen mirroring but is not installed.\n\nInstall command: ${installCmd}`,
                'Copy Install Command',
                'Cancel'
              );

              if (action === 'Copy Install Command') {
                await vscode.env.clipboard.writeText(installCmd);
                vscode.window.showInformationMessage('📋 Install command copied to clipboard!');
              }
              return;
            }

            // Launch scrcpy
            const mirrorTerminal = vscode.window.createTerminal({
              name: `Mirror → ${device.name}`
            });
            mirrorTerminal.show();
            mirrorTerminal.sendText(`scrcpy -s ${device.id}`);
            vscode.window.showInformationMessage(`🪞 Mirroring ${device.name}...`);

          } else if (device.platform === 'ios') {
            if (os.platform() === 'darwin') {
              // Open QuickTime for iOS mirroring
              const term = vscode.window.createTerminal({ name: 'QuickTime', hideFromUser: true });
              term.sendText('open -a "QuickTime Player"');
              setTimeout(() => term.dispose(), 2000);
              vscode.window.showInformationMessage(
                '🪞 QuickTime Player opened. Select your iPhone as the video source: File → New Movie Recording → Click ▼ next to record button → Select your device.'
              );
            } else {
              vscode.window.showInformationMessage(
                '🪞 iOS screen mirroring is only available on macOS via QuickTime Player.'
              );
            }
          }
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
