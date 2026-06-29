# Architecture: Project Creation

The **Project Creation** module simplifies React Native app scaffolding by replacing complex CLI commands with a native, interactive VS Code Command Palette workflow.

## 🏗 System Architecture

The workflow is orchestrated directly through the VS Code Extension API.

### 1. Interactive Command Palette (`newProject.ts`)
When the user executes `React Native: New Project`, the extension triggers a sequence of native VS Code Input Boxes and Quick Picks:
- **Directory Selection**: Uses `vscode.window.showOpenDialog` to allow the user to visually pick the destination folder.
- **Project Naming**: Uses `vscode.window.showInputBox` to capture the React Native project name (with built-in validation to ensure standard naming conventions).
- **Framework Selection**: Currently supports React Native CLI (`npx react-native init`), with architectural hooks ready for Expo support.

### 2. Background Execution
Instead of launching an external terminal window, the scaffolding process is executed via Node's `child_process.spawn`.
- **Progress UI**: The extension utilizes `vscode.window.withProgress` to display a native progress bar in the bottom right corner of the editor.
- **Output Channel**: A dedicated `ReactNative Creator` output channel is created (`vscode.window.createOutputChannel`). The `stdout` and `stderr` streams from the CLI are piped directly into this channel, allowing the user to view the installation logs without leaving their active editor.

### 3. Automated Post-Processing
Once the CLI completes, the extension automatically performs necessary environment tasks:
- **macOS CocoaPods**: If running on macOS, the extension automatically detects the `ios/` directory and executes `pod install`, saving the developer a manual step.
- **Workspace Reloading**: The extension seamlessly opens the newly created project folder in the current VS Code workspace, immediately setting up the environment for development.
