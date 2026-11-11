# Privacy Policy

**Effective Date**: November 2026  
**Publisher**: Imhotep Tech (Open-Source Project)

Imhotep Browser Sync is built on an uncompromising principle: **your browsing activity belongs solely to you**. We believe true digital privacy requires mathematical certainty, not just policy promises.

---

## 1. Core Privacy Tenets

* **Zero Tracking & Zero Telemetry**: We do not collect analytics, telemetry metrics, session recordings, IP logs, or diagnostic reports. We do not embed Google Analytics, Sentry, Mixpanel, Segment, or any remote tracking SDK.
* **No Advertisements or Data Monetization**: We will never sell, rent, monetize, or broker your browsing habits or extension inventory to data brokers, advertisers, or artificial intelligence training crawlers.
* **Client-Side Zero-Knowledge**: All synchronizable records (history URLs, timestamps, titles, installed extensions) are encrypted on your local machine using PBKDF2-derived AES-256-GCM encryption before transmission.
* **No Plaintext Remote Storage**: Neither Imhotep Tech, Supabase, nor any network intermediary possesses the mathematical ability to inspect your synchronized records.

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
* **Form Inputs, Passwords & Cookies**: Imhotep does not inspect keystrokes, form submissions, session tokens, or cookie jars.

---

## 3. Storage & Transmission Modes

### Mode A: Direct P2P WebRTC (Default Mode)
* Devices communicate directly over an encrypted peer-to-peer DataChannel (`DTLS-SRTP`).
* No central server stores your data at any time.
* Standard public STUN servers are used solely to establish peer ICE candidates; no payload traverses STUN.

### Mode B: Cloud Vault (Supabase Backend)
* When you opt into Cloud Vault synchronization for multi-device disaster recovery, your encrypted ciphertext is synchronized through a PostgreSQL database hosted on Supabase with strict Row-Level Security (RLS).
* Only your authenticated account can retrieve your encrypted rows.
* Rows contain solely random IVs and encrypted binary blobs.
* Default retention policy: Rolling 90-day automated purge keeps your cloud footprint lightweight and ephemeral.

---

## 4. User Rights & Data Autonomy

You maintain complete sovereignty over your data:
1. **Instant Purge**: You can wipe all remote vault records at any time with a single click inside the popup settings.
2. **Key Invalidation**: Changing your master password immediately renders previously stored cloud payloads cryptographically undecryptable.
3. **Local Removal**: Uninstalling the extension removes all local caching, keys, and settings from `chrome.storage.local`.

---

## 5. Contact

For inquiries regarding this privacy policy or our open-source privacy architecture, visit [https://github.com/imhotep-tech/imhotep_browser_sync](https://github.com/imhotep-tech/imhotep_browser_sync) or contact `privacy@imhotep.tech`.
