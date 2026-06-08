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
  if (platform === 'ios' && os.platform() !== 'darwin') {
    return;
  }
  if (platform === 'android' && os.platform() !== 'darwin' && os.platform() !== 'win32') {
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
      if (os.platform() === 'win32') {
        exec('tasklist | findstr qemu-system', (err) => {
          resolve(!err);
        });
      } else {
        exec('pgrep -f qemu-system', (err) => {
          resolve(!err);
        });
      }
    }
  });
}

function arrangeWindows(platform: 'ios' | 'android'): Promise<void> {
  return new Promise((resolve) => {
    if (os.platform() === 'win32') {
      const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hwnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }
}
"@

Add-Type -AssemblyName System.Windows.Forms
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$screenW = $screen.Width
$screenH = $screen.Height

$emu = Get-Process | Where-Object { $_.ProcessName -like "*qemu-system*" -and $_.MainWindowTitle -ne "" } | Select-Object -First 1
$simW = 400

if ($emu -and $emu.MainWindowHandle -ne [IntPtr]::Zero) {
    $rect = New-Object Win32+RECT
    [Win32]::GetWindowRect($emu.MainWindowHandle, [ref]$rect) | Out-Null
    $simW = $rect.Right - $rect.Left
    if ($simW -le 0) { $simW = 400 }
    
    $vsW = $screenW - $simW
    if ($vsW -lt ($screenW * 0.5)) { $vsW = [math]::Floor($screenW * 0.6) }
    $simX = $vsW
    
    [Win32]::ShowWindow($emu.MainWindowHandle, 9) | Out-Null
    [Win32]::SetWindowPos($emu.MainWindowHandle, [IntPtr]::Zero, $simX, 0, $simW, $screenH, 0x0040) | Out-Null
} else {
    $vsW = $screenW - $simW
    if ($vsW -lt ($screenW * 0.5)) { $vsW = [math]::Floor($screenW * 0.6) }
}

$vscodes = Get-Process | Where-Object { $_.ProcessName -eq "Code" -and $_.MainWindowTitle -ne "" }
foreach ($vscode in $vscodes) {
    if ($vscode.MainWindowHandle -ne [IntPtr]::Zero) {
        [Win32]::ShowWindow($vscode.MainWindowHandle, 9) | Out-Null
        [Win32]::SetWindowPos($vscode.MainWindowHandle, [IntPtr]::Zero, 0, 0, $vsW, $screenH, 0x0040) | Out-Null
    }
}
`;
      const tmpFile = path.join(os.tmpdir(), 'rn_arrange_windows.ps1');
      fs.writeFileSync(tmpFile, psScript, 'utf8');

      exec(`powershell -ExecutionPolicy Bypass -File "${tmpFile}"`, (err, _stdout, stderr) => {
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
        if (err) {
          console.error('Window arrange error:', err, stderr);
          vscode.window.showWarningMessage(
            `Could not arrange windows: ${stderr || err.message}`
          );
        }
        resolve();
      });
      return;
    }

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
      'set possibleSim to {"Simulator", "com.apple.iphonesimulator"}',
      'tell application "System Events"',
      '  repeat with sName in possibleSim',
      '    try',
      '      set p to first process whose name is (sName as string)',
      '      set simSize to size of window 1 of p',
      '      set simW to item 1 of simSize',
      '      exit repeat',
      '    end try',
      '  end repeat',
      'end tell',
      '',
      '-- Calculate VS Code width (fill remaining space)',
      'set vsW to screenW - simW',
      'if vsW < (screenW * 0.5) then set vsW to (screenW * 0.6) as integer',
      'set simX to vsW',
      '',
      '-- Position IDE (VS Code, Cursor, Electron, etc)',
      'set possibleNames to {"Code", "Electron", "Cursor", "VSCodium", "Visual Studio Code"}',
      'set ideProcess to missing value',
      'tell application "System Events"',
      '  repeat with pName in possibleNames',
      '    try',
      '      set p to first process whose name is (pName as string)',
      '      set ideProcess to p',
      '      exit repeat',
      '    end try',
      '  end repeat',
      'end tell',
      '',
      'if ideProcess is not missing value then',
      '  try',
      '    tell application "System Events"',
      '      tell ideProcess',
      '        set position of window 1 to {0, 25}',
      '        set size of window 1 to {vsW, screenH - 25}',
      '      end tell',
      '    end tell',
      '  end try',
      'end if',
      '',
      'delay 0.3',
      ''
    ];

    if (platform === 'ios') {
      scriptLines.push(
        '-- Position iOS Simulator',
        'set possibleSim to {"Simulator", "com.apple.iphonesimulator"}',
        'set simProcess to missing value',
        'tell application "System Events"',
        '  repeat with sName in possibleSim',
        '    try',
        '      set p to first process whose name is (sName as string)',
        '      set simProcess to p',
        '      exit repeat',
        '    end try',
        '  end repeat',
        'end tell',
        'if simProcess is not missing value then',
        '  try',
        '    tell application "System Events"',
        '      tell simProcess',
        '        set position of window 1 to {simX, 25}',
        '      end tell',
        '    end tell',
        '  end try',
        'end if'
      );
    } else {
      scriptLines.push(
        '-- Position Android Emulator',
        'set possibleEmu to {"emulator", "qemu-system-aarch64", "qemu-system-x86_64", "qemu-system-x86_64-headless"}',
        'set emuProcess to missing value',
        'tell application "System Events"',
        '  repeat with eName in possibleEmu',
        '    try',
        '      set p to first process whose name is (eName as string)',
        '      set emuProcess to p',
        '      exit repeat',
        '    end try',
        '  end repeat',
        'end tell',
        'if emuProcess is not missing value then',
        '  try',
        '    tell application "System Events"',
        '      tell emuProcess',
        '        set position of window 1 to {simX, 25}',
        '        set size of window 1 to {screenW - simX, screenH - 25}',
        '      end tell',
        '    end tell',
        '  end try',
        'end if'
      );
    }

    scriptLines.push(
      '',
      '-- Bring IDE back to focus',
      'delay 0.2',
      'if ideProcess is not missing value then',
      '  try',
      '    tell application "System Events"',
      '      set frontmost of ideProcess to true',
      '    end tell',
      '  end try',
      'end if'
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
