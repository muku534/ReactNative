# Changelog

All notable changes to the React Native Companion extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.7] - 2026-06-30

### Fixed
- **Memory Monitor Educational UX**: Improved the Screen Leak Tester by adding navigation state validation. The tool now intelligently distinguishes between actual memory leaks and normal React Navigation retained screens to eliminate false positive warnings.

## [1.3.6] - 2026-06-25

### Added
- **Memory Monitor**: Introduced an in-editor memory dashboard powered by the Hermes JavaScript engine, accessible via the `React Native: Open Memory Monitor` command.
- **Real-time Memory Visualization**: Implemented a high-performance HTML5 Canvas chart to render live heap usage and garbage collection events with minimal performance overhead.
- **Screen Leak Profiler**: Added an automated tracking mechanism that integrates with React Navigation to calculate memory deltas across screen transitions, providing a granular timeline report for identifying memory leaks.

## [1.3.5] - 2026-06-15

### Fixed
- **Dependency Bundling**: Resolved an issue where the `ws` (WebSocket) module was excluded from the compiled extension package due to a misconfigured `.vscodeignore`. This resolves the `Cannot find module 'ws'` exception during Network Monitor activation.

## [1.3.4] - 2026-06-11

### Added
- **Network Monitor**: Integrated a native Network Monitor panel within VS Code to intercept and inspect `fetch` and `Axios` network requests from the running application.
- **Dynamic Port Binding**: The Network Monitor now automatically binds to the next available WebSocket port to safely support multiple concurrent React Native workspaces.

### Fixed
- **Binary Payload Handling**: Fortified network interceptors to gracefully process binary and Blob data types without causing application crashes.

## [1.3.3] - 2026-06-10

### Fixed
- **Window Arrangement (macOS)**: Corrected window auto-arrangement failures that occurred when operating within a Development Host or alternative VS Code distributions (e.g., Cursor).

## [1.3.2] - 2026-06-08

### Fixed
- **Webview Initialization**: Addressed a race condition where the sidebar webview would fail to complete the initial handshake, permanently stalling in a loading state.
- **Emulator Discovery (Windows)**: Enhanced Android SDK path resolution on Windows environments to successfully locate the emulator binary across standard installation paths.

## [1.3.1] - 2026-06-05

### Added
- **Custom Launch Configuration**: Introduced `reactnative.customStartCommandAndroid` and `reactnative.customStartCommandIOS` workspace settings to allow overriding the default launch commands. This supports injecting environment variables and accepts `${deviceId}` and `${deviceName}` interpolation.

## [1.3.0] - 2026-06-01

### Added
- **Physical Device Support**: Implemented auto-detection for physical iOS and Android devices connected via USB or Wi-Fi (ADB).
- **Wireless Debugging**: Added a connection wizard to facilitate wireless ADB pairing for Android 11+ via QR codes or pairing codes.
- **Desktop Mirroring**: Integrated `scrcpy` to enable direct screen mirroring and interaction with physical Android devices from the host machine.
- **iOS Provisioning Validation**: Added pre-execution checks to validate Apple Developer signing configurations before deploying to physical iOS hardware.

## [1.2.0] - 2026-05-20

### Added
- **Expo Framework Support**: Extended core extension capabilities to fully support Expo project initialization, device discovery, and application execution.
- **Window Arrangement (Windows)**: Ported the automated IDE and emulator side-by-side window arrangement feature to Windows OS.

## [1.1.0] - 2026-05-15

### Added
- **Device Manager UI**: Introduced a dedicated sidebar panel to consolidate device discovery, boot controls, and application execution.
- **Window Arrangement (macOS)**: Automatically orchestrates the layout of VS Code and the Simulator to align side-by-side upon app launch.
- **Metro Bundler Controls**: Added dedicated UI actions to explicitly start and terminate the Metro Bundler process.
- **Offline AVD Support**: Added the ability to detect configured Android Virtual Devices (AVDs) and launch them from an offline state.

## [1.0.0] - 2026-05-01

### Added
- **Project Initialization**: Introduced the `React Native: New Project` command for streamlined project scaffolding directly within VS Code.
- **Dependency Management (macOS)**: Integrated automated CocoaPods resolution and installation for iOS targets.
- **Progress Reporting**: Implemented native background progress indicators and dedicated output channels to track execution steps.
