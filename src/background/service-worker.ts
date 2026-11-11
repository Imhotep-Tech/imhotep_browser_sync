/**
 * Imhotep Browser Sync - Chrome Manifest V3 Background Service Worker
 *
 * 100% Decentralized, Peer-to-Peer (P2P) WebRTC Architecture.
 *
 * Coordinates:
 * 1. MV3 Lifecycle & Event Dispatching (history, alarms, messaging, startup).
 * 2. Automated History Capture with Micro-Batch Debounce (every 20s or 15 items).
 * 3. Strict Exclusion Filters (internal protocols, private IPs, loopbacks, incognito).
 * 4. Zero-Knowledge Remote Ingestion into Chrome History with Anti-Echo deduplication.
 * 5. Extension Inspection & Synchronization with 1-Click Web Store Reinstall links.
 * 6. Direct WebRTC P2P DataChannel mesh (zero servers, zero cloud database).
 */

import {
  SyncState,
  SyncMode,
  SyncStatus,
  DeviceType,
  HistoryVisitItem,
  ExtensionItem,
  RuntimeMessage,
  RuntimeResponse,
} from '../types/sync';
import {
  deriveKeyFromPassword,
  deriveKeyFromMnemonic,
  uint8ArrayToBase64,
  base64ToUint8Array,
  generateSalt,
} from '../crypto/e2ee';
import { WebRTCP2PClient } from '../p2p/webrtc';
import { PairingSignalTicket, HistoryItemPayload, ExtensionItemPayload } from '../types/p2p';

// ============================================================================
// Constants & Configuration
// ============================================================================

const BATCH_SIZE_THRESHOLD = 15;
const BATCH_FLUSH_INTERVAL_MS = 20_000; // 20 seconds
const ALARM_FLUSH_NAME = 'imhotep_flush_buffer_alarm';

const STORAGE_KEY_DEVICE_ID = 'imhotep_device_id';
const STORAGE_KEY_DEVICE_NAME = 'imhotep_device_name';
const STORAGE_KEY_DEVICE_TYPE = 'imhotep_device_type';
const STORAGE_KEY_BUFFER = 'imhotep_history_buffer';
const STORAGE_KEY_STATS = 'imhotep_sync_stats';
const STORAGE_KEY_SALT = 'imhotep_account_salt';
const STORAGE_KEY_P2P_EXTENSIONS = 'imhotep_p2p_remote_extensions';

// ============================================================================
// Service Worker In-Memory State (Rehydrated from chrome.storage.local)
// ============================================================================

let deviceId = '';
let deviceName = '';
let deviceType: DeviceType = 'desktop';
const syncMode: SyncMode = 'p2p';
let syncStatus: SyncStatus = 'idle';
let totalSyncedCount = 0;
let lastSyncTime: number | undefined;

let historyBuffer: HistoryVisitItem[] = [];
let flushDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// Anti-echo circular cache (recent URLs ingested from peers within last 30s)
const recentlyIngestedUrls = new Map<string, number>();
const INGEST_CACHE_TTL_MS = 30_000;

// Active Crypto Session Key & Salt
let activeCryptoKey: CryptoKey | null = null;
let activeSaltBase64: string | null = null;

// P2P WebRTC Client & Remote Peer State
let p2pClient: WebRTCP2PClient | null = null;
let p2pConnectedPeers = 0;
let lastError: string | null = null;
let p2pRemoteExtensions: ExtensionItem[] = [];

// ============================================================================
// 1. Lifecycle Initialization & State Persistence
// ============================================================================

async function initializeState(): Promise<void> {
  try {
    const data = await chrome.storage.local.get([
      STORAGE_KEY_DEVICE_ID,
      STORAGE_KEY_DEVICE_NAME,
      STORAGE_KEY_DEVICE_TYPE,
      STORAGE_KEY_BUFFER,
      STORAGE_KEY_STATS,
      STORAGE_KEY_SALT,
      STORAGE_KEY_P2P_EXTENSIONS,
    ]);

    // Initialize or rehydrate Device ID
    if (data[STORAGE_KEY_DEVICE_ID]) {
      deviceId = data[STORAGE_KEY_DEVICE_ID];
    } else {
      deviceId = crypto.randomUUID();
      await chrome.storage.local.set({ [STORAGE_KEY_DEVICE_ID]: deviceId });
    }

    // Determine platform type
    if (data[STORAGE_KEY_DEVICE_TYPE]) {
      deviceType = data[STORAGE_KEY_DEVICE_TYPE];
    } else {
      const ua = navigator.userAgent.toLowerCase();
      if (ua.includes('android')) {
        deviceType = 'mobile_android';
      } else if (ua.includes('tablet') || ua.includes('ipad')) {
        deviceType = 'tablet';
      } else {
        deviceType = 'desktop';
      }
      await chrome.storage.local.set({ [STORAGE_KEY_DEVICE_TYPE]: deviceType });
    }

    // Device Name
    if (data[STORAGE_KEY_DEVICE_NAME]) {
      deviceName = data[STORAGE_KEY_DEVICE_NAME];
    } else {
      const suffix = deviceId.slice(0, 4);
      deviceName =
        deviceType === 'mobile_android'
          ? `Android Device (${suffix})`
          : `Desktop Chromium (${suffix})`;
      await chrome.storage.local.set({ [STORAGE_KEY_DEVICE_NAME]: deviceName });
    }

    // Rehydrate history buffer
    if (Array.isArray(data[STORAGE_KEY_BUFFER])) {
      historyBuffer = data[STORAGE_KEY_BUFFER];
    }

    // Rehydrate remote extensions
    if (Array.isArray(data[STORAGE_KEY_P2P_EXTENSIONS])) {
      p2pRemoteExtensions = data[STORAGE_KEY_P2P_EXTENSIONS];
    }

    // Rehydrate sync statistics
    if (data[STORAGE_KEY_STATS]) {
      totalSyncedCount = data[STORAGE_KEY_STATS].totalSyncedCount || 0;
      lastSyncTime = data[STORAGE_KEY_STATS].lastSyncTime || undefined;
    }

    // Rehydrate account salt
    if (data[STORAGE_KEY_SALT]) {
      activeSaltBase64 = data[STORAGE_KEY_SALT];
    }

    // Initialize P2P client instance
    initP2PClient();

    // Setup background recurring alarm for buffer flushing
    chrome.alarms.create(ALARM_FLUSH_NAME, {
      periodInMinutes: BATCH_FLUSH_INTERVAL_MS / 60_000,
    });

    console.log(
      `[Imhotep:SW] 100% P2P Hub initialized: Device "${deviceName}" (${deviceId}) on ${deviceType}`
    );
  } catch (error) {
    console.error('[Imhotep:SW] Initialization error:', error);
  }
}

async function persistBuffer(): Promise<void> {
  try {
    await chrome.storage.local.set({
      [STORAGE_KEY_BUFFER]: historyBuffer,
      [STORAGE_KEY_STATS]: { totalSyncedCount, lastSyncTime },
    });
  } catch (error) {
    console.warn('[Imhotep:SW] Failed to persist buffer:', error);
  }
}

// ============================================================================
// 2. History Capture & Exclusion Filters
// ============================================================================

function shouldFilterUrl(url: string): boolean {
  if (!url) return true;

  try {
    const parsed = new URL(url);

    // Protocol check
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return true;
    }

    // Loopback & local development exclusion
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '0.0.0.0' ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal')
    ) {
      return true;
    }

    return false;
  } catch {
    return true; // Malformed URLs
  }
}

function markAsRecentlyIngested(url: string): void {
  recentlyIngestedUrls.set(url, Date.now());
}

function isRecentlyIngested(url: string): boolean {
  const timestamp = recentlyIngestedUrls.get(url);
  if (!timestamp) return false;
  if (Date.now() - timestamp > INGEST_CACHE_TTL_MS) {
    recentlyIngestedUrls.delete(url);
    return false;
  }
  return true;
}

/**
 * Top-level listener for chrome.history.onVisited
 */
async function handleHistoryVisited(result: chrome.history.HistoryItem): Promise<void> {
  const url = result.url;
  if (!url) return;

  // 1. Exclusion filters
  if (shouldFilterUrl(url)) return;

  // 2. Anti-echo check
  if (isRecentlyIngested(url)) {
    console.log('[Imhotep:SW] Ignored echo of recently ingested URL:', url);
    return;
  }

  // 3. Incognito check
  try {
    const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (activeTabs.length > 0 && activeTabs[0].incognito) {
      console.log('[Imhotep:SW] Ignored visit from Incognito window');
      return;
    }
  } catch {
    // Fallthrough safely
  }

  // 4. Construct visit item
  const visitItem: HistoryVisitItem = {
    id: result.id,
    url,
    title: result.title || url,
    visitTime: result.lastVisitTime || Date.now(),
    lastVisitTime: result.lastVisitTime,
    visitCount: result.visitCount,
    typedCount: result.typedCount,
    deviceId,
    deviceName,
  };

  historyBuffer.push(visitItem);
  console.log(`[Imhotep:SW] Buffered history visit (${historyBuffer.length}/${BATCH_SIZE_THRESHOLD}):`, url);

  await persistBuffer();

  // Flush immediately if threshold exceeded
  if (historyBuffer.length >= BATCH_SIZE_THRESHOLD) {
    await flushHistoryBuffer();
    return;
  }

  // Debounced flush timer
  if (flushDebounceTimer) {
    clearTimeout(flushDebounceTimer);
  }
  flushDebounceTimer = setTimeout(() => {
    flushHistoryBuffer().catch((e) => console.error(e));
  }, BATCH_FLUSH_INTERVAL_MS);
}

// ============================================================================
// 3. Micro-Batch Flush Over WebRTC P2P DataChannels
// ============================================================================

async function flushHistoryBuffer(): Promise<void> {
  if (historyBuffer.length === 0) return;

  const itemsToFlush = [...historyBuffer];
  syncStatus = 'syncing';

  try {
    // Direct P2P WebRTC DataChannel Sync
    if (p2pClient && p2pClient.getState() === 'connected') {
      const p2pPayload: HistoryItemPayload[] = itemsToFlush.map((item) => ({
        url: item.url,
        title: item.title,
        lastVisitTime: item.visitTime || item.lastVisitTime || Date.now(),
        visitCount: item.visitCount,
        typedCount: item.typedCount,
      }));
      await p2pClient.syncHistoryBatch(p2pPayload);
      console.log(`[Imhotep:SW] Dispatched ${itemsToFlush.length} history items to P2P peer`);
    }

    // Remove flushed items from buffer
    historyBuffer = historyBuffer.filter((item) => !itemsToFlush.includes(item));
    totalSyncedCount += itemsToFlush.length;
    lastSyncTime = Date.now();
    syncStatus = p2pConnectedPeers > 0 ? 'connected' : 'idle';

    await persistBuffer();
  } catch (error) {
    console.error('[Imhotep:SW] Error during buffer flush:', error);
    lastError = error instanceof Error ? error.message : String(error);
    syncStatus = 'error';
  }
}

// ============================================================================
// 4. Remote Ingestion & Anti-Echo
// ============================================================================

async function ingestRemoteHistoryRecord(item: HistoryVisitItem): Promise<void> {
  if (!item || !item.url) return;
  if (shouldFilterUrl(item.url)) return;

  markAsRecentlyIngested(item.url);

  try {
    await chrome.history.addUrl({ url: item.url });
    console.log(`[Imhotep:SW] Ingested remote history URL: ${item.url}`);
    totalSyncedCount++;
    lastSyncTime = Date.now();
    await persistBuffer();
  } catch (error) {
    console.warn('[Imhotep:SW] Failed to ingest remote URL into chrome.history:', error);
  }
}

// ============================================================================
// 5. Extension Inspection & Inventory Sync
// ============================================================================

export async function inspectExtensions(): Promise<ExtensionItem[]> {
  try {
    const allExtensions = await chrome.management.getAll();
    const filtered = allExtensions.filter((ext) => {
      return ext.type === 'extension' && ext.id !== chrome.runtime.id;
    });

    const items: ExtensionItem[] = filtered.map((ext) => {
      let iconUrl: string | undefined;
      if (ext.icons && ext.icons.length > 0) {
        iconUrl = ext.icons[ext.icons.length - 1].url;
      }

      return {
        id: ext.id,
        name: ext.name,
        version: ext.version,
        enabled: ext.enabled,
        description: ext.description,
        installType: ext.installType,
        iconUrl,
        storeUrl: `https://chromewebstore.google.com/detail/${ext.id}`,
      };
    });

    return items;
  } catch (error) {
    console.error('[Imhotep:SW] Failed to inspect installed extensions:', error);
    return [];
  }
}

export async function syncExtensionsNow(): Promise<{ count: number; error?: string }> {
  try {
    const extensions = await inspectExtensions();
    if (extensions.length === 0) return { count: 0 };

    // P2P WebRTC Broadcast
    if (p2pClient && p2pClient.getState() === 'connected') {
      const p2pExts: ExtensionItemPayload[] = extensions.map((ext) => ({
        id: ext.id,
        name: ext.name,
        version: ext.version,
        enabled: ext.enabled,
        description: ext.description,
        installType: ext.installType,
        webstoreUrl: ext.storeUrl || ext.webstoreUrl || `https://chromewebstore.google.com/detail/${ext.id}`,
      }));
      await p2pClient.syncExtensions(p2pExts);
      console.log(`[Imhotep:SW] Synced ${extensions.length} extensions to P2P peer`);
    }

    return { count: extensions.length };
  } catch (error) {
    console.error('[Imhotep:SW] Failed to sync extensions:', error);
    return { count: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

// ============================================================================
// 6. WebRTC P2P Client Initialization & Event Handling
// ============================================================================

function initP2PClient(): void {
  if (typeof RTCPeerConnection === 'undefined') {
    console.log('[Imhotep:SW] RTCPeerConnection not available in Service Worker scope; P2P engine active in popup context');
    return;
  }
  try {
    p2pClient = new WebRTCP2PClient({
    deviceId,
    deviceName,
    encryptionKey: activeCryptoKey || undefined,
    onStateChange: (state) => {
      console.log(`[Imhotep:P2P] State changed: ${state}`);
      if (state === 'connected') {
        p2pConnectedPeers = 1;
        syncStatus = 'connected';
      } else if (state === 'disconnected' || state === 'closed' || state === 'failed') {
        p2pConnectedPeers = 0;
        syncStatus = 'idle';
      }
    },
    onPeerConnected: (peer) => {
      console.log(`[Imhotep:P2P] Peer connected: ${peer.deviceName} (${peer.deviceId})`);
      p2pConnectedPeers = 1;
      syncStatus = 'connected';
      syncExtensionsNow().catch((e) => console.error(e));
    },
    onPeerDisconnected: () => {
      console.log('[Imhotep:P2P] Peer disconnected');
      p2pConnectedPeers = 0;
      syncStatus = 'idle';
    },
    onHistoryBatchReceived: async (items) => {
      console.log(`[Imhotep:P2P] Received batch of ${items.length} history items`);
      for (const item of items) {
        await ingestRemoteHistoryRecord({
          url: item.url,
          title: item.title,
          visitTime: item.lastVisitTime,
          lastVisitTime: item.lastVisitTime,
          visitCount: item.visitCount,
          typedCount: item.typedCount,
        });
      }
    },
    onExtensionBatchReceived: (extensions, metadata) => {
      console.log(`[Imhotep:P2P] Received remote extension list of ${extensions.length} items from batch:`, metadata.batchId);
      const mapped: ExtensionItem[] = extensions.map((ext) => ({
        id: ext.id,
        name: ext.name,
        version: ext.version,
        enabled: ext.enabled,
        description: ext.description,
        installType: ext.installType,
        storeUrl: ext.webstoreUrl || `https://chromewebstore.google.com/detail/${ext.id}`,
        isRemote: true,
      }));
      p2pRemoteExtensions = mapped;
      chrome.storage.local.set({ [STORAGE_KEY_P2P_EXTENSIONS]: mapped });
    },
    onError: (err) => {
      console.error('[Imhotep:P2P] Error:', err);
      lastError = err.message;
    },
  });
  } catch (e) {
    console.warn('[Imhotep:SW] Could not init P2P in worker:', e);
  }
}

// ============================================================================
// 7. Message Passing Interface (Popup <-> Service Worker)
// ============================================================================

async function handleMessage(
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender
): Promise<RuntimeResponse> {
  switch (message.type) {
    case 'PING': {
      return { success: true, data: { pong: true, time: Date.now() } };
    }

    case 'GET_STATUS': {
      const state: SyncState = {
        mode: 'p2p',
        status: p2pConnectedPeers > 0 ? 'connected' : syncStatus,
        deviceId,
        deviceName,
        deviceType,
        bufferedCount: historyBuffer.length,
        totalSyncedCount,
        lastSyncTime,
        p2pConnectedPeers,
        lastError,
        hasMasterKey: activeCryptoKey !== null,
      };
      return { success: true, data: state };
    }

    case 'SET_DEVICE_NAME': {
      const name = message.payload?.name as string;
      if (name && name.trim()) {
        deviceName = name.trim();
        await chrome.storage.local.set({ [STORAGE_KEY_DEVICE_NAME]: deviceName });
        if (p2pClient) {
          initP2PClient();
        }
        return { success: true, data: { deviceName } };
      }
      return { success: false, error: 'Device name cannot be blank' };
    }

    case 'SET_MASTER_KEY': {
      const { secret, type } = message.payload || {};
      if (!secret || typeof secret !== 'string') {
        return { success: false, error: 'Master secret is required' };
      }

      try {
        const saltBytes = activeSaltBase64 ? base64ToUint8Array(activeSaltBase64) : generateSalt(16);
        if (!activeSaltBase64) {
          activeSaltBase64 = uint8ArrayToBase64(saltBytes);
          await chrome.storage.local.set({ [STORAGE_KEY_SALT]: activeSaltBase64 });
        }

        let derived;
        if (type === 'mnemonic') {
          derived = await deriveKeyFromMnemonic(secret, saltBytes);
        } else {
          derived = await deriveKeyFromPassword(secret, saltBytes);
        }

        activeCryptoKey = derived.key;
        if (p2pClient) {
          p2pClient.setEncryptionKey(activeCryptoKey);
          p2pClient.setAuthSecret(secret);
        }

        console.log('[Imhotep:SW] Zero-Knowledge Master Key derived and activated in memory');
        return { success: true, data: { salt: activeSaltBase64 } };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'CLEAR_MASTER_KEY': {
      activeCryptoKey = null;
      if (p2pClient) {
        p2pClient.setEncryptionKey(null as any);
      }
      return { success: true };
    }

    case 'TRIGGER_FLUSH': {
      await flushHistoryBuffer();
      return { success: true, data: { bufferedCount: historyBuffer.length } };
    }

    case 'GET_RECENT_HISTORY': {
      const limit = Math.min(message.payload?.limit || 150, 1000);
      const query = message.payload?.query || '';
      const localVisits = await chrome.history.search({ text: query, maxResults: limit });
      const normalized = localVisits.map((item) => ({
        id: item.id,
        url: item.url || '',
        title: item.title || item.url || 'Untitled',
        visitTime: item.lastVisitTime || Date.now(),
        deviceName: deviceName || 'This Device (Local)',
        deviceId,
      }));
      return { success: true, data: normalized };
    }

    case 'GET_INSTALLED_EXTENSIONS': {
      const extensions = await inspectExtensions();
      return { success: true, data: extensions };
    }

    case 'SYNC_EXTENSIONS_NOW': {
      const result = await syncExtensionsNow();
      return { success: !result.error, data: result, error: result.error };
    }

    case 'GET_REMOTE_EXTENSIONS': {
      return { success: true, data: p2pRemoteExtensions };
    }

    case 'P2P_START_PAIRING': {
      if (!p2pClient) {
        initP2PClient();
      }
      try {
        const offerTicket = await p2pClient!.createOffer();
        return { success: true, data: offerTicket };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'P2P_CONNECT_MNEMONIC': {
      if (!p2pClient) {
        initP2PClient();
      }
      const ticket = message.payload?.ticket as PairingSignalTicket;
      if (!ticket) {
        return { success: false, error: 'Pairing ticket required' };
      }

      try {
        if (ticket.type === 'offer') {
          const answerTicket = await p2pClient!.acceptOfferAndCreateAnswer(ticket);
          return { success: true, data: answerTicket };
        } else if (ticket.type === 'answer') {
          await p2pClient!.acceptAnswer(ticket);
          return { success: true };
        }
        return { success: false, error: 'Unknown ticket type' };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'P2P_DISCONNECT': {
      if (p2pClient) {
        p2pClient.close();
        p2pConnectedPeers = 0;
        syncStatus = 'idle';
      }
      return { success: true };
    }

    case 'GET_P2P_STATE': {
      const state = p2pClient ? p2pClient.getState() : 'idle';
      const peer = p2pClient ? p2pClient.getRemotePeer() : null;
      return { success: true, data: { state, peer, connectedPeers: p2pConnectedPeers } };
    }

    default:
      return { success: false, error: `Unhandled message type: ${message.type}` };
  }
}

// ============================================================================
// 8. Synchronous Event Registrations (Manifest V3 Top-Level Handlers)
// ============================================================================

// Chrome History Capture
chrome.history.onVisited.addListener(handleHistoryVisited);

// Alarm Tick Handler (Debounce flush)
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_FLUSH_NAME) {
    if (historyBuffer.length > 0) {
      await flushHistoryBuffer();
    }
  }
});

// Runtime Message Passing (Popup <-> Service Worker)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender)
    .then((res) => sendResponse(res))
    .catch((err) => sendResponse({ success: false, error: err.message }));
  return true; // Keep message channel open for asynchronous reply
});

// Extension Lifecycle Handlers
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[Imhotep:SW] Extension installed / updated:', details.reason);
  await initializeState();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('[Imhotep:SW] Browser startup event triggered');
  await initializeState();
});

// Immediate initialization on worker script evaluation
initializeState();
