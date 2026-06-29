# Architecture: Memory Monitor & Screen Leak Profiler

The **Memory Monitor** is a flagship feature designed to intercept and visualize React Native heap allocations natively inside VS Code. Unlike traditional browser-based profiling tools (which require Remote JS Debugging and bypass the device engine entirely), this tool hooks directly into the **Hermes engine**.

## 🏗 System Architecture

The monitor is split into three primary layers:

### 1. The React Native Client (`global.HermesInternal`)
Inside the React Native application, a lightweight hook uses the native `global.HermesInternal.getInstrumentedStats()` method to extract raw C++ heap metrics from the Hermes VM. 

This data includes:
- `heapUsed`: Bytes actively held in memory.
- `heapTotal`: Total bytes requested from the OS.
- `gcTime` / `gcCount`: Garbage collection frequency and duration.

These metrics are serialized and emitted over a WebSocket connection to the host machine.

### 2. The VS Code WebSocket Server (`memoryServer.ts`)
The extension hosts an embedded WebSocket server utilizing the Node.js `ws` library (dynamically bound to an available port, defaulting to `8348`).
- **Relay**: It receives the incoming JSON metrics from the React Native app.
- **Commands**: It broadcasts commands back to the app (e.g., `forceGC`, which triggers `global.gc()`).
- **Multi-tenant**: Port discovery ensures multiple VS Code workspaces can run isolated Memory Monitors simultaneously.

### 3. The Webview Dashboard (`memory.html` & `memoryPanelProvider.ts`)
The VS Code UI is a high-performance Webview Panel containing an HTML5 Canvas dashboard.
- **Canvas Rendering**: Uses pure HTML5 Canvas context scaling (handling high-DPI displays) to render a 60fps scrolling chart. This prevents the VS Code UI thread from locking up, which typically happens when rendering heavy SVG charts.
- **RPC Messaging**: Connects to the host extension via the `vscode.postMessage` API to relay WebSocket messages bi-directionally.

---

## 🧪 Screen Leak Profiler (Methodology)

A common issue in React Native memory profiling is **Stack Retention**. When pushing screens in a Stack Navigator, previous screens are intentionally kept mounted by the framework, resulting in expected (organic) heap growth. Profilers often mistake this for memory leaks.

To resolve this, the Screen Leak Profiler uses a strict methodology:
1. **Allocated Memory vs Retained Memory**: The timeline natively plots *Allocated Memory* upon receiving a React Navigation screen transition event.
2. **Synchronous Garbage Collection**: To prevent short-lived uncollected garbage from inflating the numbers, the extension fires a synchronous `global.gc()` command on every screen transition, ensuring timeline steps represent pure allocations.
3. **Stack Popping (The End Test)**: Developers are instructed to navigate back (popping the stack) before concluding the test. When the test ends, the stack is popped, and a final `global.gc()` is triggered.
4. **Final Calculation**: The delta between the pre-test baseline and the post-test (post-GC) heap determines the true **Retained Memory** (the actual leak).

By isolating the tests in this manner, developers can bypass standard framework retention and accurately identify closure traps, uncleared listeners, and dangling references.
