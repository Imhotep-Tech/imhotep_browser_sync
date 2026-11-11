# Imhotep Browser Sync — Chrome Web Store Listing & Distribution Metadata

## 1. Store Header Metadata

* **Extension Name**: Imhotep Browser Sync
* **Short Pitch / Tagline (132 chars max)**:
  100% Peer-to-Peer browser sync for history and extensions. Direct device-to-device WebRTC DataChannels. No account, no servers.
* **Category**: Productivity & Privacy Tools
* **Primary Language**: English (United States)
* **Website URL**: https://imhotep.tech/browser-sync
* **Support Email**: support@imhotep.tech
* **License**: Apache 2.0 (Open Source)

---

## 2. Store Promotional Copy

### Short Taglines
* *"The architect of your private web telemetry."*
* *"100% Peer-to-Peer. Zero Servers. No Account Required."*
* *"Sync your history and extensions freely across Helium, Chrome, Brave, and Android."*

### Feature Bullets for Store Search
* 🌐 **100% Peer-to-Peer Architecture**: Direct device-to-device streaming via WebRTC DataChannels. No servers, no logins, no cloud storage.
* ⚡ **Instant QR & Mnemonic Pairing**: Connect devices in seconds using an ephemeral QR code or a human-readable 12-word pairing phrase.
* 🧩 **1-Click Extension Gallery**: Keep an accurate inventory of installed extensions across devices and reinstall them on fresh browsers with a single click.
* 📱 **True Android Cross-Platform Support**: Works seamlessly on Helium Browser, Chrome, Brave, Edge, and Android (Kiwi Browser, Lemur Browser).
* 🛡️ **Zero-Leakage Privacy Filters**: Never captures or synchronizes Incognito tabs, internal pages (`chrome://`), or localhost development addresses.
* 🚀 **Featherweight Antigravity UI**: Pure vanilla TypeScript + Tailwind CSS (~60KB package). Zero lag, instant popup response.

---

## 3. Full Store Description (Markdown & Plain Text Format)

```markdown
Imhotep Browser Sync is the open-source, 100% Peer-to-Peer synchronization engine designed for users who value complete digital sovereignty. Named after the legendary architect Imhotep, this extension bridges your browsing experience across desktop and mobile devices with zero server dependence.

Unlike proprietary browser sync engines that ingest and catalog your web navigation habits on remote corporate servers, Imhotep ensures that your browsing data NEVER touches a central server. All data streams directly from device to device over encrypted WebRTC DataChannels.

==================================================
100% DIRECT P2P WEBRTC SYNCHRONIZATION
==================================================

- Zero Servers, Zero Logins: No email, no password, no account required.
- Instant Device Pairing: Pair devices effortlessly using an ephemeral QR code or a 12-word BIP-39 mnemonic phrase.
- Direct Device-to-Device Streaming: Browsing history and extension lists stream straight between your devices over WebRTC DataChannels (secured via DTLS-SRTP).
- Ephemeral Footprint: When sync completes, nothing is left behind on any server because there is no server.

==================================================
KEY CAPABILITIES
==================================================

- Real-Time History Sync: Automatically captures and synchronizes browsed tabs, URLs, and page titles with intelligent micro-batching.
- Extension Manager & 1-Click Reinstall: Keeps an accurate inventory of your installed extensions. When setting up a new computer or mobile browser, browse your extension list and reinstall directly from the Chrome Web Store with 1 click.
- Strict Sandbox Filter: Never captures or syncs Incognito windows, internal pages (chrome://, helium://), or localhost development ports (127.0.0.1).
- Universal Browser Compatibility:
  * Helium Browser (optimized performance and native feel)
  * Google Chrome, Brave Browser, Microsoft Edge, Vivaldi, Arc
  * Android Mobile: Kiwi Browser and Lemur Browser

==================================================
PRIVACY & PERMISSIONS
==================================================

- No Host Permissions Required: Imhotep does not require access to all website traffic (*://*/*).
- Transparent & Auditable: 100% open source under the Apache 2.0 License. Inspect every line of code on GitHub!

Take back control of your web history. Install Imhotep Browser Sync today.
```

---

## 4. Privacy Practices & Permissions Disclosure for Chrome Web Store Reviewers

| Permission Requested | Why It Is Required |
| :--- | :--- |
| `history` | To read local history visits via `chrome.history.onVisited` and ingest remote synced entries into the browser history via `chrome.history.addUrl`. |
| `storage` | To persist local device identity, user settings, and peer connection states in `chrome.storage.local`. |
| `management` | To inspect installed extensions via `chrome.management.getAll` for building the extension sync inventory and facilitating 1-click reinstalls. |
| `alarms` | To periodically trigger micro-batch flush queues and peer keepalives. |
| `notifications` | To notify the user when a P2P device pair handshake completes. |
| `unlimitedStorage` | To allow offline buffering of sync batches without arbitrary 5MB local quota boundaries. |

> [!NOTE]
> **Zero Host Permissions**: Imhotep Browser Sync requests **no host permissions**. It communicates purely via WebRTC DataChannels using standard STUN NAT traversal.

### Single Purpose Declaration
"Imhotep Browser Sync provides peer-to-peer synchronization of browser history and installed extension lists across desktop and mobile browsers."
