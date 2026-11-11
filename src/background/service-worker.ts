/**
 * Imhotep Browser Sync - Chrome Manifest V3 Background Service Worker
 *
 * Coordinates:
 * 1. MV3 Lifecycle & Event Dispatching (history, alarms, messaging, startup).
 * 2. Automated History Capture with Micro-Batch Debounce (every 20s or 15 items).
 * 3. Strict Exclusion Filters (internal protocols, private IPs, loopbacks, incognito).
 * 4. Zero-Knowledge Remote Ingestion into Chrome History with Anti-Echo deduplication.
 * 5. Extension Inspection & Synchronization with 1-Click Web Store Reinstall links.
 * 6. Supabase Realtime replication & WebRTC P2P DataChannel coordination.
 */

import {
  SyncState,
  SyncMode,
  SyncStatus,
  DeviceType,
  DeviceRecord,
  HistoryVisitItem,
  HistorySyncRecord,
  ExtensionItem,
  ExtensionSyncRecord,
  CloudConfig,
  RuntimeMessage,
  RuntimeResponse,
} from '../types/sync';
import {
  deriveKeyFromPassword,
  deriveKeyFromMnemonic,
  encryptData,
  decryptData,
  uint8ArrayToBase64,
  base64ToUint8Array,
  generateSalt,
} from '../crypto/e2ee';
import { supabaseVault } from '../cloud/supabase-client';
import { WebRTCP2PClient } from '../p2p/webrtc';
import { PairingSignalTicket, HistoryItemPayload, ExtensionItemPayload } from '../types/p2p';

// ============================================================================
// Constants & Configuration
// ============================================================================

const BATCH_SIZE_THRESHOLD = 15;
const BATCH_FLUSH_INTERVAL_MS = 20_000; // 20 seconds
const ALARM_FLUSH_NAME = 'imhotep_flush_buffer_alarm';
const ALARM_HEARTBEAT_NAME = 'imhotep_heartbeat_alarm';

const STORAGE_KEY_DEVICE_ID = 'imhotep_device_id';
const STORAGE_KEY_DEVICE_NAME = 'imhotep_device_name';
const STORAGE_KEY_DEVICE_TYPE = 'imhotep_device_type';
const STORAGE_KEY_SYNC_MODE = 'imhotep_sync_mode';
const STORAGE_KEY_BUFFER = 'imhotep_history_buffer';
const STORAGE_KEY_STATS = 'imhotep_sync_stats';
const STORAGE_KEY_SALT = 'imhotep_account_salt';

// ============================================================================
// Service Worker In-Memory State (Rehydrated from chrome.storage.local)
// ============================================================================

let deviceId = '';
let deviceName = '';
let deviceType: DeviceType = 'desktop';
let syncMode: SyncMode = 'p2p';
let syncStatus: SyncStatus = 'idle';
let totalSyncedCount = 0;
let lastSyncTime: number | undefined;

let historyBuffer: HistoryVisitItem[] = [];
let flushDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// Anti-echo circular sync prevention cache: Map<url, timestamp>
const recentIngestedUrls = new Map<string, number>();
const CIRCULAR_CACHE_TTL_MS = 60_000; // 60 seconds

// Ephemeral in-memory CryptoKey (never written to persistent disk storage)
let activeCryptoKey: CryptoKey | null = null;
let activeSaltBase64: string | null = null;

// WebRTC P2P Client instance
let p2pClient: WebRTCP2PClient | null = null;
let p2pConnectedPeers = 0;
let lastError: string | null = null;

// ============================================================================
// 1. Initialization & State Persistence
// ============================================================================

/**
 * Detects browser environment (Desktop vs Android Chromium like Kiwi / Lemur).
 */
function detectDeviceType(): DeviceType {
  const ua = navigator.userAgent.toLowerCase();
  if (/android/.test(ua)) {
    if (/tablet/.test(ua) || (window.screen && Math.min(window.screen.width, window.screen.height) >= 600)) {
      return 'tablet';
    }
    return 'mobile_android';
  }
  return 'desktop';
}

/**
 * Initializes device identity and recovers state from chrome.storage.local.
 */
async function initializeState(): Promise<void> {
  try {
    const data = await chrome.storage.local.get([
      STORAGE_KEY_DEVICE_ID,
      STORAGE_KEY_DEVICE_NAME,
      STORAGE_KEY_DEVICE_TYPE,
      STORAGE_KEY_SYNC_MODE,
      STORAGE_KEY_BUFFER,
      STORAGE_KEY_STATS,
      STORAGE_KEY_SALT,
    ]);

    // Device ID (UUID v4)
    if (data[STORAGE_KEY_DEVICE_ID]) {
      deviceId = data[STORAGE_KEY_DEVICE_ID];
    } else {
      deviceId = crypto.randomUUID();
      await chrome.storage.local.set({ [STORAGE_KEY_DEVICE_ID]: deviceId });
    }

    // Device Type
    deviceType = data[STORAGE_KEY_DEVICE_TYPE] || detectDeviceType();

    // Device Name
    if (data[STORAGE_KEY_DEVICE_NAME]) {
      deviceName = data[STORAGE_KEY_DEVICE_NAME];
    } else {
      const typeLabel = deviceType === 'desktop' ? 'Desktop' : 'Android';
      deviceName = `Imhotep ${typeLabel} (${deviceId.substring(0, 4)})`;
      await chrome.storage.local.set({ [STORAGE_KEY_DEVICE_NAME]: deviceName });
    }

    // Sync Mode
    syncMode = data[STORAGE_KEY_SYNC_MODE] || 'p2p';

    // Account Salt
    activeSaltBase64 = data[STORAGE_KEY_SALT] || null;

    // Buffer Recovery
    if (Array.isArray(data[STORAGE_KEY_BUFFER])) {
      historyBuffer = data[STORAGE_KEY_BUFFER];
    }

    // Stats Recovery
    if (data[STORAGE_KEY_STATS]) {
      totalSyncedCount = data[STORAGE_KEY_STATS].totalSyncedCount || 0;
      lastSyncTime = data[STORAGE_KEY_STATS].lastSyncTime;
    }

    console.log(`[Imhotep:SW] Initialized device: ${deviceName} (${deviceId}) [${syncMode}]`);

    // Setup periodic flush alarm & heartbeat alarm
    await chrome.alarms.create(ALARM_FLUSH_NAME, { periodInMinutes: 0.33 }); // ~20 seconds
    await chrome.alarms.create(ALARM_HEARTBEAT_NAME, { periodInMinutes: 5 });

    // Initialize P2P client instance
    initP2PClient();

    // If Cloud sync enabled and session active, subscribe to Supabase Realtime
    if (syncMode === 'cloud') {
      await setupCloudRealtimeSync();
    }
  } catch (error) {
    console.error('[Imhotep:SW] State initialization failed:', error);
  }
}

/**
 * Persists volatile buffer and stats to storage.
 */
async function persistBuffer(): Promise<void> {
  try {
    await chrome.storage.local.set({
      [STORAGE_KEY_BUFFER]: historyBuffer,
      [STORAGE_KEY_STATS]: {
        totalSyncedCount,
        lastSyncTime,
      },
    });
  } catch (error) {
    console.error('[Imhotep:SW] Failed to persist buffer:', error);
  }
}

// ============================================================================
// 2. History Capture & Exclusion Filters
// ============================================================================

/**
 * Evaluates whether a URL should be excluded according to privacy & telemetry rules.
 */
function shouldFilterUrl(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return true;

  // Ignore internal protocol schemes
  const excludedPrefixes = [
    'chrome://',
    'chrome-extension://',
    'edge://',
    'brave://',
    'about:',
    'view-source:',
    'devtools://',
    'data:',
    'blob:',
    'javascript:',
  ];

  for (const prefix of excludedPrefixes) {
    if (rawUrl.startsWith(prefix)) return true;
  }

  try {
    const parsed = new URL(rawUrl);
    // Allow only http: and https:
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return true;
    }

    // Exclude localhost, loopback, and private test hostnames
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.lan')
    ) {
      return true;
    }
  } catch {
    // Malformed URL
    return true;
  }

  return false;
}

/**
 * Anti-echo verification to prevent circular synchronization.
 */
function isRecentlyIngested(url: string): boolean {
  const now = Date.now();
  const timestamp = recentIngestedUrls.get(url);
  if (timestamp && now - timestamp < CIRCULAR_CACHE_TTL_MS) {
    return true;
  }
  return false;
}

function markAsRecentlyIngested(url: string): void {
  recentIngestedUrls.set(url, Date.now());
  // Periodic cleanup
  if (recentIngestedUrls.size > 200) {
    const cutoff = Date.now() - CIRCULAR_CACHE_TTL_MS;
    for (const [key, time] of recentIngestedUrls.entries()) {
      if (time < cutoff) {
        recentIngestedUrls.delete(key);
      }
    }
  }
}

/**
 * Chrome History onVisited event listener handler.
 */
async function handleHistoryVisited(historyItem: chrome.history.HistoryItem): Promise<void> {
  const url = historyItem.url;
  if (!url) return;

  // Exclusion filters check
  if (shouldFilterUrl(url)) return;

  // Ignore incognito visits if running in incognito context
  if (chrome.extension?.inIncognitoContext) return;

  // Check anti-echo cache
  if (isRecentlyIngested(url)) return;

  const visit: HistoryVisitItem = {
    id: historyItem.id,
    url: url,
    title: historyItem.title || '',
    visitTime: historyItem.lastVisitTime || Date.now(),
    visitCount: historyItem.visitCount,
    typedCount: historyItem.typedCount,
    deviceId: deviceId,
    deviceName: deviceName,
  };

  historyBuffer.push(visit);
  await persistBuffer();

  console.log(`[Imhotep:SW] Captured visit (${historyBuffer.length}/${BATCH_SIZE_THRESHOLD}): ${url}`);

  // Micro-batch debounce threshold checks:
  // Immediate flush if buffer >= 15 items
  if (historyBuffer.length >= BATCH_SIZE_THRESHOLD) {
    if (flushDebounceTimer) {
      clearTimeout(flushDebounceTimer);
      flushDebounceTimer = null;
    }
    await flushHistoryBuffer();
  } else {
    // Schedule debounced flush after 20 seconds
    if (!flushDebounceTimer) {
      flushDebounceTimer = setTimeout(async () => {
        flushDebounceTimer = null;
        await flushHistoryBuffer();
      }, BATCH_FLUSH_INTERVAL_MS);
    }
  }
}

// ============================================================================
// 3. Micro-Batch Flush & Zero-Knowledge Transmission
// ============================================================================

/**
 * Flushes buffered history items over Cloud Vault (Supabase) or P2P DataChannels.
 */
async function flushHistoryBuffer(): Promise<void> {
  if (historyBuffer.length === 0) return;

  const itemsToFlush = [...historyBuffer];
  syncStatus = 'syncing';

  try {
    // 1. Cloud Vault Sync Mode
    if (syncMode === 'cloud') {
      const session = await supabaseVault.getCurrentSession();
      if (!session || !session.user) {
        console.log('[Imhotep:SW] Cloud sync skipped: User not authenticated');
        syncStatus = 'idle';
        return;
      }

      if (!activeCryptoKey) {
        console.warn('[Imhotep:SW] Cloud sync waiting for user master password decryption key');
        syncStatus = 'idle';
        return;
      }

      const records: HistorySyncRecord[] = [];
      for (const item of itemsToFlush) {
        const encrypted = await encryptData(item, activeCryptoKey);
        records.push({
          user_id: session.user.id,
          device_id: deviceId,
          encrypted_payload: encrypted.ciphertext,
          payload_iv: encrypted.iv,
          visit_timestamp: new Date(item.visitTime).toISOString(),
        });
      }

      await supabaseVault.uploadHistoryBatch(records);
      console.log(`[Imhotep:SW] Uploaded ${records.length} encrypted history items to Cloud Vault`);
    }

    // 2. Direct P2P WebRTC DataChannel Sync
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
    syncStatus = 'idle';

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

/**
 * Ingests a decrypted history record received from a remote peer or cloud sync.
 */
async function ingestRemoteHistoryRecord(item: HistoryVisitItem): Promise<void> {
  if (!item || !item.url) return;
  if (shouldFilterUrl(item.url)) return;

  // Mark in circular cache to avoid echo back into buffer
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

/**
 * Inspects all installed Chrome extensions, filters out internal/themes,
 * and builds a canonical inventory with 1-click Web Store links.
 */
export async function inspectExtensions(): Promise<ExtensionItem[]> {
  try {
    const allExtensions = await chrome.management.getAll();
    const filtered = allExtensions.filter((ext) => {
      // Exclude themes and self
      return ext.type === 'extension' && ext.id !== chrome.runtime.id;
    });

    const items: ExtensionItem[] = filtered.map((ext) => {
      let iconUrl: string | undefined;
      if (ext.icons && ext.icons.length > 0) {
        // Pick largest available icon
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

/**
 * Encrypts and synchronizes the extension inventory to Supabase Cloud Vault and P2P peers.
 */
export async function syncExtensionsNow(): Promise<{ count: number; error?: string }> {
  try {
    const extensions = await inspectExtensions();
    if (extensions.length === 0) return { count: 0 };

    // 1. Cloud Vault Upload
    if (syncMode === 'cloud') {
      const session = await supabaseVault.getCurrentSession();
      if (session && session.user && activeCryptoKey) {
        const encrypted = await encryptData(extensions, activeCryptoKey);
        await supabaseVault.uploadExtensionSync({
          user_id: session.user.id,
          device_id: deviceId,
          encrypted_payload: encrypted.ciphertext,
          payload_iv: encrypted.iv,
        });
        console.log(`[Imhotep:SW] Synced ${extensions.length} extensions to Cloud Vault`);
      }
    }

    // 2. P2P WebRTC Broadcast
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
// 6. Cloud Vault Realtime Subscriptions
// ============================================================================

/**
 * Configures Supabase Realtime WebSocket listeners for history and extension replication.
 */
async function setupCloudRealtimeSync(): Promise<void> {
  try {
    const session = await supabaseVault.getCurrentSession();
    if (!session || !session.user) return;

    const userId = session.user.id;

    // Register this device record
    const deviceRecord: DeviceRecord = {
      id: deviceId,
      user_id: userId,
      device_name: deviceName,
      device_type: deviceType,
      last_seen: new Date().toISOString(),
    };
    await supabaseVault.registerDevice(deviceRecord);

    // Subscribe to incoming history items
    await supabaseVault.subscribeToHistorySync(userId, async (record) => {
      // Ignore records originating from this device
      if (record.device_id === deviceId) return;

      if (!activeCryptoKey) {
        console.warn('[Imhotep:Realtime] Cannot decrypt incoming history: Master key not loaded');
        return;
      }

      try {
        const decryptedItem = await decryptData<HistoryVisitItem>(
          { ciphertext: record.encrypted_payload, iv: record.payload_iv, version: 1 },
          activeCryptoKey
        );
        await ingestRemoteHistoryRecord(decryptedItem);
      } catch (err) {
        console.error('[Imhotep:Realtime] Failed to decrypt incoming history record:', err);
      }
    });

    // Subscribe to extension inventory updates
    await supabaseVault.subscribeToExtensionSync(userId, (record) => {
      if (record.device_id === deviceId) return;
      console.log('[Imhotep:Realtime] Received remote extension inventory update from device:', record.device_id);
    });

    console.log('[Imhotep:Realtime] Cloud Realtime replication active for user:', userId);
  } catch (error) {
    console.error('[Imhotep:Realtime] Setup failed:', error);
  }
}

// ============================================================================
// 7. WebRTC P2P Client Initialization & Event Handling
// ============================================================================

function initP2PClient(): void {
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
      // Trigger initial extension sync to newly connected peer
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
    },
    onError: (err) => {
      console.error('[Imhotep:P2P] Error:', err);
      lastError = err.message;
    },
  });
}

// ============================================================================
// 8. Message Passing Interface (Popup <-> Service Worker)
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
      const session = await supabaseVault.getCurrentSession();
      const state: SyncState = {
        mode: syncMode,
        status: syncStatus,
        deviceId,
        deviceName,
        deviceType,
        bufferedCount: historyBuffer.length,
        totalSyncedCount,
        lastSyncTime,
        isCloudAuthenticated: !!(session && session.user),
        userEmail: session?.user?.email || null,
        p2pConnectedPeers,
        lastError,
        hasMasterKey: activeCryptoKey !== null,
      };
      return { success: true, data: state };
    }

    case 'SET_SYNC_MODE': {
      const newMode = message.payload?.mode as SyncMode;
      if (newMode && ['p2p', 'cloud', 'offline'].includes(newMode)) {
        syncMode = newMode;
        await chrome.storage.local.set({ [STORAGE_KEY_SYNC_MODE]: syncMode });
        if (syncMode === 'cloud') {
          await setupCloudRealtimeSync();
        } else {
          await supabaseVault.unsubscribeAll();
        }
        return { success: true, data: { mode: syncMode } };
      }
      return { success: false, error: 'Invalid sync mode specified' };
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

    case 'SET_CLOUD_CONFIG': {
      const config = message.payload as CloudConfig;
      if (config && config.supabaseUrl && config.supabaseAnonKey) {
        await supabaseVault.saveCloudConfig(config);
        return { success: true };
      }
      return { success: false, error: 'Missing Supabase URL or Anon Key' };
    }

    case 'GET_CLOUD_CONFIG': {
      const config = await supabaseVault.loadCloudConfig();
      return { success: true, data: config };
    }

    case 'AUTH_SIGN_IN': {
      const { email, password } = message.payload || {};
      if (!email || !password) {
        return { success: false, error: 'Email and password required' };
      }
      const { user, error } = await supabaseVault.signIn(email, password);
      if (error || !user) {
        return { success: false, error: error?.message || 'Authentication failed' };
      }

      // Check / fetch user E2EE salt profile
      try {
        const profile = await supabaseVault.getProfile(user.id);
        if (profile) {
          activeSaltBase64 = profile.salt;
          await chrome.storage.local.set({ [STORAGE_KEY_SALT]: profile.salt });
        }
      } catch (e) {
        console.warn('[Imhotep:SW] Could not fetch profile salt:', e);
      }

      await setupCloudRealtimeSync();
      return { success: true, data: { user } };
    }

    case 'AUTH_SIGN_UP': {
      const { email, password } = message.payload || {};
      if (!email || !password) {
        return { success: false, error: 'Email and password required' };
      }
      const { user, error } = await supabaseVault.signUp(email, password);
      if (error || !user) {
        return { success: false, error: error?.message || 'Sign up failed' };
      }

      // Generate new cryptographically secure 16-byte salt for user PBKDF2 vault
      const newSaltBytes = generateSalt(16);
      const newSaltBase64 = uint8ArrayToBase64(newSaltBytes);
      activeSaltBase64 = newSaltBase64;
      await chrome.storage.local.set({ [STORAGE_KEY_SALT]: newSaltBase64 });

      try {
        await supabaseVault.upsertProfile({
          user_id: user.id,
          salt: newSaltBase64,
          device_count: 1,
        });
      } catch (err) {
        console.error('[Imhotep:SW] Failed to persist profile salt:', err);
      }

      await setupCloudRealtimeSync();
      return { success: true, data: { user, salt: newSaltBase64 } };
    }

    case 'AUTH_SIGN_OUT': {
      const { error } = await supabaseVault.signOut();
      activeCryptoKey = null;
      if (p2pClient) {
        p2pClient.setEncryptionKey(null as any);
      }
      if (error) {
        return { success: false, error: error.message };
      }
      return { success: true };
    }

    case 'AUTH_GET_SESSION': {
      const session = await supabaseVault.getCurrentSession();
      return { success: true, data: session };
    }

    case 'SET_MASTER_KEY': {
      const { secret, type } = message.payload || {};
      if (!secret || typeof secret !== 'string') {
        return { success: false, error: 'Master secret is required' };
      }

      try {
        const salt = activeSaltBase64 ? base64ToUint8Array(activeSaltBase64) : generateSalt(16);
        if (!activeSaltBase64) {
          activeSaltBase64 = uint8ArrayToBase64(salt);
          await chrome.storage.local.set({ [STORAGE_KEY_SALT]: activeSaltBase64 });
        }

        let derivedResult;
        if (type === 'mnemonic') {
          derivedResult = await deriveKeyFromMnemonic(secret, salt);
        } else {
          derivedResult = await deriveKeyFromPassword(secret, salt);
        }

        activeCryptoKey = derivedResult.key;

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
      const limit = message.payload?.limit || 50;
      const localVisits = await chrome.history.search({ text: '', maxResults: limit });
      return { success: true, data: localVisits };
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
      const session = await supabaseVault.getCurrentSession();
      if (!session || !session.user) {
        return { success: false, error: 'Cloud authentication required' };
      }
      if (!activeCryptoKey) {
        return { success: false, error: 'Master encryption key required to decrypt remote extensions' };
      }

      try {
        const records = await supabaseVault.fetchExtensionSync(session.user.id);
        const remoteExtsByDevice: Array<{ deviceId: string; extensions: ExtensionItem[] }> = [];

        for (const rec of records) {
          if (rec.device_id === deviceId) continue; // Exclude own device
          const decrypted = await decryptData<ExtensionItem[]>(
            { ciphertext: rec.encrypted_payload, iv: rec.payload_iv, version: 1 },
            activeCryptoKey
          );
          remoteExtsByDevice.push({
            deviceId: rec.device_id,
            extensions: decrypted,
          });
        }
        return { success: true, data: remoteExtsByDevice };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
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
// 9. Synchronous Event Registrations (Manifest V3 Top-Level Handlers)
// ============================================================================

// Chrome History Capture
chrome.history.onVisited.addListener(handleHistoryVisited);

// Alarm Tick Handler (Debounce flush + Heartbeat)
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_FLUSH_NAME) {
    if (historyBuffer.length > 0) {
      await flushHistoryBuffer();
    }
  } else if (alarm.name === ALARM_HEARTBEAT_NAME) {
    if (syncMode === 'cloud' && deviceId) {
      try {
        await supabaseVault.updateDeviceHeartbeat(deviceId);
      } catch (e) {
        console.warn('[Imhotep:SW] Heartbeat ping failed:', e);
      }
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
