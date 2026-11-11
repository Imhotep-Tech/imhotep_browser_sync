# Privacy Policy

**Effective Date**: November 2026  
**Publisher**: Imhotep Tech (Open-Source Project)

Imhotep Browser Sync is built on an uncompromising principle: **your browsing activity belongs solely to you**. We believe true digital privacy requires structural certainty: removing servers entirely.

---

## 1. Core Privacy Tenets

* **100% Peer-to-Peer**: All data exchange occurs directly device-to-device. No central server ever receives, relays, processes, or stores your browsing history or extensions.
* **Zero Tracking & Zero Telemetry**: We do not collect analytics, telemetry metrics, session recordings, IP logs, or crash reports. We do not embed Google Analytics, Sentry, Mixpanel, or any tracking SDK.
* **No Advertisements or Data Monetization**: We will never sell, rent, monetize, or broker your browsing data to data brokers, advertisers, or third parties.
* **Zero Account Requirement**: No email, no password, no phone number, and no user profile are required to use the extension.

---

## 2. Information Handled & Technical Scope

### What Imhotep Sync Processes Locally
* **Browser History**: URLs and page titles captured via the Chrome MV3 History API (`chrome.history.onVisited`).
* **Extension Inventory**: Extension identifiers, names, and enabled statuses retrieved via `chrome.management.getAll()`.

### What Is Strictly Filtered & Ignored
Our background service worker automatically discards and prevents synchronization of:
* **Incognito & Private Windows**: Any navigation occurring within an Incognito context is immediately ignored.
* **Internal Browser Schemes**: `chrome://`, `chrome-extension://`, `edge://`, `brave://`, `about:`, and `view-source:`.
* **Localhost & Intranet Addresses**: `http://localhost`, `http://127.0.0.1`, `http://[::1]`, and private RFC1918 subnets.
* **Form Inputs, Passwords & Cookies**: Imhotep does not inspect keystrokes, form submissions, session tokens, or cookies.

---

## 3. Data Transmission & Retention

* **Transmission**: Sync data is transmitted directly peer-to-peer across your paired devices over encrypted WebRTC DataChannels (`DTLS-SRTP`).
* **STUN Signaling**: Standard public STUN servers are used solely for ICE candidate address discovery (NAT traversal). No sync payload ever passes through STUN.
* **Retention**: Ephemeral. There is no remote database. Data exists only on your local devices in your browser's native history and extension storage.

---

## 4. User Rights & Data Autonomy

You maintain complete sovereignty over your data:
1. **Instant Disconnect**: You can disconnect all peers and clear local session state with a single click inside the popup settings.
2. **Local Removal**: Uninstalling the extension completely removes all extension cache and settings from `chrome.storage.local`.

---

## 5. Contact

For inquiries regarding this privacy policy or our open-source privacy architecture, visit [https://github.com/imhotep-tech/imhotep_browser_sync](https://github.com/imhotep-tech/imhotep_browser_sync) or contact `privacy@imhotep.tech`.
