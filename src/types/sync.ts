/**
 * Imhotep Browser Sync - Types & Interfaces
 * Unified type definitions for Cloud Vault (Supabase), MV3 Service Worker,
 * P2P DataChannels, and Zero-Knowledge End-to-End Encryption.
 */

// ============================================================================
// 1. Device & Profile Types
// ============================================================================

export type DeviceType = 'desktop' | 'mobile_android' | 'tablet';

export interface DeviceRecord {
  id: string; // UUID
  user_id: string; // UUID (references auth.users)
  device_name: string;
  device_type: DeviceType;
  last_seen: string; // ISO 8601
  created_at?: string; // ISO 8601
}

export interface UserProfileRecord {
  user_id: string; // UUID
  salt: string; // Base64 or Hex encoded salt for PBKDF2
  device_count: number;
  created_at?: string;
  updated_at?: string;
}

// ============================================================================
// 2. Browser History & Micro-Batching Types
// ============================================================================

export interface HistoryVisitItem {
  id?: string;
  url: string;
  title?: string;
  visitTime: number; // Unix Epoch timestamp in milliseconds
  lastVisitTime?: number;
  visitCount?: number;
  typedCount?: number;
  transition?: string;
  deviceId?: string;
  deviceName?: string;
}

export interface EncryptedPayloadBundle {
  ciphertext: string; // Base64 encoded AES-256-GCM ciphertext
  iv: string; // Base64 encoded 12-byte initialization vector
  version?: number; // Payload format version (default: 1)
}

export interface HistorySyncRecord {
  id?: string; // UUID
  user_id: string; // UUID
  device_id?: string | null;
  encrypted_payload: string; // AES-256-GCM ciphertext (Base64)
  payload_iv: string; // IV (Base64)
  visit_timestamp: string; // ISO 8601 timestamp
  created_at?: string;
}

// ============================================================================
// 3. Extension Inventory & Sync Types
// ============================================================================

export interface ExtensionItem {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  description?: string;
  iconUrl?: string;
  icons?: Array<{ size: number; url: string }>;
  installType?: string; // 'normal', 'development', 'sideload', etc.
  storeUrl: string; // Canonical Web Store link
  webstoreUrl?: string;
}

export interface ExtensionSyncPayload {
  deviceId: string;
  deviceName: string;
  timestamp: number;
  extensions: ExtensionItem[];
}

export interface ExtensionSyncRecord {
  id?: string; // UUID
  user_id: string; // UUID
  device_id: string; // UUID
  encrypted_payload: string; // AES-256-GCM ciphertext (Base64)
  payload_iv: string; // IV (Base64)
  updated_at?: string;
}

// ============================================================================
// 4. State & Configuration Types
// ============================================================================

export type SyncMode = 'p2p' | 'cloud' | 'offline';

export type SyncStatus = 'idle' | 'syncing' | 'connected' | 'error' | 'unpaired';

export interface CloudConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  enabled: boolean;
}

export interface SyncState {
  mode: SyncMode;
  status: SyncStatus;
  deviceId: string;
  deviceName: string;
  deviceType: DeviceType;
  lastSyncTime?: number;
  bufferedCount: number;
  totalSyncedCount: number;
  isCloudAuthenticated: boolean;
  userEmail?: string | null;
  p2pConnectedPeers: number;
  lastError?: string | null;
  hasMasterKey: boolean;
}

export interface FilterRule {
  protocolAllowList: string[]; // ['http:', 'https:']
  excludedPrefixes: string[]; // ['chrome://', 'chrome-extension://', 'edge://', 'brave://', 'about:', 'view-source:']
  excludedHostnames: string[]; // ['localhost', '127.0.0.1', '::1', '0.0.0.0']
  ignoreIncognito: boolean;
}

// ============================================================================
// 5. Message Passing Interface (Popup <-> Service Worker <-> Offscreen)
// ============================================================================

export type BackgroundMessageType =
  | 'PING'
  | 'GET_STATUS'
  | 'SET_SYNC_MODE'
  | 'SET_DEVICE_NAME'
  | 'SET_CLOUD_CONFIG'
  | 'GET_CLOUD_CONFIG'
  | 'AUTH_SIGN_IN'
  | 'AUTH_SIGN_UP'
  | 'AUTH_SIGN_OUT'
  | 'AUTH_GET_SESSION'
  | 'SET_MASTER_KEY'
  | 'CLEAR_MASTER_KEY'
  | 'TRIGGER_FLUSH'
  | 'GET_RECENT_HISTORY'
  | 'GET_INSTALLED_EXTENSIONS'
  | 'GET_REMOTE_EXTENSIONS'
  | 'SYNC_EXTENSIONS_NOW'
  | 'P2P_START_PAIRING'
  | 'P2P_CONNECT_MNEMONIC'
  | 'P2P_DISCONNECT'
  | 'GET_P2P_STATE';

export interface RuntimeMessage<T = any> {
  type: BackgroundMessageType;
  payload?: T;
}

export interface RuntimeResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}
