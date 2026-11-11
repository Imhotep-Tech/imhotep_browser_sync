# AGENTS.md — AI Agent Guidance for Imhotep Browser Sync 🏛️🤖

Welcome, AI Agent! This document is your comprehensive operational guide for understanding, maintaining, extending, and architecting new features in **Imhotep Browser Sync** (`imhotep_browser_sync`).

---

## 1. Project Mission & Core Invariants

**Imhotep Browser Sync** (by [Imhotep Tech](https://imhotep.tech)) is an open-source, **100% Peer-to-Peer (P2P)**, zero-server Chromium extension (Manifest V3) that synchronizes browsing telemetry and extensions across desktop and mobile browsers.

### Non-Negotiable Invariants:
1. **100% Serverless / P2P Only**:
   - Never introduce centralized cloud storage, remote databases, or backend auth servers.
   - All data exchange must occur directly device-to-device via WebRTC DataChannels (`RTCDataChannel`).
   - Standard public STUN (`stun:stun.l.google.com:19302`) is strictly used for NAT traversal / ICE candidate discovery. No data payloads traverse STUN.
2. **Zero Host Permissions**:
   - `manifest.json` and `public/manifest.json` MUST keep `host_permissions: []`.
   - Do not request `*://*/*` or broad domain permissions. This guarantees rapid Chrome Web Store approval and protects user privacy.
3. **No Heavy UI Frameworks**:
   - The popup is built with **Vanilla TypeScript + Tailwind CSS** (~60KB production zip bundle).
   - Do NOT add React, Vue, Svelte, or Angular. The UI must launch instantly (under 50ms) on low-spec Android devices (Kiwi / Lemur).
4. **Zero Secrets in Code**:
   - Never commit API keys, tokens, or private credentials.
5. **Strict Privacy Filters**:
   - Never capture or sync Incognito visits, internal schemes (`chrome://`, `helium://`, `edge://`, `brave://`, `about:`, `file://`), or loopback addresses (`localhost`, `127.0.0.1`, `[::1]`).

---

## 2. Technology Stack & Directory Architecture

```
imhotep_browser_sync/
├── AGENTS.md                   # You are here! AI Agent instructions & feature playbooks
├── README.md                   # Public repository documentation
├── CONTRIBUTING.md             # Open-source human developer guidelines
├── SECURITY.md                 # WebRTC DTLS security & cryptographic specifications
├── PRIVACY.md                  # Zero-server privacy charter
├── docs/
│   └── STORE_LISTING.md        # Chrome Web Store metadata & store copy
├── public/
│   ├── manifest.json           # Base MV3 extension manifest
│   └── icons/                  # Cyber-Egyptian telemetry icons (16, 48, 128, 512 SVG)
├── scripts/
│   └── package.js              # Production ZIP builder for Chrome Web Store / Android
├── src/
│   ├── types/
│   │   └── sync.ts             # Canonical single source of truth for all types & protocols
│   ├── crypto/
│   │   └── e2ee.ts             # Web Cryptography API (PBKDF2 + AES-256-GCM)
│   ├── p2p/
│   │   ├── webrtc.ts           # WebRTC DataChannel connection & signaling manager
│   │   ├── mnemonic.ts         # BIP-39 12-word pairing phrase derivation & validation
│   │   ├── qr.ts               # Canvas-based QR code rendering
│   │   └── wordlist.ts         # BIP-39 standard English dictionary (2048 words)
│   ├── background/
│   │   └── service-worker.ts   # MV3 service worker (history listener, debounce buffer, P2P mesh)
│   └── popup/
│       ├── index.html          # Glassmorphic Antigravity popup UI markup
│       ├── popup.css           # Tailwind styling & custom glassmorphic classes
│       └── popup.ts            # Vanilla TypeScript DOM state & event handlers
```

---

## 3. Communication Model & Data Flow

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Popup UI (src/popup/)                           │
│  - User triggers pairing, views history, triggers 1-click reinstalls   │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                   chrome.runtime.sendMessage(...)
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                Background Service Worker (src/background/)             │
│  - History onVisited listener (debounced buffer)                       │
│  - Extension management (chrome.management.getAll)                     │
│  - Local storage cache (chrome.storage.local)                          │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                     WebRTC DataChannel Streaming
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      Remote Peer Browser Device                        │
│  - Receives P2P data batch                                             │
│  - Ingests visits via chrome.history.addUrl()                          │
│  - Caches remote extensions in imhotep_p2p_remote_extensions           │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Playbooks: How to Add Common Features

### Playbook A: Adding a New Syncable Data Type (e.g. Bookmarks, Open Tabs, Reading List)

1. **Define Types (`src/types/sync.ts`)**:
   - Add your data structure (e.g., `BookmarkSyncItem` or `TabSyncItem`).
   - Add new message actions to `RuntimeMessage` (e.g., `'GET_BOOKMARKS' | 'SYNC_BOOKMARKS_NOW'`).
   - Update `P2PMessagePayload` to include your new batch type (e.g., `type: 'bookmarks'` with `items: BookmarkSyncItem[]`).

2. **Add Listener / Capture in Service Worker (`src/background/service-worker.ts`)**:
   - Add corresponding Chrome API listeners (e.g. `chrome.bookmarks.onCreated`).
   - Filter out internal / private URLs using existing exclusion helpers.
   - Buffer items and include them in `flushBufferToP2P()`.
   - In `handleIncomingP2PBatch()`, ingest incoming remote items (e.g. `chrome.bookmarks.create()`).

3. **Expose to Popup UI (`src/popup/`)**:
   - In `src/popup/index.html`: Add a navigation tab button and a corresponding `<section id="view-YOUR_FEATURE" class="view-panel hidden ...">`.
   - In `src/popup/popup.ts`:
     - Add the tab key to `PopupLocalState['activeTab']`.
     - Implement rendering and search/filter functions.
     - Add listeners in `setupEventListeners()` and trigger initialization in `init()`.

4. **Verify Build & Bundle**:
   - Run `npm run build`.
   - Run `npm run package`.

---

### Playbook B: Adding a New P2P Signaling Transport (e.g. Local LAN Multicast / Soundwave Pairing)

1. Check `src/p2p/webrtc.ts`:
   - `WebRTCP2PClient` handles SDP offers, answers, and ICE candidate exchange.
   - Any new signaling mechanism simply needs to serialize the handshake payload and pass it to `acceptRemoteSignal()`.
2. Do not introduce central WebSocket servers; prefer QR codes, clipboard tickets, LAN mDNS/multicast, or direct copy-paste.

---

### Playbook C: Enhancing Antigravity UI Components

- Use Tailwind utility classes with glassmorphic tokens:
  - Cards: `bg-slate-900/60 backdrop-blur-md border border-slate-800/80 rounded-xl`
  - Accent / Gold: `text-amber-400`, `border-amber-400`, `bg-amber-500/20`
  - Cyan / Telemetry: `text-cyan-400`, `border-cyan-500/30`, `bg-cyan-950/60`
  - Tactile buttons: Include `btn-tactile` class for micro-press animations.
- Ensure all interactive elements have responsive touch targets for mobile Chrome / Kiwi Browser on Android.

---

## 5. Development & Verification Workflow

Always verify your changes before committing:

```bash
# 1. Type-checking & Build
npm run build

# 2. Package for Distribution
npm run package

# 3. Test extension unpacked
# Load the 'dist/' directory in chrome://extensions or helium://extensions
```

### Git Conventions:
- Follow Conventional Commits: `feat(...)`, `fix(...)`, `refactor(...)`, `docs(...)`, `perf(...)`.
- Keep changes modular and focused.

---

## 6. Security & Audit Checklist for AI Agents

Before submitting any code change, verify:
- [ ] No remote servers, cloud databases, or analytics endpoints were introduced.
- [ ] No `host_permissions` were added to `manifest.json` or `public/manifest.json`.
- [ ] No sensitive keys or secrets were hardcoded.
- [ ] `npm run build` passes with zero TypeScript warnings or errors.
- [ ] `npm run package` successfully produces `imhotep-browser-sync.zip` (< 100KB).
- [ ] Relevant documentation (`README.md`, `AGENTS.md`) is kept up-to-date.
