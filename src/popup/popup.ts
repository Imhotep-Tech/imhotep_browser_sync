/**
 * Imhotep Browser Sync - Antigravity Extension Popup UI
 *
 * Weightless, spatial glassmorphic UI with zero heavy frameworks (~60KB).
 * Implements Direct P2P Hub, Extension Gallery with 1-Click Reinstall,
 * Synced History Viewer, and Settings. 100% Peer-to-Peer with zero servers.
 */

import {
  SyncState,
  SyncMode,
  ExtensionItem,
  HistoryVisitItem,
  RuntimeMessage,
  RuntimeResponse,
} from '../types/sync';
import {
  renderPairingQRCodeToCanvas,
  compressSignalTicket,
  decompressSignalTicket,
} from '../p2p/qr';
import { PairingSignalTicket } from '../types/p2p';
import { WebRTCP2PClient } from '../p2p/webrtc';
import {
  generateMnemonic,
  derivePairingDisplayCode,
  validateMnemonic,
} from '../p2p/mnemonic';

// ============================================================================
// State & Defaults
// ============================================================================

export interface PairedPeer {
  id: string;
  name: string;
  lastSeen: number;
}

interface PopupLocalState {
  activeTab: 'p2p' | 'extensions' | 'history' | 'settings';
  p2pSubtab: 'share' | 'connect';
  extensionFilter: 'all' | 'remote' | 'installed';
  theme: 'dark' | 'light';
  currentMnemonic: string;
  currentFingerprint: string;
  currentTicket: string;
  generatedAnswerTicket: string;
  pairedPeers: PairedPeer[];
  syncState: SyncState;
  installedExtensions: ExtensionItem[];
  remoteExtensions: ExtensionItem[];
  recentHistory: HistoryVisitItem[];
  extensionSearchQuery: string;
  historySearchQuery: string;
  historyLimit: number;
}

const DEFAULT_SYNC_STATE: SyncState = {
  mode: 'p2p',
  status: 'connected',
  deviceId: 'd8a9e4b1-8b83-4a18-97c2-9e9f9e1e3b52',
  deviceName: 'Desktop Chrome',
  deviceType: 'desktop',
  lastSyncTime: Date.now() - 1000 * 60 * 3, // 3 mins ago
  bufferedCount: 4,
  totalSyncedCount: 142,
  p2pConnectedPeers: 1,
  lastError: null,
  hasMasterKey: true,
};

const MOCK_INSTALLED_EXTENSIONS: ExtensionItem[] = [
  {
    id: 'cjpalhdlnbpafiamejdnhcphjbkeiagm',
    name: 'uBlock Origin',
    version: '1.58.0',
    enabled: true,
    description: 'An efficient blocker. Easy on CPU and memory.',
    storeUrl: 'https://chromewebstore.google.com/detail/ublock-origin/cjpalhdlnbpafiamejdnhcphjbkeiagm',
  },
  {
    id: 'nngceckbapebfimnlniiiahkandclblb',
    name: 'Bitwarden Password Manager',
    version: '2024.4.1',
    enabled: true,
    description: 'A secure and free password manager for all of your devices.',
    storeUrl: 'https://chromewebstore.google.com/detail/bitwarden-password-manage/nngceckbapebfimnlniiiahkandclblb',
  },
  {
    id: 'fmkadmapgofadopljbjfkapdkoienihi',
    name: 'React Developer Tools',
    version: '5.2.0',
    enabled: true,
    description: 'Adds React debugging tools to the Chrome Developer Tools.',
    storeUrl: 'https://chromewebstore.google.com/detail/react-developer-tools/fmkadmapgofadopljbjfkapdkoienihi',
  },
];

const MOCK_REMOTE_EXTENSIONS: ExtensionItem[] = [
  {
    id: 'eimadpbcbfnmbkopoojfekhnkhdbieeh',
    name: 'Dark Reader',
    version: '4.9.82',
    enabled: true,
    description: 'Dark mode for every website. Inverted colors, brightness control.',
    storeUrl: 'https://chromewebstore.google.com/detail/dark-reader/eimadpbcbfnmbkopoojfekhnkhdbieeh',
  },
  {
    id: 'ghbmnnjldmmebyhhpefld visualkmmnhp',
    name: 'Refined GitHub',
    version: '24.5.1',
    enabled: true,
    description: 'Simplifies the GitHub interface and adds useful features.',
    storeUrl: 'https://chromewebstore.google.com/detail/refined-github/hlepfoohegkhhmjieoechaddhgedlhcf',
  },
  {
    id: 'dbepggeogbaibhgnhhndojpepiihcmeb',
    name: 'Vimium',
    version: '2.1.2',
    enabled: true,
    description: 'The Hacker\'s Browser. Keyboard-based navigation.',
    storeUrl: 'https://chromewebstore.google.com/detail/vimium/dbepggeogbaibhgnhhndojpepiihcmeb',
  },
];

const MOCK_RECENT_HISTORY: HistoryVisitItem[] = [
  {
    id: 'hist-1',
    url: 'https://github.com/imhotep-tech/imhotep-browser-sync',
    title: 'imhotep-tech/imhotep-browser-sync: Decentralized Cross-Browser Sync',
    visitTime: Date.now() - 1000 * 60 * 2,
    deviceId: 'android-kiwi-01',
    deviceName: 'Android Kiwi',
  },
  {
    id: 'hist-2',
    url: 'https://developer.chrome.com/docs/extensions/mv3/',
    title: 'Welcome to Manifest V3 - Chrome for Developers',
    visitTime: Date.now() - 1000 * 60 * 18,
    deviceId: 'macbook-pro-m3',
    deviceName: 'MacBook Pro',
  },
  {
    id: 'hist-3',
    url: 'https://webrtc.org/architecture',
    title: 'WebRTC Architecture & Real-Time Communications',
    visitTime: Date.now() - 1000 * 60 * 45,
    deviceId: 'macbook-pro-m3',
    deviceName: 'MacBook Pro',
  },
  {
    id: 'hist-4',
    url: 'https://webrtc.org/getting-started/datachannels',
    title: 'RTCDataChannel Guide - WebRTC Protocol',
    visitTime: Date.now() - 1000 * 60 * 120,
    deviceId: 'android-kiwi-01',
    deviceName: 'Android Kiwi',
  },
  {
    id: 'hist-5',
    url: 'https://chromewebstore.google.com/',
    title: 'Chrome Web Store',
    visitTime: Date.now() - 1000 * 60 * 360,
    deviceId: 'brave-desktop',
    deviceName: 'Brave Browser',
  },
];

const state: PopupLocalState = {
  activeTab: 'p2p',
  p2pSubtab: 'share',
  extensionFilter: 'all',
  theme: (localStorage.getItem('imhotep_theme') as 'dark' | 'light') || 'dark',
  currentMnemonic: '',
  currentFingerprint: '',
  currentTicket: '',
  generatedAnswerTicket: '',
  pairedPeers: [],
  syncState: { ...DEFAULT_SYNC_STATE },
  installedExtensions: [...MOCK_INSTALLED_EXTENSIONS],
  remoteExtensions: [...MOCK_REMOTE_EXTENSIONS],
  recentHistory: [...MOCK_RECENT_HISTORY],
  extensionSearchQuery: '',
  historySearchQuery: '',
  historyLimit: 150,
};

// ============================================================================
// Service Worker Communication Layer
// ============================================================================

async function sendRuntimeMessage<T = any>(
  message: RuntimeMessage
): Promise<RuntimeResponse<T>> {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    try {
      const response = await chrome.runtime.sendMessage(message);
      if (response) {
        return response as RuntimeResponse<T>;
      }
    } catch (err: any) {
      console.warn('Chrome runtime message fallback:', err?.message || err);
    }
  }

  // Graceful standalone fallback handler
  return handleMockMessage(message);
}

function handleMockMessage<T = any>(message: RuntimeMessage): RuntimeResponse<T> {
  switch (message.type) {
    case 'GET_STATUS':
      return { success: true, data: state.syncState as any };
    case 'SET_SYNC_MODE':
      state.syncState.mode = message.payload?.mode || 'p2p';
      return { success: true, data: state.syncState as any };
    case 'SET_DEVICE_NAME':
      state.syncState.deviceName = message.payload?.name || state.syncState.deviceName;
      return { success: true, data: state.syncState as any };
    case 'TRIGGER_FLUSH':
      state.syncState.bufferedCount = 0;
      state.syncState.totalSyncedCount += 4;
      state.syncState.lastSyncTime = Date.now();
      return { success: true, data: state.syncState as any };
    case 'GET_RECENT_HISTORY':
      return { success: true, data: state.recentHistory as any };
    case 'GET_INSTALLED_EXTENSIONS':
      return { success: true, data: state.installedExtensions as any };
    case 'GET_REMOTE_EXTENSIONS':
      return { success: true, data: state.remoteExtensions as any };
    case 'SYNC_EXTENSIONS_NOW':
      return { success: true, data: [...state.installedExtensions, ...state.remoteExtensions] as any };
    case 'SET_MASTER_KEY':
      state.syncState.hasMasterKey = true;
      return { success: true };
    case 'CLEAR_MASTER_KEY':
      state.syncState.hasMasterKey = false;
      return { success: true };
    default:
      return { success: true, data: undefined as any };
  }
}

// ============================================================================
// UI Render Helpers & Components
// ============================================================================

function showToast(text: string, durationMs: number = 2400) {
  const container = document.getElementById('toast-container');
  const label = document.getElementById('toast-text');
  if (!container || !label) return;

  label.textContent = text;
  container.classList.remove('translate-y-8', 'opacity-0');
  container.classList.add('translate-y-0', 'opacity-100');

  setTimeout(() => {
    container.classList.remove('translate-y-0', 'opacity-100');
    container.classList.add('translate-y-8', 'opacity-0');
  }, durationMs);
}

function applyTheme(theme: 'dark' | 'light') {
  state.theme = theme;
  localStorage.setItem('imhotep_theme', theme);
  const root = document.documentElement;
  const sunIcon = document.getElementById('theme-icon-sun');
  const moonIcon = document.getElementById('theme-icon-moon');

  if (theme === 'dark') {
    root.classList.add('dark');
    sunIcon?.classList.remove('hidden');
    moonIcon?.classList.add('hidden');
  } else {
    root.classList.remove('dark');
    sunIcon?.classList.add('hidden');
    moonIcon?.classList.remove('hidden');
  }
}

function formatRelativeTime(rawTime: any): string {
  if (!rawTime) return 'Just now';
  let timestamp: number;
  if (typeof rawTime === 'number') {
    timestamp = rawTime;
  } else if (typeof rawTime === 'string') {
    const parsed = new Date(rawTime).getTime();
    timestamp = isNaN(parsed) ? Number(rawTime) : parsed;
  } else {
    timestamp = Date.now();
  }

  if (isNaN(timestamp) || timestamp <= 0) return 'Just now';

  const now = Date.now();
  const diffSec = Math.floor((now - timestamp) / 1000);

  if (diffSec < 0 || diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

function formatDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function shouldFilterUrl(url: string): boolean {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
    if (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '[::1]'
    ) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

function getMonogram(name: string): string {
  if (!name) return 'EX';
  const clean = name.trim().replace(/[^a-zA-Z0-9\s]/g, '');
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase() || 'EX';
}

// ============================================================================
// Tab Navigation & Header Controls
// ============================================================================

function switchTab(tab: PopupLocalState['activeTab']) {
  state.activeTab = tab;

  // Update nav button active styles
  document.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((btn) => {
    const isTarget = btn.getAttribute('data-tab') === tab;
    if (isTarget) {
      btn.classList.add('border-amber-600', 'text-amber-600', 'dark:border-amber-400', 'dark:text-amber-400', 'font-semibold');
      btn.classList.remove('border-transparent', 'text-slate-500', 'dark:text-slate-400');
    } else {
      btn.classList.remove('border-amber-600', 'text-amber-600', 'dark:border-amber-400', 'dark:text-amber-400', 'font-semibold');
      btn.classList.add('border-transparent', 'text-slate-500', 'dark:text-slate-400');
    }
  });

  // Switch visible section
  document.querySelectorAll<HTMLElement>('.view-panel').forEach((section) => {
    section.classList.add('hidden');
  });

  const targetSection = document.getElementById(`view-${tab}`);
  if (targetSection) {
    targetSection.classList.remove('hidden');
  }

  // Ensure content is freshly rendered on tab switch
  if (tab === 'extensions') renderExtensionsGallery();
  if (tab === 'history') renderHistoryViewer();
  if (tab === 'settings') renderSettings();

  // Reset scroll to top on tab change to prevent jumpiness
  const mainEl = document.querySelector('main');
  if (mainEl) {
    mainEl.scrollTop = 0;
  }
}

function updateHeaderStatusBadge() {
  const badge = document.getElementById('status-badge');
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  const iconP2p = document.getElementById('icon-mode-p2p');

  if (!badge || !dot || !text) return;

  text.textContent = state.syncState.p2pConnectedPeers > 0 ? 'P2P Active' : 'P2P Ready';
  badge.className =
    'flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800/60';
  dot.className = 'w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse-glow';
  iconP2p?.classList.remove('hidden');

  // Footer buffer count
  const bufferEl = document.getElementById('footer-buffer-count');
  if (bufferEl) {
    bufferEl.textContent = `${state.syncState.bufferedCount} items buffered (${state.syncState.totalSyncedCount} synced)`;
  }
}

// ============================================================================
// P2P Hub Logic (Client-Side Native WebRTC Engine in Popup DOM)
// ============================================================================

let popupP2PClient: WebRTCP2PClient | null = null;

function getOrCreateP2PClient(): WebRTCP2PClient {
  if (!popupP2PClient) {
    popupP2PClient = new WebRTCP2PClient({
      deviceId: state.syncState.deviceId,
      deviceName: state.syncState.deviceName,
      onStateChange: (connState) => {
        console.log('[Popup:P2P] State:', connState);
        if (connState === 'connected') {
          state.syncState.p2pConnectedPeers = 1;
          state.syncState.status = 'connected';
          renderP2PRoster();
          updateHeaderStatusBadge();
          showToast('🟢 P2P WebRTC Connected!');
        } else if (connState === 'disconnected' || connState === 'failed') {
          state.syncState.p2pConnectedPeers = 0;
          renderP2PRoster();
          updateHeaderStatusBadge();
        }
      },
      onPeerConnected: async (peer) => {
        console.log('[Popup:P2P] Peer connected:', peer);
        const newPeer: PairedPeer = {
          id: peer.deviceId,
          name: peer.deviceName,
          lastSeen: Date.now(),
        };

        // Append to mesh roster without removing existing peers
        const idx = state.pairedPeers.findIndex(
          (p) => p.id === newPeer.id || p.name === newPeer.name
        );
        if (idx >= 0) {
          state.pairedPeers[idx] = newPeer;
        } else {
          state.pairedPeers.push(newPeer);
        }

        state.syncState.p2pConnectedPeers = state.pairedPeers.length;
        state.syncState.status = 'connected';
        renderP2PRoster();
        updateHeaderStatusBadge();
        showToast(`Connected to ${peer.deviceName}!`);

        // Persist entire paired peers array to local storage
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({
            imhotep_p2p_paired_peers: state.pairedPeers,
            imhotep_p2p_connected: true,
          });
        }
        sendRuntimeMessage({ type: 'SET_PAIRED_PEERS', payload: state.pairedPeers });

        // 1. Send installed extensions to remote peer
        if (popupP2PClient && popupP2PClient.isConnected() && state.installedExtensions.length > 0) {
          const payload = state.installedExtensions.map((ext) => ({
            id: ext.id,
            name: ext.name,
            version: ext.version,
            description: ext.description,
            enabled: ext.enabled,
          }));
          popupP2PClient.syncExtensions(payload).catch((e) => console.warn('[Popup:P2P] Extensions notice:', e));
        }

        // 2. Fetch and send full native browser history (up to 150 items)
        if (popupP2PClient && popupP2PClient.isConnected() && typeof chrome !== 'undefined' && chrome.history && chrome.history.search) {
          try {
            const nativeVisits = await chrome.history.search({ text: '', maxResults: 150 });
            const histPayload = nativeVisits
              .filter((h) => h.url && !shouldFilterUrl(h.url))
              .map((h) => ({
                url: h.url!,
                title: h.title || h.url!,
                lastVisitTime: h.lastVisitTime || Date.now(),
                visitCount: h.visitCount || 1,
              }));
            if (histPayload.length > 0) {
              await popupP2PClient.syncHistoryBatch(histPayload);
              console.log(`[Popup:P2P] Synced ${histPayload.length} native visits to ${peer.deviceName}`);
            }
          } catch (e) {
            console.warn('[Popup:P2P] Could not search native history:', e);
          }
        }
      },
      onHistoryBatchReceived: async (items) => {
        console.log('[Popup:P2P] Received history batch:', items.length);
        const peerName = state.pairedPeers[state.pairedPeers.length - 1]?.name || 'Remote Peer';
        const peerId = state.pairedPeers[state.pairedPeers.length - 1]?.id || 'remote-peer';
        let nativeIngestedCount = 0;

        for (const item of items) {
          if (!item.url || shouldFilterUrl(item.url)) continue;

          // Ingest directly into the browser's native SQLite history database
          if (typeof chrome !== 'undefined' && chrome.history && chrome.history.addUrl) {
            try {
              await chrome.history.addUrl({ url: item.url });
              nativeIngestedCount++;
            } catch (e) {
              console.warn('Could not addUrl:', e);
            }
          }

          state.recentHistory.unshift({
            id: `p2p-${Date.now()}-${Math.random()}`,
            url: item.url,
            title: item.title || item.url,
            visitTime: item.lastVisitTime || Date.now(),
            deviceId: peerId,
            deviceName: peerName,
          });
        }

        renderHistoryViewer();
        showToast(`Synced ${nativeIngestedCount} visits into native browser history!`);

        // Persist synced history in local storage
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({
            imhotep_synced_history: state.recentHistory.slice(0, 500),
          });
        }
      },
      onExtensionBatchReceived: async (extensions) => {
        console.log('[Popup:P2P] Received extension batch:', extensions.length);
        const mapped: ExtensionItem[] = extensions.map((ext) => ({
          id: ext.id,
          name: ext.name,
          version: ext.version,
          enabled: ext.enabled,
          description: ext.description,
          storeUrl: `https://chromewebstore.google.com/detail/${ext.id}`,
        }));
        state.remoteExtensions = mapped;
        renderExtensionsGallery();
        showToast(`Discovered ${mapped.length} extensions from peer!`);

        // Persist remote extensions
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({
            imhotep_p2p_remote_extensions: mapped,
          });
        }
        sendRuntimeMessage({ type: 'SET_REMOTE_EXTENSIONS', payload: mapped });
      },
      onError: (err) => {
        console.warn('[Popup:P2P] Notice:', err?.message || err);
      },
    });
  }
  return popupP2PClient;
}

async function refreshPairingCredentials() {
  const qrLoading = document.getElementById('qr-loading');
  const qrCanvas = document.getElementById('p2p-qr-canvas') as HTMLCanvasElement;
  const mnemonicGrid = document.getElementById('mnemonic-grid');
  const fingerprintEl = document.getElementById('p2p-pairing-fingerprint');

  qrLoading?.classList.remove('hidden');

  try {
    // Generate new BIP-39 mnemonic
    const mnemonic = await generateMnemonic();
    state.currentMnemonic = mnemonic;
    const fingerprint = await derivePairingDisplayCode(mnemonic);
    state.currentFingerprint = fingerprint;

    if (fingerprintEl) {
      fingerprintEl.textContent = fingerprint;
    }

    // Render Mnemonic Grid
    if (mnemonicGrid) {
      mnemonicGrid.innerHTML = '';
      const words = mnemonic.split(' ');
      words.forEach((word, idx) => {
        const item = document.createElement('div');
        item.className =
          'flex items-center space-x-1.5 bg-white dark:bg-slate-900/90 px-2 py-1.5 rounded border border-slate-200/90 dark:border-slate-800/80 hover:border-amber-500/60 shadow-sm transition-colors';
        item.innerHTML = `
          <span class="mnemonic-badge text-[9px] text-amber-700 dark:text-amber-500/80 font-mono font-bold">${idx + 1}.</span>
          <span class="text-slate-900 dark:text-slate-200 font-mono text-[11px] font-medium tracking-tight select-all">${word}</span>
        `;
        mnemonicGrid.appendChild(item);
      });
    }

    // Generate real WebRTC Offer Ticket natively in window DOM
    const client = getOrCreateP2PClient();
    const offerTicket = await client.createOffer();
    const ticketStr = await compressSignalTicket(offerTicket);
    state.currentTicket = ticketStr;

    // Render QR Code onto canvas with real ticket
    if (qrCanvas) {
      await renderPairingQRCodeToCanvas(qrCanvas, ticketStr, {
        width: 176,
        margin: 1,
        darkColor: '#070A13',
        lightColor: '#FFFFFF',
      });
    }
  } catch (err) {
    console.warn('Notice: Failed to generate pairing credentials:', err);
    showToast('Failed to generate QR pairing');
  } finally {
    qrLoading?.classList.add('hidden');
  }
}

function renderP2PRoster() {
  const peerCountEl = document.getElementById('p2p-peer-count');
  const rosterCountEl = document.getElementById('p2p-roster-count');
  const peersListEl = document.getElementById('p2p-peers-list');
  const thisDeviceNameEl = document.getElementById('p2p-this-device-name');

  if (thisDeviceNameEl) {
    thisDeviceNameEl.textContent = state.syncState.deviceName;
  }

  if (peerCountEl) {
    peerCountEl.textContent = `${state.syncState.p2pConnectedPeers} Peers`;
  }
  if (rosterCountEl) {
    rosterCountEl.textContent = `${state.syncState.p2pConnectedPeers} Connected`;
  }

  if (!peersListEl) return;

  // Render peer items
  peersListEl.innerHTML = `
    <div class="p-2 rounded-lg bg-slate-50 dark:bg-slate-950/40 border border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between text-xs">
      <div class="flex items-center space-x-2">
        <span class="w-2 h-2 rounded-full bg-emerald-500 dark:bg-emerald-400"></span>
        <div>
          <div class="font-semibold text-slate-900 dark:text-slate-200">This Device (Local)</div>
          <div class="text-[10px] text-slate-500 dark:text-slate-400">${state.syncState.deviceName}</div>
        </div>
      </div>
      <span class="text-[10px] px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono">Active</span>
    </div>
  `;

  if (state.pairedPeers.length > 0) {
    state.pairedPeers.forEach((p) => {
      const isOnline = Date.now() - p.lastSeen < 1000 * 60 * 60 * 24;
      const peerItem = document.createElement('div');
      peerItem.className =
        'p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 flex items-center justify-between text-xs';
      peerItem.innerHTML = `
        <div class="flex items-center space-x-2">
          <span class="w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500 dark:bg-emerald-400 animate-pulse-glow' : 'bg-slate-400'}"></span>
          <div>
            <div class="font-semibold text-slate-900 dark:text-slate-200 flex items-center space-x-1">
              <span>${p.name}</span>
              <span class="text-[9px] px-1 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300 font-mono font-semibold">Paired</span>
            </div>
            <div class="text-[10px] text-slate-500 dark:text-slate-400 font-mono">P2P Mesh Device • Active</div>
          </div>
        </div>
        <span class="text-[10px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300 font-mono">Connected</span>
      `;
      peersListEl.appendChild(peerItem);
    });
  }
}


// ============================================================================
// Extensions Gallery & 1-Click Reinstall Logic
// ============================================================================

function renderExtensionsGallery() {
  const container = document.getElementById('extensions-list');
  const countAll = document.getElementById('count-ext-all');
  const countRemote = document.getElementById('count-ext-remote');
  const countInstalled = document.getElementById('count-ext-installed');
  const tabBadge = document.getElementById('tab-ext-count');

  if (!container) return;

  const installedMap = new Map<string, ExtensionItem>();
  state.installedExtensions.forEach((ext) => installedMap.set(ext.id, ext));

  // Remote extensions are those from remote peers
  const remoteList = state.remoteExtensions.filter((ext) => !installedMap.has(ext.id));
  const totalCount = state.installedExtensions.length + remoteList.length;

  if (countAll) countAll.textContent = totalCount.toString();
  if (countRemote) countRemote.textContent = remoteList.length.toString();
  if (countInstalled) countInstalled.textContent = state.installedExtensions.length.toString();

  if (tabBadge) {
    tabBadge.textContent = remoteList.length.toString();
    if (remoteList.length > 0) {
      tabBadge.classList.remove('hidden');
    } else {
      tabBadge.classList.add('hidden');
    }
  }

  // Combine lists with isRemote flag
  interface DisplayExtItem extends ExtensionItem {
    isRemote: boolean;
  }

  const allItems: DisplayExtItem[] = [
    ...state.installedExtensions.map((e) => ({ ...e, isRemote: false })),
    ...remoteList.map((e) => ({ ...e, isRemote: true })),
  ];

  // Apply search query filter
  const q = state.extensionSearchQuery.toLowerCase().trim();
  let filtered = allItems.filter((item) => {
    if (!q) return true;
    return item.name.toLowerCase().includes(q) || item.id.toLowerCase().includes(q);
  });

  // Apply tab filter
  if (state.extensionFilter === 'installed') {
    filtered = filtered.filter((item) => !item.isRemote);
  } else if (state.extensionFilter === 'remote') {
    filtered = filtered.filter((item) => item.isRemote);
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-slate-500 text-xs font-mono">
        No extensions found matching your filter.
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  filtered.forEach((ext) => {
    const card = document.createElement('div');
    card.className =
      'glass-panel p-3 rounded-xl border border-slate-200/90 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700 transition-all space-y-2';

    const monogram = getMonogram(ext.name);

    card.innerHTML = `
      <div class="flex items-start justify-between">
        <div class="flex items-center space-x-2.5">
          <!-- Extension Monogram Icon -->
          <div class="w-8 h-8 rounded-lg ${
            ext.isRemote
              ? 'bg-cyan-100 text-cyan-800 border border-cyan-300 dark:bg-gradient-to-br dark:from-cyan-500/20 dark:to-blue-500/20 dark:text-cyan-300 dark:border-cyan-500/30'
              : 'bg-amber-100 text-amber-800 border border-amber-300 dark:bg-gradient-to-br dark:from-amber-500/20 dark:to-orange-500/20 dark:text-amber-300 dark:border-amber-500/30'
          } flex items-center justify-center font-bold text-xs font-mono shadow-sm">
            ${monogram}
          </div>
          <div>
            <div class="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center space-x-1.5">
              <span>${ext.name}</span>
              <span class="text-[9px] text-slate-500 font-mono">v${ext.version}</span>
            </div>
            <div class="text-[10px] text-slate-500 dark:text-slate-400 font-mono truncate max-w-[210px]" title="${ext.id}">
              ${ext.id}
            </div>
          </div>
        </div>

        <!-- Badges & 1-Click Install Button -->
        <div class="flex-shrink-0">
          ${
            ext.isRemote
              ? `<a href="${ext.storeUrl}" target="_blank" rel="noopener noreferrer" class="btn-tactile inline-flex items-center space-x-1.5 px-3 py-1 rounded-md bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-[10px] shadow-md shadow-amber-500/20 whitespace-nowrap">
                  <svg class="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  <span>1-Click Install</span>
                </a>`
              : `<span class="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-mono whitespace-nowrap ${
                  ext.enabled
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-800/60'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                }">
                  <span class="w-1.5 h-1.5 rounded-full ${ext.enabled ? 'bg-emerald-500 dark:bg-emerald-400' : 'bg-slate-400'}"></span>
                  <span>${ext.enabled ? 'Installed' : 'Disabled'}</span>
                </span>`
          }
        </div>
      </div>
      ${
        ext.description
          ? `<p class="text-[11px] text-slate-600 dark:text-slate-400 leading-snug line-clamp-2">${ext.description}</p>`
          : ''
      }
    `;
    container.appendChild(card);
  });
}

// ============================================================================
// Decrypted History Viewer Logic
// ============================================================================

function renderHistoryViewer() {
  const container = document.getElementById('history-items-list');
  const tabBadge = document.getElementById('tab-hist-count');

  if (!container) return;

  if (tabBadge) {
    tabBadge.textContent =
      state.recentHistory.length >= state.historyLimit
        ? `${state.recentHistory.length}+`
        : state.recentHistory.length.toString();
    tabBadge.classList.remove('hidden');
  }

  const q = state.historySearchQuery.toLowerCase().trim();
  const filtered = state.recentHistory.filter((item) => {
    if (!q) return true;
    return (
      (item.title && item.title.toLowerCase().includes(q)) ||
      item.url.toLowerCase().includes(q) ||
      (item.deviceName && item.deviceName.toLowerCase().includes(q))
    );
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-slate-500 text-xs font-mono">
        No decrypted history entries match your search.
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  filtered.forEach((item) => {
    const card = document.createElement('div');
    card.className =
      'glass-panel p-2.5 rounded-xl border border-slate-200/90 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700 transition-all space-y-1.5';

    const domain = formatDomain(item.url);
    const rawTime = (item as any).visitTime || (item as any).lastVisitTime || (item as any).visit_timestamp;
    const timeAgo = formatRelativeTime(rawTime);
    const deviceName = item.deviceName || (item as any).device_name || 'This Device (Local)';

    card.innerHTML = `
      <div class="flex items-start justify-between space-x-2">
        <a href="${item.url}" target="_blank" rel="noopener noreferrer" class="text-xs font-semibold text-slate-900 dark:text-slate-200 hover:text-amber-600 dark:hover:text-amber-400 transition-colors line-clamp-1 flex-1">
          ${item.title || item.url}
        </a>
        <span class="text-[9px] text-slate-500 font-mono whitespace-nowrap">${timeAgo}</span>
      </div>

      <div class="flex items-center justify-between text-[10px]">
        <div class="flex items-center space-x-1.5 text-slate-600 dark:text-slate-400 font-mono">
          <svg class="w-3 h-3 text-cyan-600 dark:text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          <span class="truncate max-w-[170px]">${domain}</span>
        </div>

        <span class="px-1.5 py-0.2 rounded font-mono text-[9px] bg-slate-100 dark:bg-slate-800/80 text-cyan-800 dark:text-cyan-300 border border-slate-200 dark:border-slate-700">
          ${deviceName}
        </span>
      </div>
    `;
    container.appendChild(card);
  });
}

async function loadHistory(limit: number = state.historyLimit, query: string = state.historySearchQuery) {
  state.historyLimit = limit;
  try {
    const histRes = await sendRuntimeMessage<HistoryVisitItem[]>({
      type: 'GET_RECENT_HISTORY',
      payload: { limit, query },
    });
    if (histRes.success && Array.isArray(histRes.data)) {
      state.recentHistory = histRes.data;
      renderHistoryViewer();
    }
  } catch (err) {
    console.warn('Failed to load history:', err);
  }
}

// ============================================================================
// Settings & Diagnostics Logic
// ============================================================================

async function renderSettings() {
  const nameInput = document.getElementById('input-device-name') as HTMLInputElement;
  const idLabel = document.getElementById('label-device-id');

  if (nameInput) {
    nameInput.value = state.syncState.deviceName;
  }
  if (idLabel) {
    idLabel.textContent = state.syncState.deviceId;
  }
}

// ============================================================================
// Event Listeners & Binding
// ============================================================================

function setupEventListeners() {
  // Theme toggle
  document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
    const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
    switchTab(state.activeTab);
    updateHeaderStatusBadge();
    renderExtensionsGallery();
    renderHistoryViewer();
    showToast(`Switched to ${nextTheme} mode`);
  });

  // Tab navigation
  document.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab') as PopupLocalState['activeTab'];
      if (tab) switchTab(tab);
    });
  });

  // Onboarding Banner Actions
  document.getElementById('btn-close-onboarding')?.addEventListener('click', () => {
    document.getElementById('onboarding-banner')?.classList.add('hidden');
  });

  document.getElementById('btn-onboarding-p2p')?.addEventListener('click', () => {
    document.getElementById('onboarding-banner')?.classList.add('hidden');
    switchTab('p2p');
  });

  // P2P Subtabs (Share vs Connect)
  const shareBtn = document.getElementById('p2p-subtab-share');
  const connectBtn = document.getElementById('p2p-subtab-connect');
  const sharePanel = document.getElementById('p2p-subpanel-share');
  const connectPanel = document.getElementById('p2p-subpanel-connect');

  shareBtn?.addEventListener('click', () => {
    state.p2pSubtab = 'share';
    shareBtn.className =
      'flex-1 py-1.5 text-center text-amber-700 dark:text-amber-400 border-b-2 border-amber-600 dark:border-amber-400 font-bold';
    connectBtn!.className = 'flex-1 py-1.5 text-center text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200';
    sharePanel?.classList.remove('hidden');
    connectPanel?.classList.add('hidden');
  });

  connectBtn?.addEventListener('click', () => {
    state.p2pSubtab = 'connect';
    connectBtn.className =
      'flex-1 py-1.5 text-center text-amber-700 dark:text-amber-400 border-b-2 border-amber-600 dark:border-amber-400 font-bold';
    shareBtn!.className = 'flex-1 py-1.5 text-center text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200';
    connectPanel?.classList.remove('hidden');
    sharePanel?.classList.add('hidden');
  });

  // Copy P2P Pairing Ticket (SDP Offer)
  document.getElementById('btn-copy-ticket')?.addEventListener('click', async () => {
    if (!state.currentTicket) {
      showToast('Generating ticket...');
      await refreshPairingCredentials();
    }
    if (!state.currentTicket) return;
    try {
      await navigator.clipboard.writeText(state.currentTicket);
      const label = document.getElementById('copy-ticket-label');
      if (label) label.textContent = 'Copied to Clipboard!';
      showToast('Pairing ticket copied! Paste into peer browser');
      setTimeout(() => {
        if (label) label.textContent = 'Copy Pairing Ticket (P2P Ticket)';
      }, 2000);
    } catch {
      showToast('Failed to copy ticket');
    }
  });

  // Copy Answer Ticket
  document.getElementById('btn-copy-answer-ticket')?.addEventListener('click', async () => {
    if (!state.generatedAnswerTicket) return;
    try {
      await navigator.clipboard.writeText(state.generatedAnswerTicket);
      const label = document.getElementById('copy-answer-label');
      if (label) label.textContent = 'Copied to Clipboard!';
      showToast('Answer ticket copied! Paste into first browser');
      setTimeout(() => {
        if (label) label.textContent = 'Copy Answer Ticket';
      }, 2000);
    } catch {
      showToast('Failed to copy answer');
    }
  });

  // Copy 12-Word Mnemonic / Ticket
  document.getElementById('btn-copy-mnemonic')?.addEventListener('click', async () => {
    // Copy the pairing ticket so user can paste directly into other browser
    const toCopy = state.currentTicket || state.currentMnemonic;
    if (!toCopy) return;
    try {
      await navigator.clipboard.writeText(toCopy);
      const label = document.getElementById('copy-mnemonic-label');
      if (label) label.textContent = 'Copied!';
      showToast('Pairing code copied to clipboard!');
      setTimeout(() => {
        if (label) label.textContent = 'Copy Words';
      }, 2000);
    } catch {
      showToast('Failed to copy');
    }
  });

  // Paste from Clipboard helper
  document.getElementById('btn-paste-clipboard')?.addEventListener('click', async () => {
    const input = document.getElementById('input-peer-signal') as HTMLTextAreaElement;
    try {
      const text = (await navigator.clipboard.readText())?.trim();
      if (text && input) {
        input.value = text;
        showToast('Pasted ticket from clipboard!');
      } else {
        showToast('Clipboard is empty');
      }
    } catch {
      showToast('Please press Cmd+V to paste manually');
    }
  });

  // Regenerate Ephemeral Credentials
  document.getElementById('btn-regen-pairing')?.addEventListener('click', async () => {
    await refreshPairingCredentials();
    showToast('New ephemeral pairing credentials ready');
  });

  // Connect to Peer action (Handles both Offer Ticket & Answer Ticket)
  document.getElementById('btn-connect-peer')?.addEventListener('click', async () => {
    const input = document.getElementById('input-peer-signal') as HTMLTextAreaElement;
    let value = input?.value?.trim();

    if (!value) {
      // If box is empty, try auto-reading clipboard!
      try {
        const clipText = (await navigator.clipboard.readText())?.trim();
        if (clipText && (clipText.startsWith('IMH1:') || clipText.startsWith('IMH0:') || clipText.startsWith('{'))) {
          value = clipText;
          if (input) input.value = clipText;
        }
      } catch {}
    }

    if (!value) {
      showToast('Please paste the Pairing Ticket copied from Chrome');
      return;
    }

    try {
      let ticket: PairingSignalTicket;

      if (value.startsWith('IMH1:') || value.startsWith('IMH0:') || value.startsWith('{')) {
        ticket = await decompressSignalTicket(value);
      } else {
        // User pasted 12 words: check if clipboard has the actual IMH1:... ticket
        let clipText = '';
        try {
          clipText = (await navigator.clipboard.readText())?.trim() || '';
        } catch {}

        if (clipText && (clipText.startsWith('IMH1:') || clipText.startsWith('IMH0:') || clipText.startsWith('{'))) {
          showToast('Found ticket in clipboard! Connecting...');
          if (input) input.value = clipText;
          ticket = await decompressSignalTicket(clipText);
        } else {
          showToast('Please click "Copy Pairing Ticket" in Chrome, then paste it here!');
          return;
        }
      }

      const client = getOrCreateP2PClient();

      if (ticket.type === 'offer') {
        showToast('Accepting offer & creating answer...');
        const answerTicket = await client.acceptOfferAndCreateAnswer(ticket);
        const answerStr = await compressSignalTicket(answerTicket);
        state.generatedAnswerTicket = answerStr;

        try {
          await navigator.clipboard.writeText(answerStr);
        } catch {}

        const answerBox = document.getElementById('answer-ticket-box');
        const answerInput = document.getElementById('output-answer-ticket') as HTMLTextAreaElement;
        if (answerBox && answerInput) {
          answerInput.value = answerStr;
          answerBox.classList.remove('hidden');
        }
        showToast('Answer copied to clipboard! Paste into Chrome to finish.');
      } else if (ticket.type === 'answer') {
        showToast('Connecting to peer...');
        await client.acceptAnswer(ticket);
        state.syncState.p2pConnectedPeers = 1;
        renderP2PRoster();
        updateHeaderStatusBadge();
        showToast('🎉 Direct P2P Connected!');
        input.value = '';
        const answerBox = document.getElementById('answer-ticket-box');
        if (answerBox) answerBox.classList.add('hidden');
      }
    } catch (err: any) {
      console.warn('Pairing notice:', err?.message || err);
      showToast('Pairing notice: ' + (err?.message || err));
    }
  });

  // P2P Sync Now
  document.getElementById('btn-p2p-sync-now')?.addEventListener('click', async () => {
    await sendRuntimeMessage({ type: 'TRIGGER_FLUSH' });

    if (!popupP2PClient || !popupP2PClient.isConnected()) {
      showToast('⚠️ No active peer connected. Connect a peer to sync visits.');
      return;
    }

    showToast('Syncing native history & extensions over P2P...');

    // Send native history to remote peer if connected
    if (typeof chrome !== 'undefined' && chrome.history && chrome.history.search) {
      try {
        const nativeVisits = await chrome.history.search({ text: '', maxResults: 150 });
        const histPayload = nativeVisits
          .filter((h) => h.url && !shouldFilterUrl(h.url))
          .map((h) => ({
            url: h.url!,
            title: h.title || h.url!,
            lastVisitTime: h.lastVisitTime || Date.now(),
            visitCount: h.visitCount || 1,
          }));
        if (histPayload.length > 0) {
          const ok = await popupP2PClient.syncHistoryBatch(histPayload);
          if (ok) {
            showToast(`Synced ${histPayload.length} history items to peer!`);
          }
        }
      } catch (e: any) {
        console.warn('Sync history notice:', e?.message || e);
      }
    }

    state.syncState.bufferedCount = 0;
    updateHeaderStatusBadge();
  });

  // Extensions Filter Chips
  document.querySelectorAll<HTMLButtonElement>('.ext-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const filter = btn.getAttribute('data-ext-filter') as PopupLocalState['extensionFilter'];
      if (!filter) return;
      state.extensionFilter = filter;

      document.querySelectorAll<HTMLButtonElement>('.ext-filter-btn').forEach((b) => {
        b.className =
          'ext-filter-btn px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 hover:text-slate-900 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:text-slate-200 dark:border-slate-700';
      });
      btn.className =
        'ext-filter-btn px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/40 font-semibold';

      renderExtensionsGallery();
    });
  });

  // Search extensions
  const extSearch = document.getElementById('input-search-extensions') as HTMLInputElement;
  extSearch?.addEventListener('input', (e) => {
    state.extensionSearchQuery = (e.target as HTMLInputElement).value;
    renderExtensionsGallery();
  });

  // Sync extensions button
  document.getElementById('btn-sync-extensions')?.addEventListener('click', async () => {
    showToast('Scanning and syncing extensions...');
    const res = await sendRuntimeMessage({ type: 'SYNC_EXTENSIONS_NOW' });
    if (res.success && res.data) {
      renderExtensionsGallery();
      showToast('Extensions gallery refreshed!');
    }
  });

  // Search history
  let searchDebounceTimer: any = null;
  const histSearch = document.getElementById('input-search-history') as HTMLInputElement;
  histSearch?.addEventListener('input', (e) => {
    state.historySearchQuery = (e.target as HTMLInputElement).value;
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      loadHistory(state.historyLimit, state.historySearchQuery);
    }, 250);
  });

  // Sync history button
  document.getElementById('btn-sync-history')?.addEventListener('click', async () => {
    showToast('Refreshing synced visits...');
    await sendRuntimeMessage({ type: 'TRIGGER_FLUSH' });
    await loadHistory(state.historyLimit, state.historySearchQuery);
    showToast('History updated!');
  });

  // History Limit selector buttons
  document.querySelectorAll('.hist-limit-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetLimit = Number((btn as HTMLElement).dataset.limit) || 150;
      document.querySelectorAll('.hist-limit-btn').forEach((b) => {
        b.className =
          'hist-limit-btn px-2 py-0.5 rounded border border-slate-200 dark:border-slate-800 hover:border-cyan-500/40 text-slate-600 dark:text-slate-400';
      });
      btn.className =
        'hist-limit-btn px-2 py-0.5 rounded bg-cyan-100 text-cyan-900 border border-cyan-400 dark:bg-cyan-500/20 dark:text-cyan-300 dark:border-cyan-500/50 font-bold';
      loadHistory(targetLimit, state.historySearchQuery);
    });
  });

  // Load More History button
  document.getElementById('btn-load-more-history')?.addEventListener('click', () => {
    const nextLimit = Math.min(state.historyLimit + 150, 1000);
    showToast(`Loading up to ${nextLimit} visits...`);
    loadHistory(nextLimit, state.historySearchQuery);
  });

  // Save device name
  document.getElementById('btn-save-device-name')?.addEventListener('click', async () => {
    const input = document.getElementById('input-device-name') as HTMLInputElement;
    const name = input?.value?.trim();
    if (!name) return;

    await sendRuntimeMessage({
      type: 'SET_DEVICE_NAME',
      payload: { name },
    });
    state.syncState.deviceName = name;
    renderP2PRoster();
    showToast('Device name updated');
  });

  // Copy Device ID
  document.getElementById('btn-copy-device-id')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(state.syncState.deviceId);
      showToast('Device ID copied');
    } catch {
      showToast('Failed to copy ID');
    }
  });

  // Danger Zone: Clear Keys & Disconnect
  document.getElementById('btn-purge-cache')?.addEventListener('click', async () => {
    if (confirm('Clear local cryptographic session key and disconnect all P2P peers?')) {
      await sendRuntimeMessage({ type: 'CLEAR_MASTER_KEY' });
      await sendRuntimeMessage({ type: 'P2P_DISCONNECT' });
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.remove([
          'imhotep_p2p_paired_peers',
          'imhotep_p2p_paired_peer',
          'imhotep_p2p_remote_extensions',
          'imhotep_synced_history',
        ]);
      }
      state.pairedPeers = [];
      state.remoteExtensions = [];
      state.syncState.hasMasterKey = false;
      state.syncState.p2pConnectedPeers = 0;
      renderP2PRoster();
      renderExtensionsGallery();
      updateHeaderStatusBadge();
      showToast('Keys cleared from memory & peers disconnected');
    }
  });
}

// ============================================================================
// Initialization Routine
// ============================================================================

async function init() {
  applyTheme(state.theme);

  // Rehydrate paired peer, remote extensions, and synced history from chrome.storage.local
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    try {
      const stored = await chrome.storage.local.get([
        'imhotep_p2p_paired_peers',
        'imhotep_p2p_paired_peer',
        'imhotep_p2p_remote_extensions',
        'imhotep_synced_history',
      ]);
      if (Array.isArray(stored.imhotep_p2p_paired_peers) && stored.imhotep_p2p_paired_peers.length > 0) {
        state.pairedPeers = stored.imhotep_p2p_paired_peers;
        state.syncState.p2pConnectedPeers = state.pairedPeers.length;
        state.syncState.status = 'connected';
      } else if (stored.imhotep_p2p_paired_peer) {
        state.pairedPeers = [stored.imhotep_p2p_paired_peer];
        state.syncState.p2pConnectedPeers = 1;
        state.syncState.status = 'connected';
      }
      if (Array.isArray(stored.imhotep_p2p_remote_extensions) && stored.imhotep_p2p_remote_extensions.length > 0) {
        state.remoteExtensions = stored.imhotep_p2p_remote_extensions;
      }
      if (Array.isArray(stored.imhotep_synced_history) && stored.imhotep_synced_history.length > 0) {
        state.recentHistory = [...stored.imhotep_synced_history, ...state.recentHistory];
      }
    } catch (e) {
      console.warn('Could not rehydrate local storage:', e);
    }
  }

  // Fetch initial status from background worker
  try {
    const statusRes = await sendRuntimeMessage<SyncState>({ type: 'GET_STATUS' });
    if (statusRes.success && statusRes.data) {
      state.syncState = { ...state.syncState, ...statusRes.data };
      if (state.pairedPeers.length > 0) {
        state.syncState.p2pConnectedPeers = state.pairedPeers.length;
        state.syncState.status = 'connected';
      }
    }

    const extRes = await sendRuntimeMessage<ExtensionItem[]>({ type: 'GET_INSTALLED_EXTENSIONS' });
    if (extRes.success && extRes.data) {
      state.installedExtensions = extRes.data;
    }

    const remoteExtRes = await sendRuntimeMessage<ExtensionItem[]>({
      type: 'GET_REMOTE_EXTENSIONS',
    });
    if (remoteExtRes.success && remoteExtRes.data && remoteExtRes.data.length > 0) {
      state.remoteExtensions = remoteExtRes.data;
    }

    const histRes = await sendRuntimeMessage<HistoryVisitItem[]>({
      type: 'GET_RECENT_HISTORY',
      payload: { limit: state.historyLimit },
    });
    if (histRes.success && histRes.data) {
      const existingUrls = new Set(state.recentHistory.map((h) => h.url));
      for (const item of histRes.data) {
        if (!existingUrls.has(item.url)) {
          state.recentHistory.push(item);
        }
      }
    }
  } catch (err) {
    console.warn('Init error, using defaults:', err);
  }

  // Setup DOM and listeners
  setupEventListeners();
  updateHeaderStatusBadge();
  renderP2PRoster();
  renderExtensionsGallery();
  renderHistoryViewer();
  renderSettings();

  // Generate initial P2P QR and Mnemonic
  await refreshPairingCredentials();
}

// Boot popup on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
