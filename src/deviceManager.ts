import { exec } from 'child_process';
import * as os from 'os';

export interface Device {
  id: string;
  name: string;
  platform: 'ios' | 'android';
  status: 'booted' | 'offline' | 'connected';
  osVersion?: string;
  isUSB?: boolean;
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
                osVersion: version
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

// ── Android: Connected devices (USB + running emulators) ────
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
        const isUSB = !parts[0].startsWith('emulator');
        const modelMatch = line.match(/model:(\S+)/);

        return {
          id: parts[0],
          name: modelMatch
            ? modelMatch[1].replace(/_/g, ' ')
            : (isUSB ? 'Android Device' : 'Android Emulator'),
          platform: 'android' as const,
          status: 'connected' as const,
          isUSB
        };
      });

      resolve(devices);
    });
  });
}

// ── Android: List available AVDs (even when not running) ────
export async function getAndroidAVDs(): Promise<Device[]> {
  return new Promise((resolve) => {
    // Try to find emulator binary
    exec('emulator -list-avds', (err, stdout) => {
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
        avdName: name
      }));

      resolve(devices);
    });
  });
}

// ── Launch an Android AVD ───────────────────────────────────
export async function launchAndroidEmulator(avdName: string): Promise<boolean> {
  return new Promise((resolve) => {
    // Launch emulator in background (detached)
    const child = exec(`emulator -avd ${avdName} -no-snapshot-load`, {
      timeout: 0
    });

    // Don't wait for it to finish — it runs forever
    child.unref?.();

    // Give it a moment to start booting
    setTimeout(() => resolve(true), 3000);
  });
}

// ── Get ALL Devices (merged & deduplicated) ─────────────────
export async function getAllDevices(): Promise<Device[]> {
  const [iosSimulators, androidConnected, androidAVDs] = await Promise.all([
    getIOSSimulators(),
    getAndroidDevices(),
    getAndroidAVDs()
  ]);

  // Merge Android: connected devices take priority over AVD listing
  const offlineAVDs = androidAVDs.filter(avd => {
    // Check if this AVD is already running (appears in adb devices)
    const avdRunning = androidConnected.some(c =>
      c.name.toLowerCase().replace(/\s/g, '_') === avd.avdName?.toLowerCase()
    );
    return !avdRunning;
  });

  return [...iosSimulators, ...androidConnected, ...offlineAVDs];
}
