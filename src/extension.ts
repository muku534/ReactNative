import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';

export function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('reactnative.newProject', async () => {
        // 1. Template selection
        const templates = [
            { label: 'New Application', description: 'Full React Native app with standard template' },
            { label: 'Bare Application', description: 'Minimal setup (skip-install)' },
            { label: 'With Navigation', description: 'React Navigation pre-configured' },
            { label: 'New Library', description: 'Create a React Native library for npm' }
        ];

        const selectedTemplate = await vscode.window.showQuickPick(templates, {
            placeHolder: 'Select a template for your new project'
        });

        if (!selectedTemplate) {
            return;
        }

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
                if (!value || value.includes(' ') || !/^[a-zA-Z0-9]+$/.test(value)) {
                    return 'Project name must be alphanumeric and contain no spaces';
                }
                return null;
            }
        });

        if (!projectName) {
            return;
        }

        // 4. CocoaPods prompt (macOS only)
        let installPods = false;
        if (os.platform() === 'darwin' && selectedTemplate.label !== 'New Library') {
            const podChoice = await vscode.window.showQuickPick(['Yes', 'No'], {
                placeHolder: 'Do you want to install CocoaPods now? (Recommended for iOS)'
            });
            installPods = podChoice === 'Yes';
        }

        // 5. Assemble command
        let command = '';
        if (selectedTemplate.label === 'New Library') {
            command = `npx -y create-react-native-library ${projectName} --yes`;
        } else {
            command = `npx -y @react-native-community/cli init ${projectName}`; 
            if (selectedTemplate.label === 'Bare Application') {
                command += ' --skip-install';
            }
            if (installPods) {
                command += ' --install-pods true';
            } else {
                command += ' --install-pods false';
            }
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
}

export function deactivate() {}
