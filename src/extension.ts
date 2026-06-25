import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { SidebarProvider } from './sidebarProvider';
import { NetworkPanelManager } from './networkPanelProvider';
import { MemoryPanelManager } from './memoryPanelProvider';

export function activate(context: vscode.ExtensionContext) {

    // ── EXISTING: New Project Command ─────────────────────────
    let disposable = vscode.commands.registerCommand('reactnative.newProject', async () => {
        // 1. Project Type selection (Quick Pick UI)
        const selectedTemplate = await vscode.window.showQuickPick(
            ['React Native CLI (Bare)', 'Expo (Managed Workflow)'],
            { placeHolder: 'Select a project type to create' }
        );

        if (!selectedTemplate) {
            return;
        }

        const isExpo = selectedTemplate.includes('Expo');

        // 2. Folder selection
        const folderUri = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select folder to create project in'
        });

        if (!folderUri || folderUri.length === 0) {
            return;
        }

        const projectDir = folderUri[0].fsPath;

        // 3. Project name input
        const projectName = await vscode.window.showInputBox({
            prompt: 'Enter project name',
            placeHolder: 'e.g. MyApp',
            validateInput: (value) => {
                if (!value || value.includes(' ') || !/^[a-zA-Z0-9_-]+$/.test(value)) {
                    return 'Project name must contain only alphanumeric characters, hyphens, or underscores';
                }
                return null;
            }
        });

        if (!projectName) {
            return;
        }

        let command = '';

        if (isExpo) {
            // Expo project command
            command = `npx create-expo-app ${projectName}`;
        } else {
            // React Native CLI command
            // 4. CocoaPods prompt (macOS only, for CLI only)
            let installPods = false;
            if (os.platform() === 'darwin') {
                const podChoice = await vscode.window.showQuickPick(['Yes', 'No'], {
                    placeHolder: 'Do you want to install CocoaPods now? (Recommended for iOS)'
                });
                installPods = podChoice === 'Yes';
            }
            command = `npx -y @react-native-community/cli init ${projectName} --install-pods ${installPods}`;
        }

        // 6. Run command with Progress API (Bypass terminal)
        const outputChannel = vscode.window.createOutputChannel("ReactNative Creator");

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `ReactNative: Creating project "${projectName}"...`,
            cancellable: false
        }, async (_progress) => {
            return new Promise((resolve, reject) => {
                outputChannel.appendLine(`Running: ${command}`);
                outputChannel.appendLine(`In: ${projectDir}`);

                const process = exec(command, { cwd: projectDir });

                process.stdout?.on('data', (data) => {
                    outputChannel.append(data.toString());
                });

                process.stderr?.on('data', (data) => {
                    outputChannel.append(data.toString());
                });

                process.on('exit', (code) => {
                    if (code === 0) {
                        vscode.window.showInformationMessage(
                            `Project "${projectName}" created successfully!`,
                            'Open Project'
                        ).then(selection => {
                            if (selection === 'Open Project') {
                                const targetPath = path.join(projectDir, projectName);
                                vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(targetPath), true);
                            }
                        });
                        resolve(null);
                    } else {
                        outputChannel.show(true); // Show logs if it fails
                        vscode.window.showErrorMessage(`Failed to create project. Check "ReactNative Creator" in Output panel for details.`);
                        reject(new Error(`Exit code ${code}`));
                    }
                });
            });
        });
    });

    context.subscriptions.push(disposable);

    // ── NEW: Sidebar Device Manager ───────────────────────────
    const sidebarProvider = new SidebarProvider(context.extensionUri);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'rnDeviceView',
            sidebarProvider
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('reactnative.refreshDevices', () => {
            sidebarProvider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('reactnative.openNetworkMonitor', () => {
            NetworkPanelManager.createOrShow(context.extensionUri);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('reactnative.openMemoryMonitor', () => {
            MemoryPanelManager.createOrShow(context.extensionUri);
        })
    );
}

export function deactivate() { }
