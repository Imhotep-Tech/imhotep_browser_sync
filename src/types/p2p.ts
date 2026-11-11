/**
 * Imhotep Browser Sync - P2P & WebRTC Type Definitions
 * Ephemeral pairing and direct browser-to-browser DataChannel synchronization
 */

import { EncryptedPayload } from './crypto';

export type P2PConnectionState =
  | 'idle'
  | 'gathering'
  | 'offering'
  | 'answering'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed'
  | 'closed';

export interface PeerDeviceMetadata {
  deviceId: string;
  deviceName: string;
  browserName?: string;
  platform?: string;
  protocolVersion: number;
}

export interface CompactSignalPayload {
  t: 'o' | 'a'; // 'o' = offer, 'a' = answer
  s: string;    // sdp string (compressed or raw)
  c?: Array<{   // ice candidates
    c: string;  // candidate
    m?: string; // sdpMid
    i?: number; // sdpMLineIndex
  }>;
  d: string;    // deviceId
  n?: string;   // deviceName
  ts: number;   // timestamp
  v: number;    // signal protocol version (1)
}

export interface PairingSignalTicket {
  type: 'offer' | 'answer';
  sdp: string;
  candidates: RTCIceCandidateInit[];
  deviceId: string;
  deviceName: string;
  timestamp: number;
  protocolVersion: number;
}

export type P2PMessageType =
  | 'HANDSHAKE_SYN'
  | 'HANDSHAKE_ACK'
  | 'AUTH_CHALLENGE'
  | 'AUTH_VERIFY'
  | 'SYNC_REQ'
  | 'SYNC_BATCH'
  | 'SYNC_ACK'
  | 'HISTORY_SYNC_BATCH'
  | 'EXTENSION_SYNC_BATCH'
  | 'CHUNK_TRANSFER'
  | 'PING'
  | 'PONG';

export interface P2PMessageEnvelope<T = unknown> {
  id: string;
  type: P2PMessageType;
  senderDeviceId: string;
  timestamp: number;
  payload: T;
  isEncrypted: boolean;
}

export interface HistoryItemPayload {
  url: string;
  title?: string;
  lastVisitTime: number;
  visitCount?: number;
  typedCount?: number;
}

export interface ExtensionItemPayload {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  installType?: string;
  description?: string;
  icons?: Array<{ size: number; url: string }>;
  webstoreUrl: string;
}

export interface MicroBatchPayload {
  batchId: string;
  batchIndex: number;
  totalBatches: number;
  dataType: 'history' | 'extensions' | 'tabs' | 'mixed';
  itemsCount: number;
  data: EncryptedPayload | string; // Encrypted for zero-knowledge
  timestamp: number;
}

export interface ChunkTransferPayload {
  transferId: string;
  chunkIndex: number;
  totalChunks: number;
  chunkData: string; // Base64 chunk
}
