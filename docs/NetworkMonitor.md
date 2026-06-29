# Architecture: Network Monitor

The **Network Monitor** is an in-editor DevTools replacement that allows React Native developers to intercept and inspect network requests directly inside VS Code without requiring standalone debuggers like Flipper or React Native Debugger.

## 🏗 System Architecture

The Network Monitor utilizes a WebSocket-based IPC (Inter-Process Communication) model to bridge the mobile application and the VS Code Extension.

### 1. The Mobile Interceptor (Client)
A lightweight JavaScript snippet is injected into the root of the React Native application (`App.tsx` or `index.js`). This snippet overrides the global `XMLHttpRequest` and `fetch` prototypes.

When a network call is initiated:
1. **Request Interception**: Method, URL, Headers, and Body are captured.
2. **Timing**: A high-resolution timer (`Date.now()`) starts tracking the request duration.
3. **Response Interception**: The payload is intercepted at the network boundary. Binary data (e.g., Images, Blobs) is safely stringified or bypassed to prevent application crashes.
4. **WebSocket Transmission**: The structured telemetry object is emitted over a standard `ws` connection to the host machine.

### 2. The VS Code WebSocket Server (`networkServer.ts`)
The extension hosts an embedded WebSocket server utilizing the Node.js `ws` library (dynamically bound to an available port, defaulting to `8347`).
- **Telemetry Relay**: It receives the incoming JSON network telemetry from the React Native app.
- **Dynamic Port Binding**: If multiple projects are open, the server increments the port (e.g., `8347`, `8348`) to ensure complete isolation between environments.

### 3. The Webview UI (`network.html` & `networkPanelProvider.ts`)
The extension visualizes the data inside a native VS Code Webview Panel.
- **Interactive Grid**: A structured list of all requests, color-coded by HTTP status codes (200=Green, 4xx/5xx=Red).
- **Split-Pane Viewer**: Clicking a request opens a detailed side-pane featuring request headers, response headers, and the response body.
- **Syntax Highlighting**: JSON responses are automatically parsed and syntax-highlighted for readability.

---

## 🔒 Security & Performance
- **Localhost Only**: The WebSocket server strictly binds to `127.0.0.1` / `localhost`, ensuring that network traffic never leaves the local development machine.
- **Zero Dependencies**: The interceptor snippet uses raw `XMLHttpRequest` overriding, requiring absolutely no npm dependencies to be installed in the mobile application.
- **Garbage Collection Safety**: The webview enforces a maximum limit of 500 requests to prevent DOM bloat and memory leaks within the VS Code Extension Host.
