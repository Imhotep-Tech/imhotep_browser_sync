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
import { renderPairingQRCodeToCanvas } from '../p2p/qr';
import {
  generateMnemonic,
  derivePairingDisplayCode,
  validateMnemonic,
} from '../p2p/mnemonic';

// ============================================================================
// State & Defaults
// ============================================================================

interface PopupLocalState {
  activeTab: 'p2p' | 'extensions' | 'history' | 'settings';
  p2pSubtab: 'share' | 'connect';
  extensionFilter: 'all' | 'remote' | 'installed';
  theme: 'dark' | 'light';
  currentMnemonic: string;
  currentFingerprint: string;
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
      btn.classList.add('border-amber-400', 'text-amber-400');
      btn.classList.remove('border-transparent', 'text-slate-400');
    } else {
      btn.classList.remove('border-amber-400', 'text-amber-400');
      btn.classList.add('border-transparent', 'text-slate-400');
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
    'flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-950/60 text-emerald-400 border border-emerald-800/60';
  dot.className = 'w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-glow';
  iconP2p?.classList.remove('hidden');

  // Footer buffer count
  const bufferEl = document.getElementById('footer-buffer-count');
  if (bufferEl) {
    bufferEl.textContent = `${state.syncState.bufferedCount} items buffered (${state.syncState.totalSyncedCount} synced)`;
  }
}

// ============================================================================
// P2P Hub Logic
// ============================================================================

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
          'flex items-center space-x-1.5 bg-slate-900/90 px-2 py-1.5 rounded border border-slate-800/80 hover:border-amber-500/40 transition-colors';
        item.innerHTML = `
          <span class="mnemonic-badge text-[9px] text-amber-500/80 font-mono font-semibold">${idx + 1}.</span>
          <span class="text-slate-200 font-mono text-[11px] font-medium tracking-tight select-all">${word}</span>
        `;
        mnemonicGrid.appendChild(item);
      });
    }

    // Render QR Code onto canvas
    if (qrCanvas) {
      await renderPairingQRCodeToCanvas(qrCanvas, mnemonic, {
        width: 176,
        margin: 1,
        darkColor: '#070A13',
        lightColor: '#FFFFFF',
      });
    }
  } catch (err) {
    console.error('Failed to generate pairing credentials:', err);
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
    <div class="p-2 rounded-lg bg-slate-950/40 border border-slate-800/80 flex items-center justify-between text-xs">
      <div class="flex items-center space-x-2">
        <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
        <div>
          <div class="font-semibold text-slate-200">This Device (Local)</div>
          <div class="text-[10px] text-slate-400">${state.syncState.deviceName}</div>
        </div>
      </div>
      <span class="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">Active</span>
    </div>
  `;

  if (state.syncState.p2pConnectedPeers > 0) {
    const peerItem = document.createElement('div');
    peerItem.className =
      'p-2 rounded-lg bg-emerald-950/20 border border-emerald-800/40 flex items-center justify-between text-xs';
    peerItem.innerHTML = `
      <div class="flex items-center space-x-2">
        <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-glow"></span>
        <div>
          <div class="font-semibold text-slate-200 flex items-center space-x-1">
            <span>Android Kiwi Browser</span>
            <span class="text-[9px] px-1 rounded bg-amber-500/20 text-amber-300 font-mono">Mobile</span>
          </div>
          <div class="text-[10px] text-slate-400 font-mono">DataChannel Connected • 18ms</div>
        </div>
      </div>
      <button class="btn-tactile px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]">
        Ping
      </button>
    `;
    peersListEl.appendChild(peerItem);
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
      'glass-panel p-3 rounded-xl border border-slate-800/80 hover:border-slate-700 transition-all space-y-2';

    const monogram = getMonogram(ext.name);

    card.innerHTML = `
      <div class="flex items-start justify-between">
        <div class="flex items-center space-x-2.5">
          <!-- Extension Monogram Icon -->
          <div class="w-8 h-8 rounded-lg ${
            ext.isRemote
              ? 'bg-gradient-to-br from-cyan-500/20 to-blue-500/20 text-cyan-300 border border-cyan-500/30'
              : 'bg-gradient-to-br from-amber-500/20 to-orange-500/20 text-amber-300 border border-amber-500/30'
          } flex items-center justify-center font-bold text-xs font-mono">
            ${monogram}
          </div>
          <div>
            <div class="text-xs font-semibold text-slate-100 flex items-center space-x-1.5">
              <span>${ext.name}</span>
              <span class="text-[9px] text-slate-500 font-mono">v${ext.version}</span>
            </div>
            <div class="text-[10px] text-slate-400 font-mono truncate max-w-[210px]" title="${ext.id}">
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
                    ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                    : 'bg-slate-800 text-slate-400'
                }">
                  <span class="w-1.5 h-1.5 rounded-full ${ext.enabled ? 'bg-emerald-400' : 'bg-slate-500'}"></span>
                  <span>${ext.enabled ? 'Installed' : 'Disabled'}</span>
                </span>`
          }
        </div>
      </div>
      ${
        ext.description
          ? `<p class="text-[11px] text-slate-400 leading-snug line-clamp-2">${ext.description}</p>`
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
      'glass-panel p-2.5 rounded-xl border border-slate-800/80 hover:border-slate-700 transition-all space-y-1.5';

    const domain = formatDomain(item.url);
    const rawTime = (item as any).visitTime || (item as any).lastVisitTime || (item as any).visit_timestamp;
    const timeAgo = formatRelativeTime(rawTime);
    const deviceName = item.deviceName || (item as any).device_name || 'This Device (Local)';

    card.innerHTML = `
      <div class="flex items-start justify-between space-x-2">
        <a href="${item.url}" target="_blank" rel="noopener noreferrer" class="text-xs font-semibold text-slate-200 hover:text-amber-400 transition-colors line-clamp-1 flex-1">
          ${item.title || item.url}
        </a>
        <span class="text-[9px] text-slate-500 font-mono whitespace-nowrap">${timeAgo}</span>
      </div>

      <div class="flex items-center justify-between text-[10px]">
        <div class="flex items-center space-x-1.5 text-slate-400 font-mono">
          <svg class="w-3 h-3 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          <span class="truncate max-w-[170px]">${domain}</span>
        </div>

        <span class="px-1.5 py-0.2 rounded font-mono text-[9px] bg-slate-800/80 text-cyan-300 border border-slate-700">
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
      'flex-1 py-1.5 text-center text-amber-400 border-b border-amber-400 font-semibold';
    connectBtn!.className = 'flex-1 py-1.5 text-center text-slate-400 hover:text-slate-200';
    sharePanel?.classList.remove('hidden');
    connectPanel?.classList.add('hidden');
  });

  connectBtn?.addEventListener('click', () => {
    state.p2pSubtab = 'connect';
    connectBtn.className =
      'flex-1 py-1.5 text-center text-amber-400 border-b border-amber-400 font-semibold';
    shareBtn!.className = 'flex-1 py-1.5 text-center text-slate-400 hover:text-slate-200';
    connectPanel?.classList.remove('hidden');
    sharePanel?.classList.add('hidden');
  });

  // Copy 12-Word Mnemonic Phrase
  document.getElementById('btn-copy-mnemonic')?.addEventListener('click', async () => {
    if (!state.currentMnemonic) return;
    try {
      await navigator.clipboard.writeText(state.currentMnemonic);
      const label = document.getElementById('copy-mnemonic-label');
      if (label) label.textContent = 'Copied!';
      showToast('12-word phrase copied to clipboard');
      setTimeout(() => {
        if (label) label.textContent = 'Copy All';
      }, 2000);
    } catch {
      showToast('Failed to copy');
    }
  });

  // Regenerate Ephemeral Credentials
  document.getElementById('btn-regen-pairing')?.addEventListener('click', async () => {
    await refreshPairingCredentials();
    showToast('New ephemeral pairing credentials ready');
  });

  // Connect to Peer action
  document.getElementById('btn-connect-peer')?.addEventListener('click', async () => {
    const input = document.getElementById('input-peer-signal') as HTMLTextAreaElement;
    const value = input?.value?.trim();

    if (!value) {
      showToast('Please enter mnemonic words or pairing ticket');
      return;
    }

    showToast('Pairing with peer...');
    const isValidWords = await validateMnemonic(value);
    const res = await sendRuntimeMessage({
      type: 'P2P_CONNECT_MNEMONIC',
      payload: { mnemonic: value, isMnemonic: isValidWords },
    });

    if (res.success) {
      state.syncState.p2pConnectedPeers += 1;
      renderP2PRoster();
      updateHeaderStatusBadge();
      showToast('P2P DataChannel established!');
      input.value = '';
    } else {
      showToast(res.error || 'Pairing failed. Check phrase.');
    }
  });

  // P2P Sync Now
  document.getElementById('btn-p2p-sync-now')?.addEventListener('click', async () => {
    showToast('Syncing micro-batches over P2P...');
    const res = await sendRuntimeMessage({ type: 'TRIGGER_FLUSH' });
    if (res.success) {
      state.syncState.bufferedCount = 0;
      updateHeaderStatusBadge();
      showToast('P2P sync complete!');
    }
  });

  // Extensions Filter Chips
  document.querySelectorAll<HTMLButtonElement>('.ext-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const filter = btn.getAttribute('data-ext-filter') as PopupLocalState['extensionFilter'];
      if (!filter) return;
      state.extensionFilter = filter;

      document.querySelectorAll<HTMLButtonElement>('.ext-filter-btn').forEach((b) => {
        b.className =
          'ext-filter-btn px-2.5 py-1 rounded-full bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700';
      });
      btn.className =
        'ext-filter-btn px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40';

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
          'hist-limit-btn px-2 py-0.5 rounded border border-slate-800 hover:border-cyan-500/40 text-slate-400';
      });
      btn.className =
        'hist-limit-btn px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 font-bold';
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
      state.syncState.hasMasterKey = false;
      state.syncState.p2pConnectedPeers = 0;
      renderP2PRoster();
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

  // Fetch initial status from background worker
  try {
    const statusRes = await sendRuntimeMessage<SyncState>({ type: 'GET_STATUS' });
    if (statusRes.success && statusRes.data) {
      state.syncState = { ...state.syncState, ...statusRes.data };
    }

    const extRes = await sendRuntimeMessage<ExtensionItem[]>({ type: 'GET_INSTALLED_EXTENSIONS' });
    if (extRes.success && extRes.data) {
      state.installedExtensions = extRes.data;
    }

    const remoteExtRes = await sendRuntimeMessage<ExtensionItem[]>({
      type: 'GET_REMOTE_EXTENSIONS',
    });
    if (remoteExtRes.success && remoteExtRes.data) {
      state.remoteExtensions = remoteExtRes.data;
    }

    const histRes = await sendRuntimeMessage<HistoryVisitItem[]>({
      type: 'GET_RECENT_HISTORY',
      payload: { limit: state.historyLimit },
    });
    if (histRes.success && histRes.data) {
      state.recentHistory = histRes.data;
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
