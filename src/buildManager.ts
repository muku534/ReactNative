import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn, exec } from 'child_process';
import { isExpoProject } from './utils';
import { getAndroidDevices, Device } from './deviceManager';

export type BuildTarget =
  | 'android-debug-apk'
  | 'android-release-apk'
  | 'android-release-aab'
  | 'ios-simulator-app'
  | 'ios-release-archive';

export interface BuildTargetInfo {
  id: BuildTarget;
  title: string;
  description: string;
  platform: 'android' | 'ios';
  badge: string;
}

export interface LastArtifactInfo {
  name: string;
  path: string;
  size: string;
  target: BuildTarget;
  timestamp: number;
}

export interface BuildStatusEvent {
  building: boolean;
  target?: BuildTarget;
  targetTitle?: string;
  duration?: string;
  success?: boolean;
  lastArtifact?: LastArtifactInfo | null;
}

type BuildStatusListener = (event: BuildStatusEvent) => void;

export const BUILD_TARGETS: BuildTargetInfo[] = [
  {
    id: 'android-debug-apk',
    title: 'Android Debug APK',
    description: 'Assemble debug APK for fast local testing',
    platform: 'android',
    badge: 'APK'
  },
  {
    id: 'android-release-apk',
    title: 'Android Release APK',
    description: 'Assemble standalone release APK',
    platform: 'android',
    badge: 'APK'
  },
  {
    id: 'android-release-aab',
    title: 'Android Release Bundle (AAB)',
    description: 'Build Google Play Store upload package (.aab)',
    platform: 'android',
    badge: 'AAB'
  },
  {
    id: 'ios-simulator-app',
    title: 'iOS Simulator Build (.app)',
    description: 'Compile Debug .app for iOS Simulators (no cert needed)',
    platform: 'ios',
    badge: 'APP'
  },
  {
    id: 'ios-release-archive',
    title: 'iOS Release Archive (.xcarchive)',
    description: 'Create production archive for App Store / TestFlight',
    platform: 'ios',
    badge: 'IPA'
  }
];

export class BuildManager {
  private static _outputChannel: vscode.OutputChannel | undefined;
  private static _isBuilding = false;
  private static _currentProcess: any = null;
  private static _lastArtifact: LastArtifactInfo | null = null;
  private static _statusListeners: BuildStatusListener[] = [];

  public static get outputChannel(): vscode.OutputChannel {
    if (!this._outputChannel) {
      this._outputChannel = vscode.window.createOutputChannel('React Native Build');
    }
    return this._outputChannel;
  }

  public static isBuilding(): boolean {
    return this._isBuilding;
  }

  public static getLastArtifact(): LastArtifactInfo | null {
    return this._lastArtifact;
  }

  public static onStatusChange(listener: BuildStatusListener): vscode.Disposable {
    this._statusListeners.push(listener);
    return {
      dispose: () => {
        this._statusListeners = this._statusListeners.filter(l => l !== listener);
      }
    };
  }

  private static _notifyStatusChange(event: BuildStatusEvent): void {
    for (const listener of this._statusListeners) {
      try {
        listener(event);
      } catch {}
    }
  }

  public static cancelCurrentBuild(): boolean {
    if (this._currentProcess) {
      try {
        this._currentProcess.kill('SIGINT');
        this._isBuilding = false;
        this._currentProcess = null;
        this._notifyStatusChange({ building: false });
        return true;
      } catch {}
    }
    return false;
  }

  public static async installApk(apkPath: string): Promise<void> {
    await this._installApkToDevice(apkPath);
  }

  /**
   * Prompts user with QuickPick of build targets, or runs a specific target if passed.
   */
  public static async promptAndBuild(target?: BuildTarget): Promise<void> {
    const projectPath = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
    if (!projectPath) {
      vscode.window.showWarningMessage('Please open a React Native project folder first.');
      return;
    }

    if (this._isBuilding) {
      vscode.window.showWarningMessage(
        'A build is already running. Please wait or cancel the current build before starting a new one.'
      );
      return;
    }

    let selectedTarget = target;
    if (!selectedTarget) {
      const isMac = os.platform() === 'darwin';
      const items = BUILD_TARGETS.map(t => ({
        label: `${t.platform === 'android' ? '🤖' : '🍎'} ${t.title}`,
        description: t.description,
        target: t.id,
        detail: t.platform === 'ios' && !isMac ? '⚠️ Requires macOS with Xcode' : undefined
      }));

      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select the build artifact you want to generate',
        matchOnDescription: true
      });

      if (!pick) {
        return;
      }
      selectedTarget = pick.target;
    }

    await this.startBuild(projectPath, selectedTarget);
  }

  /**
   * Main build execution method
   */
  public static async startBuild(projectPath: string, target: BuildTarget): Promise<void> {
    if (this._isBuilding) {
      vscode.window.showWarningMessage('A build is already in progress.');
      return;
    }

    const targetInfo = BUILD_TARGETS.find(t => t.id === target) || {
      id: target,
      title: target,
      description: '',
      platform: target.startsWith('ios') ? 'ios' : 'android',
      badge: ''
    };

    // Platform validation for iOS
    if (targetInfo.platform === 'ios' && os.platform() !== 'darwin') {
      const choice = await vscode.window.showWarningMessage(
        '🍎 iOS native builds require macOS with Xcode installed.\n\nOn Windows or Linux, you can build iOS apps using Expo EAS Build (Cloud).',
        'Learn About EAS Build',
        'Close'
      );
      if (choice === 'Learn About EAS Build') {
        vscode.env.openExternal(vscode.Uri.parse('https://docs.expo.dev/build/introduction/'));
      }
      return;
    }

    // Expo native folder validation
    const isExpo = isExpoProject(projectPath);
    const nativeFolderName = targetInfo.platform;
    const nativeFolderPath = path.join(projectPath, nativeFolderName);

    if (!fs.existsSync(nativeFolderPath)) {
      if (isExpo) {
        const proceed = await vscode.window.showInformationMessage(
          `📦 This Expo project does not have a native "${nativeFolderName}" folder yet.\n\nWould you like to run "npx expo prebuild --platform ${nativeFolderName}" to generate it?`,
          'Generate & Continue',
          'Cancel'
        );
        if (proceed !== 'Generate & Continue') {
          return;
        }

        const prebuildSuccess = await this._runPrebuild(projectPath, nativeFolderName);
        if (!prebuildSuccess) {
          vscode.window.showErrorMessage(`Failed to generate native ${nativeFolderName} folder via Expo prebuild.`);
          return;
        }
      } else {
        vscode.window.showErrorMessage(
          `Cannot find "${nativeFolderName}" directory in workspace. Make sure your React Native project is opened properly.`
        );
        return;
      }
    }

    // Android: Ensure local.properties with sdk.dir is configured
    if (targetInfo.platform === 'android') {
      this._ensureAndroidLocalProperties(path.join(projectPath, 'android'));
    }

    // Prepare Build Command
    const buildDetails = this._getBuildCommandDetails(projectPath, target);
    if (!buildDetails) {
      vscode.window.showErrorMessage(`Unsupported build target: ${target}`);
      return;
    }

    this._isBuilding = true;
    this._notifyStatusChange({
      building: true,
      target,
      targetTitle: targetInfo.title
    });

    const channel = this.outputChannel;
    channel.clear();
    channel.show(true);

    const startTime = Date.now();
    channel.appendLine(`================================================================`);
    channel.appendLine(`🚀 Starting ${targetInfo.title}`);
    channel.appendLine(`📁 Working Directory: ${buildDetails.cwd}`);
    channel.appendLine(`⚡ Command: ${buildDetails.command} ${buildDetails.args.join(' ')}`);
    channel.appendLine(`🕒 Time: ${new Date().toLocaleTimeString()}`);
    channel.appendLine(`================================================================\n`);

    let errorBuffer = '';
    let fullOutput = '';

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Building ${targetInfo.title}...`,
        cancellable: true
      },
      (progress, token) => {
        return new Promise<void>((resolve) => {
          let timerSeconds = 0;
          const timer = setInterval(() => {
            timerSeconds++;
            const mins = Math.floor(timerSeconds / 60);
            const secs = timerSeconds % 60;
            const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
            progress.report({ message: `In progress (${timeStr}). Check "React Native Build" output.` });
          }, 1000);

          token.onCancellationRequested(() => {
            if (this._currentProcess) {
              try {
                this._currentProcess.kill('SIGINT');
              } catch {}
            }
            channel.appendLine(`\n⚠️ Build cancelled by user.`);
            vscode.window.showWarningMessage(`Build cancelled: ${targetInfo.title}`);
            clearInterval(timer);
            this._isBuilding = false;
            this._currentProcess = null;
            this._notifyStatusChange({ building: false, target, success: false });
            resolve();
          });

          // Ensure gradlew has executable permissions on unix
          if (targetInfo.platform === 'android' && os.platform() !== 'win32') {
            const gradlewPath = path.join(buildDetails.cwd, 'gradlew');
            if (fs.existsSync(gradlewPath)) {
              try {
                fs.chmodSync(gradlewPath, 0o755);
              } catch {}
            }
          }

          const child = spawn(buildDetails.command, buildDetails.args, {
            cwd: buildDetails.cwd,
            shell: true,
            env: {
              ...process.env,
              FORCE_COLOR: 'true'
            }
          });

          this._currentProcess = child;

          child.stdout?.on('data', (data) => {
            const text = data.toString();
            channel.append(text);
            fullOutput += text;
            if (fullOutput.length > 300000) {
              fullOutput = fullOutput.slice(-200000);
            }
          });

          child.stderr?.on('data', (data) => {
            const text = data.toString();
            channel.append(text);
            errorBuffer += text;
            fullOutput += text;
            if (errorBuffer.length > 50000) {
              errorBuffer = errorBuffer.slice(-30000);
            }
          });

          child.on('close', (code) => {
            clearInterval(timer);
            this._isBuilding = false;
            this._currentProcess = null;
            const durationMs = Date.now() - startTime;
            const durationFormatted = this._formatDuration(durationMs);

            channel.appendLine(`\n================================================================`);
            channel.appendLine(`🏁 Build process exited with code ${code} (${durationFormatted})`);
            channel.appendLine(`================================================================`);

            // 1. Immediately resolve to DISMISS the withProgress progress notification!
            resolve();

            // 2. Track last artifact
            if (code === 0) {
              const artifact = this._findArtifact(projectPath, target);
              if (artifact) {
                this._lastArtifact = {
                  name: artifact.name,
                  path: artifact.path,
                  size: artifact.size,
                  target: target,
                  timestamp: Date.now()
                };
              }
            }

            // 3. Notify sidebar of completion
            this._notifyStatusChange({
              building: false,
              target,
              targetTitle: targetInfo.title,
              duration: durationFormatted,
              success: code === 0,
              lastArtifact: this._lastArtifact
            });

            // 4. Show success / failure notification (completely independent from withProgress)
            if (code === 0) {
              this._handleBuildSuccess(projectPath, target, durationFormatted);
            } else {
              this._handleBuildFailure(targetInfo.title, fullOutput, errorBuffer, code || 1);
            }
          });

          child.on('error', (err) => {
            clearInterval(timer);
            this._isBuilding = false;
            this._currentProcess = null;
            channel.appendLine(`\n❌ Process execution error: ${err.message}`);
            resolve();
            this._notifyStatusChange({ building: false, target, success: false });
            this._handleBuildFailure(targetInfo.title, fullOutput, err.message, -1);
          });
        });
      }
    );
  }

  /**
   * Runs Expo prebuild when native folder is absent
   */
  private static async _runPrebuild(projectPath: string, platform: 'android' | 'ios'): Promise<boolean> {
    return new Promise((resolve) => {
      this.outputChannel.show(true);
      this.outputChannel.appendLine(`Running: npx expo prebuild --platform ${platform}`);
      const proc = exec(`npx expo prebuild --platform ${platform}`, { cwd: projectPath });
      proc.stdout?.on('data', d => this.outputChannel.append(d.toString()));
      proc.stderr?.on('data', d => this.outputChannel.append(d.toString()));
      proc.on('close', code => resolve(code === 0));
    });
  }

  /**
   * Resolves the exact command and arguments for the chosen target
   */
  private static _getBuildCommandDetails(
    projectPath: string,
    target: BuildTarget
  ): { command: string; args: string[]; cwd: string } | null {
    const isWindows = os.platform() === 'win32';
    const androidDir = path.join(projectPath, 'android');
    const gradlew = isWindows ? 'gradlew.bat' : './gradlew';

    switch (target) {
      case 'android-debug-apk':
        return {
          command: gradlew,
          args: ['assembleDebug', '--stacktrace'],
          cwd: androidDir
        };

      case 'android-release-apk':
        return {
          command: gradlew,
          args: ['assembleRelease', '--stacktrace'],
          cwd: androidDir
        };

      case 'android-release-aab':
        return {
          command: gradlew,
          args: ['bundleRelease', '--stacktrace'],
          cwd: androidDir
        };

      case 'ios-simulator-app': {
        const iosDir = path.join(projectPath, 'ios');
        const workspaceOrProj = this._findXcodeProject(iosDir);
        if (!workspaceOrProj) {
          return null;
        }
        const isWorkspace = workspaceOrProj.endsWith('.xcworkspace');
        const scheme = path.basename(workspaceOrProj, path.extname(workspaceOrProj));
        return {
          command: 'xcodebuild',
          args: [
            isWorkspace ? '-workspace' : '-project',
            workspaceOrProj,
            '-scheme',
            scheme,
            '-configuration',
            'Debug',
            '-sdk',
            'iphonesimulator',
            '-derivedDataPath',
            'build'
          ],
          cwd: iosDir
        };
      }

      case 'ios-release-archive': {
        const iosDir = path.join(projectPath, 'ios');
        const workspaceOrProj = this._findXcodeProject(iosDir);
        if (!workspaceOrProj) {
          return null;
        }
        const isWorkspace = workspaceOrProj.endsWith('.xcworkspace');
        const scheme = path.basename(workspaceOrProj, path.extname(workspaceOrProj));
        return {
          command: 'xcodebuild',
          args: [
            isWorkspace ? '-workspace' : '-project',
            workspaceOrProj,
            '-scheme',
            scheme,
            '-configuration',
            'Release',
            '-archivePath',
            `build/${scheme}.xcarchive`,
            'archive'
          ],
          cwd: iosDir
        };
      }

      default:
        return null;
    }
  }

  /**
   * Automatically configures android/local.properties if missing
   */
  private static _ensureAndroidLocalProperties(androidDir: string): void {
    try {
      const localPropertiesPath = path.join(androidDir, 'local.properties');
      if (fs.existsSync(localPropertiesPath)) {
        return;
      }

      // Check standard SDK locations
      let sdkPath = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '';
      if (!sdkPath || !fs.existsSync(sdkPath)) {
        const home = os.homedir();
        if (os.platform() === 'darwin') {
          sdkPath = path.join(home, 'Library', 'Android', 'sdk');
        } else if (os.platform() === 'win32') {
          sdkPath = path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Android', 'Sdk');
        } else {
          sdkPath = path.join(home, 'Android', 'Sdk');
        }
      }

      if (fs.existsSync(sdkPath)) {
        // Format path for local.properties (escape backslashes on Windows)
        const formattedSdkPath = sdkPath.replace(/\\/g, '\\\\');
        fs.writeFileSync(localPropertiesPath, `## Auto-generated by React Native Companion\nsdk.dir=${formattedSdkPath}\n`, 'utf8');
        this.outputChannel.appendLine(`ℹ️ Configured android/local.properties with SDK: ${sdkPath}`);
      }
    } catch (e) {
      // Ignore if cannot write
    }
  }

  /**
   * Finds the .xcworkspace or .xcodeproj inside the ios directory
   */
  private static _findXcodeProject(iosDir: string): string | null {
    if (!fs.existsSync(iosDir)) {
      return null;
    }
    const files = fs.readdirSync(iosDir);
    const workspace = files.find(f => f.endsWith('.xcworkspace'));
    if (workspace) {
      return workspace;
    }
    const project = files.find(f => f.endsWith('.xcodeproj'));
    if (project) {
      return project;
    }
    return null;
  }

  /**
   * Searches for the generated artifact after a successful build
   */
  private static _findArtifact(projectPath: string, target: BuildTarget): { path: string; name: string; size: string } | null {
    try {
      let searchDir = '';
      let extension = '';

      if (target === 'android-debug-apk') {
        searchDir = path.join(projectPath, 'android', 'app', 'build', 'outputs', 'apk', 'debug');
        extension = '.apk';
      } else if (target === 'android-release-apk') {
        searchDir = path.join(projectPath, 'android', 'app', 'build', 'outputs', 'apk', 'release');
        extension = '.apk';
      } else if (target === 'android-release-aab') {
        searchDir = path.join(projectPath, 'android', 'app', 'build', 'outputs', 'bundle', 'release');
        extension = '.aab';
      } else if (target === 'ios-simulator-app') {
        searchDir = path.join(projectPath, 'ios', 'build', 'Build', 'Products', 'Debug-iphonesimulator');
        extension = '.app';
      } else if (target === 'ios-release-archive') {
        searchDir = path.join(projectPath, 'ios', 'build');
        extension = '.xcarchive';
      }

      if (!fs.existsSync(searchDir)) {
        return null;
      }

      const files = fs.readdirSync(searchDir);
      const matches = files.filter(f => f.endsWith(extension));
      if (matches.length === 0) {
        return null;
      }

      // Sort by newest mtime
      matches.sort((a, b) => {
        const statA = fs.statSync(path.join(searchDir, a));
        const statB = fs.statSync(path.join(searchDir, b));
        return statB.mtimeMs - statA.mtimeMs;
      });

      const artifactName = matches[0];
      const artifactPath = path.join(searchDir, artifactName);
      const stats = fs.statSync(artifactPath);
      const sizeMb = (stats.size / (1024 * 1024)).toFixed(1);
      const sizeStr = stats.size > 1024 * 1024 ? `${sizeMb} MB` : `${Math.round(stats.size / 1024)} KB`;

      return {
        path: artifactPath,
        name: artifactName,
        size: sizeStr
      };
    } catch {
      return null;
    }
  }

  /**
   * Handles post-build success notification, open folder, and install actions
   */
  private static async _handleBuildSuccess(
    projectPath: string,
    target: BuildTarget,
    duration: string
  ): Promise<void> {
    const artifact = this._findArtifact(projectPath, target);
    const targetInfo = BUILD_TARGETS.find(t => t.id === target);
    const title = targetInfo?.title || 'Build';

    if (!artifact) {
      vscode.window.showInformationMessage(
        `🎉 ${title} completed successfully in ${duration}! Check the build outputs directory.`,
        'Open Build Folder'
      ).then(choice => {
        if (choice === 'Open Build Folder') {
          const folder = target.startsWith('android')
            ? path.join(projectPath, 'android', 'app', 'build', 'outputs')
            : path.join(projectPath, 'ios', 'build');
          if (fs.existsSync(folder)) {
            vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(folder));
          }
        }
      });
      return;
    }

    const isApk = artifact.name.endsWith('.apk');
    const actions = ['📂 Reveal File in OS', '📋 Copy Path'];
    if (isApk) {
      actions.splice(1, 0, '📲 Install on Device');
    }

    const choice = await vscode.window.showInformationMessage(
      `🎉 ${title} ready!\n📦 ${artifact.name} (${artifact.size}) · Built in ${duration}`,
      ...actions
    );

    if (choice === '📂 Reveal File in OS') {
      vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(artifact.path));
    } else if (choice === '📋 Copy Path') {
      await vscode.env.clipboard.writeText(artifact.path);
      vscode.window.showInformationMessage('📋 Artifact path copied to clipboard!');
    } else if (choice === '📲 Install on Device') {
      await this._installApkToDevice(artifact.path);
    }
  }

  /**
   * Installs the generated APK directly onto a connected Android device or emulator
   */
  private static async _installApkToDevice(apkPath: string): Promise<void> {
    const devices = await getAndroidDevices();
    const onlineDevices = devices.filter(d => d.status === 'connected');

    if (onlineDevices.length === 0) {
      vscode.window.showWarningMessage('No running Android devices or emulators found to install APK.');
      return;
    }

    let targetDevice: Device = onlineDevices[0];
    if (onlineDevices.length > 1) {
      const picks = onlineDevices.map(d => ({
        label: `${d.name} (${d.id})`,
        device: d
      }));
      const chosen = await vscode.window.showQuickPick(picks, {
        placeHolder: 'Select target device for installation'
      });
      if (!chosen) {
        return;
      }
      targetDevice = chosen.device;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Installing APK on ${targetDevice.name}...`,
        cancellable: false
      },
      () => {
        return new Promise<void>((resolve) => {
          this.outputChannel.appendLine(`\n📲 Installing ${path.basename(apkPath)} on ${targetDevice.id}...`);
          exec(`adb -s ${targetDevice.id} install -r "${apkPath}"`, (err, stdout, stderr) => {
            const output = stdout + stderr;
            if (err || output.includes('Failure')) {
              this.outputChannel.appendLine(`❌ Installation failed:\n${output}`);
              vscode.window.showErrorMessage(`Installation failed: ${output}`);
            } else {
              this.outputChannel.appendLine(`✅ Installed successfully!\n${output}`);
              vscode.window.showInformationMessage(`✅ Successfully installed on ${targetDevice.name}!`);
            }
            resolve();
          });
        });
      }
    );
  }

  /**
   * Handles build failure, parses root causes, and shows exact error details
   */
  private static async _handleBuildFailure(
    title: string,
    fullOutput: string,
    errorBuffer: string,
    code: number
  ): Promise<void> {
    const parsedError = this._parseBuildError(fullOutput, errorBuffer);

    this.outputChannel.show(true);

    const message = `❌ ${title} failed (Exit Code ${code})\n${parsedError.summary}`;
    const actions = ['🔍 View Build Log', '📋 Copy Error Details'];

    if (parsedError.troubleshootingUrl) {
      actions.push('💡 Open Guide');
    }

    const choice = await vscode.window.showErrorMessage(message, { modal: false }, ...actions);

    if (choice === '🔍 View Build Log') {
      this.outputChannel.show(true);
    } else if (choice === '📋 Copy Error Details') {
      await vscode.env.clipboard.writeText(parsedError.fullError);
      vscode.window.showInformationMessage('📋 Exact error copied to clipboard!');
    } else if (choice === '💡 Open Guide' && parsedError.troubleshootingUrl) {
      vscode.env.openExternal(vscode.Uri.parse(parsedError.troubleshootingUrl));
    }
  }

  /**
   * Parses Gradle or Xcode build logs to isolate the exact failure reason
   */
  private static _parseBuildError(
    fullOutput: string,
    errorBuffer: string
  ): { summary: string; fullError: string; troubleshootingUrl?: string } {
    const text = (fullOutput + '\n' + errorBuffer).trim();

    // 1. Gradle: What went wrong block
    const whatWentWrongMatch = text.match(/\* What went wrong:([\s\S]*?)(?=\* Try:|\* Exception is:|\* Get more help at|$)/);
    if (whatWentWrongMatch && whatWentWrongMatch[1]) {
      const whatWentWrong = whatWentWrongMatch[1].trim();

      // Check specific common issues
      if (whatWentWrong.includes('keystore') || whatWentWrong.includes('signingConfig')) {
        return {
          summary: 'Signing error: Keystore not configured for release build.',
          fullError: whatWentWrong,
          troubleshootingUrl: 'https://reactnative.dev/docs/signed-apk-android'
        };
      }

      if (whatWentWrong.includes('SDK location not found') || whatWentWrong.includes('sdk.dir')) {
        return {
          summary: 'Android SDK location not found in local.properties or ANDROID_HOME.',
          fullError: whatWentWrong
        };
      }

      if (whatWentWrong.includes('Unsupported class file major version') || whatWentWrong.includes('Java')) {
        return {
          summary: 'Java/JDK version incompatibility detected. Recommended: JDK 17.',
          fullError: whatWentWrong
        };
      }

      // Format first 3 lines of what went wrong for concise popup
      const lines = whatWentWrong.split('\n').filter(l => l.trim().length > 0);
      const summary = lines.slice(0, 3).join(' ').replace(/\s+/g, ' ');
      return {
        summary: summary.length > 200 ? summary.slice(0, 197) + '...' : summary,
        fullError: whatWentWrong
      };
    }

    // 2. Gradle: Task execution failed
    const taskFailedMatch = text.match(/(> Task :\S+ FAILED[\s\S]*?)(?=\n\n|\n[A-Z]|$)/);
    if (taskFailedMatch) {
      const taskError = taskFailedMatch[1].trim();
      const lines = taskError.split('\n').map(l => l.trim()).filter(Boolean);
      return {
        summary: lines.slice(0, 2).join(' '),
        fullError: taskError
      };
    }

    // 3. Xcode Code Signing Error
    if (text.includes('Signing for') && text.includes('requires a development team')) {
      return {
        summary: 'iOS Signing Error: Xcode requires a Development Team for signing.',
        fullError: 'Signing for target requires a development team. Please open the project in Xcode and configure Signing & Capabilities.',
        troubleshootingUrl: 'https://reactnative.dev/docs/publishing-to-app-store'
      };
    }

    // 4. Xcode Build Failed
    const xcodeErrorMatches = text.match(/error: [^\n]+/g);
    if (xcodeErrorMatches && xcodeErrorMatches.length > 0) {
      return {
        summary: xcodeErrorMatches[0].replace(/^error:\s*/, ''),
        fullError: xcodeErrorMatches.join('\n')
      };
    }

    // Fallback: Last few lines of error
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const lastLines = lines.slice(-5).join(' ');
    const fallbackSummary = lastLines.length > 180 ? lastLines.slice(-177) + '...' : lastLines;

    return {
      summary: fallbackSummary || 'Unknown error occurred during build process.',
      fullError: text.slice(-3000)
    };
  }

  private static _formatDuration(ms: number): string {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  }
}

