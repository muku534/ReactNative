import { exec } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

export interface Device {
  id: string;
  name: string;
  platform: 'ios' | 'android';
  status: 'booted' | 'offline' | 'connected';
  osVersion?: string;
  isUSB?: boolean;
  isPhysical?: boolean;
  connectionType?: 'usb' | 'wifi' | 'simulator' | 'emulator';
  avdName?: string; // For Android AVDs
}

// ── iOS Simulators ──────────────────────────────────────────
export async function getIOSSimulators(): Promise<Device[]> {
  if (os.platform() !== 'darwin') { return []; }

  return new Promise((resolve) => {
    exec('xcrun simctl list devices available --json', (err, stdout) => {
      if (err) { return resolve([]); }
      try {
        const data = JSON.parse(stdout);
        const devices: Device[] = [];

        Object.entries(data.devices).forEach(([runtime, list]: [string, any]) => {
          const match = runtime.match(/iOS-(\d+)-(\d+)/);
          const version = match ? `${match[1]}.${match[2]}` : '';

          (list as any[]).forEach((d: any) => {
            if (d.isAvailable) {
              devices.push({
                id: d.udid,
                name: d.name,
                platform: 'ios',
                status: d.state === 'Booted' ? 'booted' : 'offline',
                osVersion: version,
                isPhysical: false,
                connectionType: 'simulator'
              });
            }
          });
        });

        // Booted devices first
        devices.sort((a) => (a.status === 'booted' ? -1 : 1));
        resolve(devices);
      } catch {
        resolve([]);
      }
    });
  });
}

// ── iOS Physical Devices (USB + WiFi) ───────────────────────
export async function getIOSPhysicalDevices(): Promise<Device[]> {
  if (os.platform() !== 'darwin') { return []; }

  return new Promise((resolve) => {
    exec('xcrun xctrace list devices', (err, stdout) => {
      if (err) { return resolve([]); }

      try {
        const lines = stdout.split('\n');
        const devices: Device[] = [];

        // xctrace output format:
        // == Devices ==
        // Device Name (OS Version) (UDID)
        // == Simulators ==
        // ...
        let inDevicesSection = false;

        for (const line of lines) {
          const trimmed = line.trim();

          if (trimmed === '== Devices ==') {
            inDevicesSection = true;
            continue;
          }
          if (trimmed === '== Simulators ==' || trimmed.startsWith('== ')) {
            inDevicesSection = false;
            continue;
          }

          if (inDevicesSection && trimmed.length > 0) {
            // Parse: "iPhone 15 Pro (17.0) (00008101-XXXX)"
            const deviceMatch = trimmed.match(/^(.+?)\s+\(([^)]+)\)\s+\(([A-Fa-f0-9-]+)\)$/);
            if (deviceMatch) {
              const deviceName = deviceMatch[1].trim();
              const osVersionStr = deviceMatch[2].trim();
              const udid = deviceMatch[3].trim();

              // Skip the Mac itself (it also appears in the list)
              if (deviceName.includes('Mac') || deviceName.includes('MacBook')) {
                continue;
              }

              devices.push({
                id: udid,
                name: deviceName,
                platform: 'ios',
                status: 'connected',
                osVersion: osVersionStr,
                isUSB: true,
                isPhysical: true,
                connectionType: 'usb' // Could be WiFi too, xctrace doesn't distinguish
              });
            }
          }
        }

        resolve(devices);
      } catch {
        resolve([]);
      }
    });
  });
}

// ── Boot an iOS Simulator ───────────────────────────────────
export async function bootIOSSimulator(udid: string): Promise<boolean> {
  return new Promise((resolve) => {
    // Boot the simulator
    exec(`xcrun simctl boot ${udid}`, (err) => {
      if (err && !err.message.includes('current state: Booted')) {
        resolve(false);
        return;
      }
      // Open the Simulator app so the window appears
      exec('open -a Simulator', (openErr) => {
        resolve(!openErr);
      });
    });
  });
}

// ── Android: Connected devices (USB + WiFi + running emulators) ─
export async function getAndroidDevices(): Promise<Device[]> {
  return new Promise((resolve) => {
    exec('adb devices -l', (err, stdout) => {
      if (err) { return resolve([]); }

      const lines = stdout
        .split('\n')
        .slice(1)
        .filter(l => l.trim() && !l.includes('offline'));

      const devices: Device[] = lines.map(line => {
        const parts = line.split(/\s+/);
        const deviceId = parts[0];
        const isEmulator = deviceId.startsWith('emulator');
        const isWiFi = deviceId.includes(':'); // WiFi devices show as IP:port
        const isUSB = !isEmulator && !isWiFi;
        const modelMatch = line.match(/model:(\S+)/);

        let connectionType: 'usb' | 'wifi' | 'emulator' = 'emulator';
        if (isUSB) { connectionType = 'usb'; }
        if (isWiFi && !isEmulator) { connectionType = 'wifi'; }

        return {
          id: deviceId,
          name: modelMatch
            ? modelMatch[1].replace(/_/g, ' ')
            : (isEmulator ? 'Android Emulator' : (isWiFi ? 'Android (WiFi)' : 'Android Device')),
          platform: 'android' as const,
          status: 'connected' as const,
          isUSB,
          isPhysical: !isEmulator,
          connectionType
        };
      });

      resolve(devices);
    });
  });
}

function getEmulatorCommand(): string {
  // Check ANDROID_HOME or ANDROID_SDK_ROOT environment variable first
  const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (androidHome) {
    const defaultEmulatorPath = path.join(androidHome, 'emulator', os.platform() === 'win32' ? 'emulator.exe' : 'emulator');
    if (fs.existsSync(defaultEmulatorPath)) {
      return `"${defaultEmulatorPath}"`;
    }
  }

  // Check default install locations if environment variables aren't configured
  const homeDir = os.homedir();
  let defaultSdkPath = '';
  if (os.platform() === 'win32') {
    defaultSdkPath = path.join(process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local'), 'Android', 'Sdk');
  } else if (os.platform() === 'darwin') {
    defaultSdkPath = path.join(homeDir, 'Library', 'Android', 'sdk');
  } else {
    defaultSdkPath = path.join(homeDir, 'Android', 'Sdk');
  }

  const defaultEmulatorPath = path.join(defaultSdkPath, 'emulator', os.platform() === 'win32' ? 'emulator.exe' : 'emulator');
  if (fs.existsSync(defaultEmulatorPath)) {
    return `"${defaultEmulatorPath}"`;
  }

  // Fallback to searching the PATH
  return 'emulator';
}

// ── Android: List available AVDs (even when not running) ────
export async function getAndroidAVDs(): Promise<Device[]> {
  return new Promise((resolve) => {
    const emulatorCmd = getEmulatorCommand();
    exec(`${emulatorCmd} -list-avds`, (err, stdout) => {
      if (err) { return resolve([]); }

      const avdNames = stdout
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0);

      const devices: Device[] = avdNames.map(name => ({
        id: `avd:${name}`,
        name: name.replace(/_/g, ' '),
        platform: 'android' as const,
        status: 'offline' as const,
        avdName: name,
        isPhysical: false,
        connectionType: 'emulator' as const
      }));

      resolve(devices);
    });
  });
}

// ── Launch an Android AVD ───────────────────────────────────
export async function launchAndroidEmulator(avdName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const emulatorCmd = getEmulatorCommand();
    // Launch emulator in background (detached)
    const child = exec(`${emulatorCmd} -avd ${avdName} -no-snapshot-load`, {
      timeout: 0
    });

    // Don't wait for it to finish — it runs forever
    child.unref?.();

    // Give it a moment to start booting
    setTimeout(() => resolve(true), 3000);
  });
}

// ── Android WiFi: Pair device (Android 11+) ─────────────────
export async function pairAndroidWiFi(ip: string, port: string, code: string): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve) => {
    exec(`adb pair ${ip}:${port} ${code}`, (err, stdout, stderr) => {
      const output = stdout + stderr;
      if (err || output.toLowerCase().includes('failed')) {
        resolve({ success: false, message: output || err?.message || 'Pairing failed' });
      } else {
        resolve({ success: true, message: output || 'Paired successfully' });
      }
    });
  });
}

// ── Android WiFi: Connect to device ─────────────────────────
export async function connectAndroidWiFi(ip: string, port: string): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve) => {
    exec(`adb connect ${ip}:${port}`, (err, stdout, stderr) => {
      const output = stdout + stderr;
      if (err || output.toLowerCase().includes('failed') || output.toLowerCase().includes('unable')) {
        resolve({ success: false, message: output || err?.message || 'Connection failed' });
      } else {
        resolve({ success: true, message: output || 'Connected successfully' });
      }
    });
  });
}

// ── Android WiFi: Switch USB device to WiFi mode (older Android) ─
export async function switchToWiFiMode(port: string = '5555'): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve) => {
    exec(`adb tcpip ${port}`, (err, stdout, stderr) => {
      const output = stdout + stderr;
      if (err) {
        resolve({ success: false, message: output || err?.message || 'Failed to switch to WiFi mode' });
      } else {
        resolve({ success: true, message: output || `Switched to TCP/IP mode on port ${port}` });
      }
    });
  });
}

// ── Android WiFi: Disconnect a WiFi device ──────────────────
export async function disconnectAndroidWiFi(deviceId: string): Promise<boolean> {
  return new Promise((resolve) => {
    exec(`adb disconnect ${deviceId}`, (err) => {
      resolve(!err);
    });
  });
}

// ── Check if scrcpy is installed ────────────────────────────
export async function checkScrcpyInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    exec('scrcpy --version', (err) => {
      resolve(!err);
    });
  });
}

// ── Get ALL Devices (merged & deduplicated) ─────────────────
export async function getAllDevices(): Promise<Device[]> {
  const [iosSimulators, iosPhysical, androidConnected, androidAVDs] = await Promise.all([
    getIOSSimulators(),
    getIOSPhysicalDevices(),
    getAndroidDevices(),
    getAndroidAVDs()
  ]);

  // Deduplicate iOS: remove physical devices that are also in simulators list (by UDID)
  const simUdids = new Set(iosSimulators.map(s => s.id));
  const uniquePhysical = iosPhysical.filter(p => !simUdids.has(p.id));

  // Merge Android: connected devices take priority over AVD listing
  const offlineAVDs = androidAVDs.filter(avd => {
    // Check if this AVD is already running (appears in adb devices)
    const avdRunning = androidConnected.some(c =>
      c.name.toLowerCase().replace(/\s/g, '_') === avd.avdName?.toLowerCase()
    );
    return !avdRunning;
  });

  // Separate physical and virtual devices
  const physicalDevices = [...uniquePhysical, ...androidConnected.filter(d => d.isPhysical)];
  const virtualDevices = [
    ...iosSimulators,
    ...androidConnected.filter(d => !d.isPhysical),
    ...offlineAVDs
  ];

  // Physical devices first, then virtual
  return [...physicalDevices, ...virtualDevices];
}
