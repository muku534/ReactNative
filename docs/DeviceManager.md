# Architecture: Device Manager & IDE Orchestration

The **Device Manager** provides a dedicated VS Code Sidebar view ("RN Tools") that abstracts away Xcode and Android Studio, allowing developers to discover, boot, and run apps on iOS Simulators, Android Emulators, and Physical Devices entirely within the editor.

## 🏗 System Architecture

The Device Manager is built using a custom VS Code Webview Provider (`DeviceViewProvider`) that communicates asynchronously with the host OS.

### 1. Device Discovery Engine (`deviceManager.ts`)
The extension utilizes Node's `child_process.exec` to interface with the native development SDKs installed on the host machine.
- **iOS Simulators**: Executes `xcrun simctl list devices --json` to fetch the complete registry of Apple devices. It parses the JSON to determine the boot state (Booted vs. Offline).
- **Android Emulators**: Executes `emulator -list-avds` to fetch configured Android Virtual Devices. It cross-references this with `adb devices` to determine which emulators are currently running.
- **Physical Devices (v1.3.0)**: Interfaces with `adb` (Android) and `xcrun devicectl` (iOS 17+) or `ios-deploy` (older iOS) to detect devices connected via USB or Wi-Fi.

### 2. The Sidebar UI (`webview/main.html`)
The sidebar is a lightweight HTML interface styled strictly with VS Code's native CSS variables (`var(--vscode-*)`) to ensure it perfectly matches the user's active theme.
- **Bi-directional Communication**: The UI uses `acquireVsCodeApi().postMessage()` to send user actions (e.g., "Boot Device", "Run App") to the extension.
- **State Management**: The UI dynamically updates the visual status (Play button vs Power button) depending on the real-time boot state reported by the discovery engine.

### 3. Execution & Orchestration
When a user clicks "Run" on a device:

1. **Auto-Boot**: If the device is offline, the extension executes the respective boot command (`xcrun simctl boot <uuid>` or `emulator -avd <name>`).
2. **Launch App**: The extension opens a dedicated integrated terminal in VS Code and executes the React Native launch command (e.g., `npx react-native run-ios --simulator="<name>"`).
3. **Custom Commands**: It parses the `settings.json` workspace configuration to allow developers to override the launch command (e.g., injecting environment variables).
4. **Metro Bundler Control**: The extension provides explicit UI buttons to start or terminate the Metro Bundler terminal process independently of the device.

---

## 🪟 Automated Window Arrangement

To optimize developer ergonomics, the extension orchestrates the OS-level window layouts so the IDE and the Simulator sit perfectly side-by-side.

### macOS (AppleScript)
The extension executes a compiled AppleScript utilizing the macOS Accessibility APIs (`System Events`). 
- It identifies the active VS Code window and the iOS Simulator window.
- It dynamically calculates the screen resolution bounds.
- It resizes VS Code to occupy the left portion of the screen, and the Simulator to occupy the right portion.

### Windows (PowerShell)
The extension executes a native PowerShell script leveraging the `user32.dll` Windows API.
- It identifies the `Code.exe` process and the `qemu-system-x86_64.exe` (Android Emulator) process.
- It utilizes `MoveWindow` to snap the IDE to the left and the Emulator to the right.
