import { exec } from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Polls every 2s until simulator/emulator window is detected,
 * then auto-arranges: VS Code = left 60%, Simulator = right 40%
 */
export function waitThenArrange(platform: 'ios' | 'android') {
  // Only supported on macOS
  if (os.platform() !== 'darwin') {
    return;
  }

  const label = platform === 'ios' ? 'iOS Simulator' : 'Android Emulator';

  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Waiting for ${label} window...`,
      cancellable: true
    },
    (progress, token) => {
      return new Promise<void>((resolve) => {
        let attempts = 0;
        const MAX_ATTEMPTS = 30;

        const interval = setInterval(() => {
          if (token.isCancellationRequested) {
            clearInterval(interval);
            resolve();
            return;
          }

          attempts++;
          progress.report({ message: `(${attempts}/${MAX_ATTEMPTS})` });

          isSimulatorReady(platform).then(ready => {
            if (ready) {
              clearInterval(interval);
              progress.report({ message: 'Arranging windows...' });

              setTimeout(() => {
                arrangeWindows(platform).then(() => {
                  vscode.window.showInformationMessage(
                    platform === 'ios' ? '📱 iOS Simulator ready!' : '🤖 Android Emulator ready!'
                  );
                  resolve();
                });
              }, 3000);
            }
          });

          if (attempts >= MAX_ATTEMPTS) {
            clearInterval(interval);
            vscode.window.showWarningMessage(
              `${label} is taking too long. Please arrange windows manually.`
            );
            resolve();
          }
        }, 2000);
      });
    }
  );
}

function isSimulatorReady(platform: 'ios' | 'android'): Promise<boolean> {
  return new Promise(resolve => {
    if (platform === 'ios') {
      exec(
        `pgrep -x Simulator`,
        (err) => {
          resolve(!err);
        }
      );
    } else {
      exec('pgrep -f qemu-system', (err) => {
        resolve(!err);
      });
    }
  });
}

function arrangeWindows(platform: 'ios' | 'android'): Promise<void> {
  return new Promise((resolve) => {
    const scriptLines = [
      'use framework "AppKit"',
      '',
      '-- Get main screen size',
      'set screenFrame to current application\'s NSScreen\'s mainScreen()\'s frame()',
      'set screenW to (item 1 of item 2 of screenFrame) as integer',
      'set screenH to (item 2 of item 2 of screenFrame) as integer',
      '',
      '-- Get Simulator width',
      'set simW to 400',
      'try',
      '  tell application "System Events"',
      '    set p to first process whose bundle identifier is "com.apple.iphonesimulator"',
      '    tell p',
      '      set simSize to size of window 1',
      '      set simW to item 1 of simSize',
      '    end tell',
      '  end tell',
      'on error',
      '  try',
      '    tell application "System Events"',
      '      tell process "Simulator"',
      '        set simSize to size of window 1',
      '        set simW to item 1 of simSize',
      '      end tell',
      '    end tell',
      '  end try',
      'end try',
      '',
      '-- Calculate VS Code width (fill remaining space)',
      'set vsW to screenW - simW',
      'if vsW < (screenW * 0.5) then set vsW to (screenW * 0.6) as integer',
      'set simX to vsW',
      '',
      '-- Position VS Code',
      'try',
      '  tell application "System Events"',
      '    set p to first process whose bundle identifier is "com.microsoft.VSCode"',
      '    tell p',
      '      set position of window 1 to {0, 25}',
      '      set size of window 1 to {vsW, screenH - 25}',
      '    end tell',
      '  end tell',
      'on error',
      '  try',
      '    tell application "System Events"',
      '      tell process "Code"',
      '        set position of window 1 to {0, 25}',
      '        set size of window 1 to {vsW, screenH - 25}',
      '      end tell',
      '    end tell',
      '  end try',
      'end try',
      '',
      'delay 0.3',
      ''
    ];

    if (platform === 'ios') {
      scriptLines.push(
        '-- Position iOS Simulator',
        'try',
        '  tell application "System Events"',
        '    set p to first process whose bundle identifier is "com.apple.iphonesimulator"',
        '    tell p',
        '      set position of window 1 to {simX, 25}',
        '    end tell',
        '  end tell',
        'on error',
        '  try',
        '    tell application "System Events"',
        '      tell process "Simulator"',
        '        set position of window 1 to {simX, 25}',
        '      end tell',
        '    end tell',
        '  end try',
        'end try'
      );
    } else {
      scriptLines.push(
        '-- Position Android Emulator',
        'try',
        '  tell application "System Events"',
        '    tell process "emulator"',
        '      set position of window 1 to {simX, 25}',
        '      set size of window 1 to {screenW - simX, screenH - 25}',
        '    end tell',
        '  end tell',
        'on error',
        '  try',
        '    tell application "System Events"',
        '      tell process "qemu-system-aarch64"',
        '        set position of window 1 to {simX, 25}',
        '        set size of window 1 to {screenW - simX, screenH - 25}',
        '      end tell',
        '    end tell',
        '  end try',
        'end try'
      );
    }

    scriptLines.push(
      '',
      '-- Bring VS Code back to focus',
      'delay 0.2',
      'tell application "Visual Studio Code" to activate'
    );

    const script = scriptLines.join('\n');

    const tmpFile = path.join(os.tmpdir(), 'rn_arrange_windows.scpt');
    fs.writeFileSync(tmpFile, script, 'utf8');

    exec(`osascript "${tmpFile}"`, (err, _stdout, stderr) => {
      // Clean up temp file
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }

      if (err) {
        console.error('Window arrange error:', err, stderr);
        vscode.window.showWarningMessage(
          `Could not arrange windows: ${stderr || err.message}`
        );
      }
      resolve();
    });
  });
}
