# Imhotep Browser Sync — Chrome Web Store Listing & Distribution Metadata

## 1. Store Header Metadata

* **Extension Name**: Imhotep Browser Sync
* **Short Pitch / Tagline (132 chars max)**:
  Zero-knowledge E2EE sync for your browser history and extensions. Direct P2P WebRTC or encrypted Cloud Vault across all devices.
* **Category**: Productivity & Privacy Tools
* **Primary Language**: English (United States)
* **Website URL**: https://imhotep.tech/browser-sync
* **Support Email**: support@imhotep.tech
* **License**: Apache 2.0 (Open Source)

---

## 2. Store Promotional Copy

### Short Taglines
* *"The architect of your private web telemetry."*
* *"End-to-End Encrypted. Zero-Knowledge. No Account Required."*
* *"Sync your history and extensions freely across Helium, Chrome, and Android."*

### Feature Bullets for Store Search
* 🛡️ **Zero-Knowledge Encryption**: PBKDF2-HMAC-SHA256 key derivation + military-grade AES-256-GCM authenticated cipher.
* ⚡ **Direct P2P WebRTC Sync**: Sync between devices instantly without any server middleman. No signup, no email, no cloud footprint.
* ☁️ **Encrypted Cloud Vault (Optional)**: Seamless multi-device synchronization and disaster recovery powered by Supabase with Row-Level Security.
* 🧩 **1-Click Extension Gallery**: Keep an encrypted inventory of your extensions and reinstall them on new devices or Android browsers with a single click.
* 📱 **True Android Cross-Platform Support**: Works out of the box on Helium Browser, Desktop Chrome, Brave, Edge, Kiwi Browser, and Lemur Browser.
* 🚀 **Featherweight Antigravity UI**: Pure vanilla TypeScript + Tailwind CSS design (~60KB package). Zero lag, instant launch.

---

## 3. Full Store Description (Markdown & Plain Text Format)

```markdown
Imhotep Browser Sync is the open-source, zero-knowledge synchronization engine designed for users who value complete digital sovereignty. Named after the legendary architect Imhotep, this extension bridges your browsing experience across desktop and mobile devices with mathematical privacy guarantees.

Unlike proprietary browser sync engines that ingest and catalog your web navigation habits on remote corporate servers, Imhotep ensures that your plaintext browsing history and extension inventory NEVER leave your local browser sandbox unencrypted.

==================================================
TWO SYNCHRONIZATION ENGINES IN ONE EXTENSION
==================================================

1. DIRECT P2P WEBRTC (DEFAULT - NO CLOUD REQUIRED)
   - Pair devices instantly using ephemeral QR codes or human-readable 12-word mnemonic phrases.
   - Stream history and extensions directly device-to-device over encrypted WebRTC DataChannels (DTLS-SRTP).
   - Zero servers, zero databases, zero accounts. When your sync completes, no remote trace remains.

2. ZERO-KNOWLEDGE CLOUD VAULT (MULTI-DEVICE DISASTER RECOVERY)
   - For users who want background cross-device synchronization even when devices are not online simultaneously.
   - All records are encrypted locally with AES-256-GCM before transmission.
   - The remote Supabase PostgreSQL vault stores only random IVs and encrypted ciphertext. Database administrators cannot read your data even if they try.
   - Automated rolling 90-day retention keeps your storage footprint minimal.

==================================================
KEY CAPABILITIES
==================================================

- Real-Time History Sync: Automatically captures and synchronizes browsed tabs, URLs, and page titles with intelligent micro-batching.
- Extension Manager & 1-Click Reinstall: Keeps an accurate inventory of your installed extensions. When setting up a new computer or mobile browser, browse your extension list and reinstall directly from the Chrome Web Store with 1 click.
- Strict Sandbox Filter: Never captures or syncs Incognito windows, internal pages (chrome://, helium://), or localhost development ports (127.0.0.1).
- Universal Browser Compatibility:
  * Helium Browser (native feel and optimized performance)
  * Google Chrome, Brave Browser, Microsoft Edge, Vivaldi, Arc
  * Android Mobile: Kiwi Browser and Lemur Browser

==================================================
MATHEMATICAL PRIVACY & SECURITY SPECIFICATIONS
==================================================

- Key Derivation: PBKDF2 with 100,000 SHA-256 iterations and unique 16-byte cryptographically secure random salt.
- Authenticated Cipher: AES-256-GCM with fresh 12-byte random IVs per micro-batch.
- Transparent & Auditable: 100% open source under the Apache 2.0 License. Inspect every line of code on GitHub!

Take back control of your web history. Install Imhotep Browser Sync today.
```

---

## 4. Privacy Practices & Permissions Disclosure for Chrome Web Store Reviewers

| Permission Requested | Why It Is Required |
| :--- | :--- |
| `history` | To read local history visits via `chrome.history.onVisited` and ingest remote synced entries into the browser history via `chrome.history.addUrl`. |
| `storage` | To persist local encrypted vault keys, user settings, and peer connection states in `chrome.storage.local`. |
| `management` | To inspect installed extensions via `chrome.management.getAll` for building the encrypted extension sync inventory and facilitating 1-click reinstalls. |
| `alarms` | To periodically trigger micro-batch flush queues and automated rolling cache purges. |
| `notifications` | To notify the user when a P2P device pair handshake completes or remote sync conflict occurs. |
| `unlimitedStorage` | To allow offline buffering of encrypted sync batches without arbitrary 5MB local quota boundaries. |
| Host Permissions (`*://*.supabase.co/*`) | To enable WebSocket Realtime subscriptions and authenticated REST API sync with the user's Supabase Cloud Vault. |

### Single Purpose Declaration
"Imhotep Browser Sync provides peer-to-peer and zero-knowledge encrypted cloud synchronization of browser history and installed extension lists across desktop and mobile browsers."
