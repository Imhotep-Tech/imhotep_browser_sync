# Security Policy & Cryptographic Architecture

Imhotep Browser Sync is engineered from the ground up with a strict **Zero-Server, 100% Peer-to-Peer** security model. Your personal web telemetry—including browsed history, page titles, visit frequencies, and extension configurations—streams directly between your devices over WebRTC DataChannels and never touches any application server.

---

## 1. Cryptographic & Transport Architecture

### Transport Security: WebRTC DTLS-SRTP
All peer-to-peer data channels are secured natively using Datagram Transport Layer Security (DTLS):

* **Transport**: WebRTC `RTCDataChannel`
* **Handshake**: DTLS handshake with self-signed, ephemeral ECDSA certificates generated in the browser sandbox
* **Symmetric Encryption on Wire**: AES-128-GCM / AES-256-GCM cipher suites enforced by the browser's WebRTC implementation
* **NAT Traversal**: Standard public STUN servers (`stun:stun.l.google.com:19302`) are utilized solely for ICE candidate reflexive address discovery; application payload data **never** traverses the STUN server

### Application-Layer Cryptography: Web Crypto API
For ephemeral pairing and message verification, Imhotep utilizes the browser's native `crypto.subtle` API:

* **Key Derivation**: PBKDF2 (`PBKDF2-HMAC-SHA256`) with `100,000` iterations
* **Cipher**: `AES-256-GCM` with unique 12-byte cryptographically secure random IVs per batch
* **Integrity**: 128-bit authentication tags verify message authenticity before ingestion

```mermaid
flowchart TD
    subgraph DeviceA ["Device A (Local Browser Sandbox)"]
        RawA["Plaintext History / Extensions"]
        BatchA["Micro-Batching Buffer (Debounced)"]
        RTCA["WebRTC DataChannel Engine"]
        
        RawA --> BatchA --> RTCA
    end

    subgraph DirectWire ["Direct Encrypted P2P Wire"]
        RTCA <==== "Encrypted DataChannel (DTLS-SRTP)" ====> RTCB
    end

    subgraph DeviceB ["Device B (Peer Browser Sandbox)"]
        RTCB["WebRTC DataChannel Engine"]
        IngestB["chrome.history.addUrl()<br/>Extension Cache"]
        
        RTCB --> IngestB
    end
```

---

## 2. Threat Model & Security Boundaries

### Protected Assets
1. **Browsing History**: URLs, titles, visit timestamps, and transition qualifiers.
2. **Extension Catalog**: Extension IDs, enabled states, display names, and installation parameters.
3. **Device Identifiers**: Device nicknames and ephemeral pairing tokens.

### Security Guarantees
* **Zero Server Attack Surface**: Because there is no backend database, cloud storage, or authentication server, there is no remote server to breach or compromise.
* **Ephemeral Pairing**: Pairing tokens and QR codes are ephemeral and rotated on demand.
* **Memory Isolation**: Cryptographic handles are kept strictly in transient memory in the Chrome MV3 background service worker and are cleared when the session terminates.
* **Exclusion Sandbox**: System URLs (`chrome://`, `edge://`, `about:`, `file://`), extension pages (`chrome-extension://`), local development addresses (`localhost`, `127.0.0.1`), and Incognito/Private browsing tabs are permanently blocked from capture at the service worker hook level.
* **Zero Host Permissions**: Imhotep does not require `*://*/*` or broad domain permissions.

---

## 3. Supported Versions

| Version | Supported | Security Maintenance |
| :--- | :---: | :--- |
| `1.0.x` (MV3) | :white_check_mark: | Active vulnerability monitoring & patches |
| `< 1.0.0` | :x: | Deprecated |

---

## 4. Reporting a Vulnerability

We deeply appreciate the efforts of the global security research community in identifying vulnerabilities responsibly.

If you believe you have discovered a vulnerability in Imhotep Browser Sync:

1. **Email Us**: Send a report to `security@imhotep.tech`.
2. **Do Not Open Public Issues**: Please refrain from opening public GitHub issues, discussions, or social media posts until we have coordinated a fix.
3. **Include Reproduction Steps**:
   - Manifest/browser version (e.g., Helium, Chrome, Kiwi Android).
   - Step-by-step reproduction instructions or proof-of-concept (PoC).
   - Potential impact evaluation.

### Response SLA & Safe Harbor
* **Acknowledgement**: Within 24 hours of report receipt.
* **Triage & Assessment**: Within 48 hours.
* **Remediation & Patch Deployment**: Critical flaws patched within 72 hours and released via emergency extension updates.
* **Safe Harbor**: Imhotep Tech will not pursue legal action against security researchers who conduct testing in good faith, avoid privacy violations, do not destroy data, and adhere to responsible disclosure timelines.
