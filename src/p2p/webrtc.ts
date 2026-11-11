/**
 * Imhotep Browser Sync - WebRTC P2P Sync Engine
 *
 * Establishes direct, ephemeral, zero-knowledge browser-to-browser DataChannels
 * using public STUN servers for NAT traversal.
 *
 * Micro-batch exchange protocol:
 * 1. Handshake SYN -> ACK (Exchange device IDs and capabilities)
 * 2. Auth Challenge -> Verify (Prove possession of shared mnemonic/key)
 * 3. Micro-batch history & extension sync (Encrypted client-side with AES-256-GCM)
 * 4. Chunked transfer handling for payloads > 16KB to prevent RTCDataChannel buffer overflow
 */

import {
  P2PConnectionState,
  PairingSignalTicket,
  PeerDeviceMetadata,
  P2PMessageEnvelope,
  HistoryItemPayload,
  ExtensionItemPayload,
  MicroBatchPayload,
  ChunkTransferPayload,
} from '../types/p2p';
import { EncryptedPayload } from '../types/crypto';
import { encryptData, decryptData, computeSHA256 } from '../crypto/e2ee';

export const DEFAULT_STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

/** Safe maximum chunk byte size over RTCDataChannel */
const MAX_CHUNK_SIZE = 16 * 1024; // 16 KB

export interface P2PClientOptions {
  deviceId: string;
  deviceName: string;
  encryptionKey?: CryptoKey;
  authSecret?: string; // Mnemonic or master password for mutual handshake verification
  iceServers?: RTCIceServer[];
  onStateChange?: (state: P2PConnectionState) => void;
  onPeerConnected?: (peer: PeerDeviceMetadata) => void;
  onPeerDisconnected?: () => void;
  onHistoryBatchReceived?: (items: HistoryItemPayload[], metadata: MicroBatchPayload) => void;
  onExtensionBatchReceived?: (items: ExtensionItemPayload[], metadata: MicroBatchPayload) => void;
  onError?: (error: Error) => void;
}

export class WebRTCP2PClient {
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private state: P2PConnectionState = 'idle';

  private localCandidates: RTCIceCandidateInit[] = [];
  private remotePeer: PeerDeviceMetadata | null = null;
  private chunkBuffers = new Map<string, { total: number; chunks: string[] }>();
  private pendingAuthChallenge: string | null = null;

  private options: P2PClientOptions;

  constructor(options: P2PClientOptions) {
    this.options = {
      iceServers: DEFAULT_STUN_SERVERS,
      ...options,
    };
  }

  public getState(): P2PConnectionState {
    return this.state;
  }

  public isConnected(): boolean {
    return this.dataChannel !== null && this.dataChannel.readyState === 'open';
  }

  public getRemotePeer(): PeerDeviceMetadata | null {
    return this.remotePeer;
  }

  public setEncryptionKey(key: CryptoKey): void {
    this.options.encryptionKey = key;
  }

  public setAuthSecret(secret: string): void {
    this.options.authSecret = secret;
  }

  private setState(newState: P2PConnectionState): void {
    this.state = newState;
    if (this.options.onStateChange) {
      this.options.onStateChange(newState);
    }
  }

  /**
   * Initializes a new RTCPeerConnection with STUN servers
   */
  private createPeerConnection(): RTCPeerConnection {
    if (this.pc) {
      this.close();
    }

    this.localCandidates = [];
    const pc = new RTCPeerConnection({
      iceServers: this.options.iceServers || DEFAULT_STUN_SERVERS,
      iceCandidatePoolSize: 2,
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.localCandidates.push(event.candidate.toJSON());
      }
    };

    pc.oniceconnectionstatechange = () => {
      switch (pc.iceConnectionState) {
        case 'checking':
          this.setState('connecting');
          break;
        case 'connected':
        case 'completed':
          this.setState('connected');
          break;
        case 'disconnected':
          this.setState('disconnected');
          if (this.options.onPeerDisconnected) {
            this.options.onPeerDisconnected();
          }
          break;
        case 'failed':
          this.setState('failed');
          this.handleError(new Error('WebRTC ICE connection failed'));
          break;
        case 'closed':
          this.setState('closed');
          break;
      }
    };

    pc.ondatachannel = (event) => {
      this.setupDataChannel(event.channel);
    };

    this.pc = pc;
    return pc;
  }

  /**
   * Configures event listeners for the WebRTC DataChannel
   */
  private setupDataChannel(channel: RTCDataChannel): void {
    this.dataChannel = channel;
    channel.binaryType = 'arraybuffer';

    channel.onopen = async () => {
      this.setState('connected');
      // Send initial handshake
      await this.sendEnvelope('HANDSHAKE_SYN', {
        deviceId: this.options.deviceId,
        deviceName: this.options.deviceName,
        protocolVersion: 1,
      });
    };

    channel.onclose = () => {
      this.setState('disconnected');
      if (this.options.onPeerDisconnected) {
        this.options.onPeerDisconnected();
      }
    };

    channel.onerror = (ev: any) => {
      // Ignore normal disconnect / tear-down events when closing
      if (
        this.state === 'closed' ||
        this.state === 'disconnected' ||
        channel.readyState === 'closing' ||
        channel.readyState === 'closed'
      ) {
        return;
      }
      const errorMsg = ev?.error?.message || 'DataChannel notice';
      console.warn('[WebRTC:DataChannel] Notice:', errorMsg);
    };

    channel.onmessage = async (event) => {
      try {
        await this.handleIncomingMessage(event.data);
      } catch (err) {
        this.handleError(err instanceof Error ? err : new Error(String(err)));
      }
    };
  }

  /**
   * Helper that waits until ICE gathering completes or times out after 2500ms
   */
  private async waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 2500): Promise<void> {
    if (pc.iceGatheringState === 'complete') {
      return;
    }

    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        resolve();
      }, timeoutMs);

      const checkState = () => {
        if (pc.iceGatheringState === 'complete') {
          clearTimeout(timer);
          pc.removeEventListener('icegatheringstatechange', checkState);
          resolve();
        }
      };

      pc.addEventListener('icegatheringstatechange', checkState);
    });
  }

  /**
   * Creates an SDP Offer and bundles all gathered ICE candidates into a PairingSignalTicket.
   * This ticket can be converted into a QR code or shared code.
   */
  public async createOffer(): Promise<PairingSignalTicket> {
    this.setState('offering');
    const pc = this.createPeerConnection();

    // Create outbound DataChannel
    const channel = pc.createDataChannel('imhotep-sync', { ordered: true });
    this.setupDataChannel(channel);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // Wait for ICE gathering to include all candidate routes
    await this.waitForIceGathering(pc);

    return {
      type: 'offer',
      sdp: pc.localDescription?.sdp || offer.sdp || '',
      candidates: [...this.localCandidates],
      deviceId: this.options.deviceId,
      deviceName: this.options.deviceName,
      timestamp: Date.now(),
      protocolVersion: 1,
    };
  }

  /**
   * Accepts an SDP Offer ticket, sets remote description, adds candidates,
   * creates an SDP Answer, and returns an Answer PairingSignalTicket.
   */
  public async acceptOfferAndCreateAnswer(offerTicket: PairingSignalTicket): Promise<PairingSignalTicket> {
    if (offerTicket.type !== 'offer') {
      throw new Error(`Expected signal ticket of type 'offer', got '${offerTicket.type}'`);
    }

    this.setState('answering');
    const pc = this.createPeerConnection();

    await pc.setRemoteDescription(new RTCSessionDescription({
      type: 'offer',
      sdp: offerTicket.sdp,
    }));

    // Add candidates from the offer
    if (offerTicket.candidates && offerTicket.candidates.length > 0) {
      for (const cand of offerTicket.candidates) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (e) {
          console.warn('Could not add ICE candidate:', e);
        }
      }
    }

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    await this.waitForIceGathering(pc);

    return {
      type: 'answer',
      sdp: pc.localDescription?.sdp || answer.sdp || '',
      candidates: [...this.localCandidates],
      deviceId: this.options.deviceId,
      deviceName: this.options.deviceName,
      timestamp: Date.now(),
      protocolVersion: 1,
    };
  }

  /**
   * Accepts an SDP Answer ticket to complete the pairing handshake.
   */
  public async acceptAnswer(answerTicket: PairingSignalTicket): Promise<void> {
    if (!this.pc) {
      throw new Error('Peer connection not initialized');
    }
    if (answerTicket.type !== 'answer') {
      throw new Error(`Expected signal ticket of type 'answer', got '${answerTicket.type}'`);
    }

    await this.pc.setRemoteDescription(new RTCSessionDescription({
      type: 'answer',
      sdp: answerTicket.sdp,
    }));

    if (answerTicket.candidates && answerTicket.candidates.length > 0) {
      for (const cand of answerTicket.candidates) {
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (e) {
          console.warn('Could not add ICE candidate:', e);
        }
      }
    }
  }

  /**
   * Encapsulates data into a message envelope and transmits over DataChannel,
   * chunking if larger than MAX_CHUNK_SIZE.
   */
  private async sendEnvelope<T>(
    type: P2PMessageEnvelope['type'],
    payload: T,
    encrypt = false
  ): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      console.warn(
        `[WebRTC] DataChannel not open (readyState: ${this.dataChannel?.readyState || 'none'}). Envelope '${type}' skipped.`
      );
      return;
    }

    let payloadToSend: any = payload;
    let isEncrypted = false;

    if (encrypt) {
      if (!this.options.encryptionKey) {
        throw new Error('Encryption key required for encrypted transmission');
      }
      payloadToSend = await encryptData(payload as any, this.options.encryptionKey);
      isEncrypted = true;
    }

    const envelope: P2PMessageEnvelope = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      type,
      senderDeviceId: this.options.deviceId,
      timestamp: Date.now(),
      payload: payloadToSend,
      isEncrypted,
    };

    const serialized = JSON.stringify(envelope);

    if (serialized.length <= MAX_CHUNK_SIZE) {
      this.dataChannel.send(serialized);
    } else {
      // Chunking protocol
      const transferId = `transfer_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const totalChunks = Math.ceil(serialized.length / MAX_CHUNK_SIZE);

      for (let i = 0; i < totalChunks; i++) {
        const slice = serialized.substring(i * MAX_CHUNK_SIZE, (i + 1) * MAX_CHUNK_SIZE);
        const chunkEnvelope: P2PMessageEnvelope<ChunkTransferPayload> = {
          id: `${transferId}_${i}`,
          type: 'CHUNK_TRANSFER',
          senderDeviceId: this.options.deviceId,
          timestamp: Date.now(),
          payload: {
            transferId,
            chunkIndex: i,
            totalChunks,
            chunkData: slice,
          },
          isEncrypted: false,
        };
        this.dataChannel.send(JSON.stringify(chunkEnvelope));
      }
    }
  }

  /**
   * Dispatches incoming RTCDataChannel messages
   */
  private async handleIncomingMessage(rawData: string | ArrayBuffer): Promise<void> {
    const rawString = typeof rawData === 'string' ? rawData : new TextDecoder().decode(rawData);
    const parsed = JSON.parse(rawString) as P2PMessageEnvelope;

    // Handle reassembly if chunked
    if (parsed.type === 'CHUNK_TRANSFER') {
      const chunkPayload = parsed.payload as ChunkTransferPayload;
      let buffer = this.chunkBuffers.get(chunkPayload.transferId);
      if (!buffer) {
        buffer = { total: chunkPayload.totalChunks, chunks: [] };
        this.chunkBuffers.set(chunkPayload.transferId, buffer);
      }

      buffer.chunks[chunkPayload.chunkIndex] = chunkPayload.chunkData;

      // Check if all chunks received
      if (buffer.chunks.filter(Boolean).length === buffer.total) {
        const reassembled = buffer.chunks.join('');
        this.chunkBuffers.delete(chunkPayload.transferId);
        await this.handleIncomingMessage(reassembled);
      }
      return;
    }

    let payload = parsed.payload;
    if (parsed.isEncrypted && this.options.encryptionKey) {
      payload = await decryptData(payload as EncryptedPayload, this.options.encryptionKey);
    }

    switch (parsed.type) {
      case 'HANDSHAKE_SYN': {
        const peer = payload as PeerDeviceMetadata;
        this.remotePeer = peer;

        // Respond with ACK
        await this.sendEnvelope('HANDSHAKE_ACK', {
          deviceId: this.options.deviceId,
          deviceName: this.options.deviceName,
          protocolVersion: 1,
        });

        // Trigger mutual auth challenge if secret available
        if (this.options.authSecret) {
          const challenge = Math.random().toString(36).substring(2) + Date.now().toString(36);
          this.pendingAuthChallenge = challenge;
          await this.sendEnvelope('AUTH_CHALLENGE', { challenge });
        } else if (this.options.onPeerConnected) {
          this.options.onPeerConnected(peer);
        }
        break;
      }

      case 'HANDSHAKE_ACK': {
        const peer = payload as PeerDeviceMetadata;
        this.remotePeer = peer;

        if (this.options.authSecret) {
          const challenge = Math.random().toString(36).substring(2) + Date.now().toString(36);
          this.pendingAuthChallenge = challenge;
          await this.sendEnvelope('AUTH_CHALLENGE', { challenge });
        } else if (this.options.onPeerConnected) {
          this.options.onPeerConnected(peer);
        }
        break;
      }

      case 'AUTH_CHALLENGE': {
        const { challenge } = payload as { challenge: string };
        if (this.options.authSecret) {
          // Compute proof: SHA-256(challenge + authSecret)
          const proof = await computeSHA256(challenge + this.options.authSecret);
          await this.sendEnvelope('AUTH_VERIFY', { challenge, proof });
        }
        break;
      }

      case 'AUTH_VERIFY': {
        const { challenge, proof } = payload as { challenge: string; proof: string };
        if (this.options.authSecret) {
          const expectedProof = await computeSHA256(challenge + this.options.authSecret);
          if (proof === expectedProof) {
            if (this.remotePeer && this.options.onPeerConnected) {
              this.options.onPeerConnected(this.remotePeer);
            }
          } else {
            this.handleError(new Error('P2P mutual authentication failed: shared phrase mismatch'));
            this.close();
          }
        }
        break;
      }

      case 'HISTORY_SYNC_BATCH': {
        const batch = payload as MicroBatchPayload;
        let historyItems: HistoryItemPayload[];
        if (typeof batch.data === 'string' || (batch.data as EncryptedPayload).ciphertext) {
          if (!this.options.encryptionKey) {
            throw new Error('Received encrypted history batch without encryption key');
          }
          historyItems = await decryptData(batch.data, this.options.encryptionKey);
        } else {
          historyItems = batch.data as unknown as HistoryItemPayload[];
        }

        if (this.options.onHistoryBatchReceived) {
          this.options.onHistoryBatchReceived(historyItems, batch);
        }

        await this.sendEnvelope('SYNC_ACK', { batchId: batch.batchId, status: 'ok' });
        break;
      }

      case 'EXTENSION_SYNC_BATCH': {
        const batch = payload as MicroBatchPayload;
        let extensions: ExtensionItemPayload[];
        if (typeof batch.data === 'string' || (batch.data as EncryptedPayload).ciphertext) {
          if (!this.options.encryptionKey) {
            throw new Error('Received encrypted extension batch without encryption key');
          }
          extensions = await decryptData(batch.data, this.options.encryptionKey);
        } else {
          extensions = batch.data as unknown as ExtensionItemPayload[];
        }

        if (this.options.onExtensionBatchReceived) {
          this.options.onExtensionBatchReceived(extensions, batch);
        }

        await this.sendEnvelope('SYNC_ACK', { batchId: batch.batchId, status: 'ok' });
        break;
      }

      case 'PING':
        await this.sendEnvelope('PONG', { ts: Date.now() });
        break;

      default:
        break;
    }
  }

  /**
   * Transmits history items in zero-knowledge micro-batches over the P2P DataChannel.
   */
  public async syncHistoryBatch(items: HistoryItemPayload[], batchSize = 50): Promise<boolean> {
    if (!this.isConnected()) {
      console.warn('[WebRTC] DataChannel not open; cannot send history batch');
      return false;
    }
    if (!items || items.length === 0) return true;

    const totalBatches = Math.ceil(items.length / batchSize);
    for (let b = 0; b < totalBatches; b++) {
      const slice = items.slice(b * batchSize, (b + 1) * batchSize);
      const batchId = `hist_${Date.now()}_${b}`;

      let dataPayload: any = slice;
      if (this.options.encryptionKey) {
        dataPayload = await encryptData(slice, this.options.encryptionKey);
      }

      const microBatch: MicroBatchPayload = {
        batchId,
        batchIndex: b,
        totalBatches,
        dataType: 'history',
        itemsCount: slice.length,
        data: dataPayload,
        timestamp: Date.now(),
      };

      await this.sendEnvelope('HISTORY_SYNC_BATCH', microBatch);
    }
    return true;
  }

  /**
   * Transmits installed extensions list in zero-knowledge format over P2P DataChannel.
   */
  public async syncExtensions(extensions: ExtensionItemPayload[]): Promise<boolean> {
    if (!this.isConnected()) {
      console.warn('[WebRTC] DataChannel not open; cannot send extensions list');
      return false;
    }
    if (!extensions || extensions.length === 0) return true;

    const batchId = `ext_${Date.now()}`;
    let dataPayload: any = extensions;
    if (this.options.encryptionKey) {
      dataPayload = await encryptData(extensions, this.options.encryptionKey);
    }

    const microBatch: MicroBatchPayload = {
      batchId,
      batchIndex: 0,
      totalBatches: 1,
      dataType: 'extensions',
      itemsCount: extensions.length,
      data: dataPayload,
      timestamp: Date.now(),
    };

    await this.sendEnvelope('EXTENSION_SYNC_BATCH', microBatch);
    return true;
  }

  private handleError(error: Error): void {
    if (this.options.onError) {
      this.options.onError(error);
    } else {
      console.warn('[WebRTC] Notice:', error.message || error);
    }
  }

  /**
   * Gracefully tears down DataChannel and RTCPeerConnection
   */
  public close(): void {
    if (this.dataChannel) {
      try {
        this.dataChannel.close();
      } catch {
        // ignore
      }
      this.dataChannel = null;
    }

    if (this.pc) {
      try {
        this.pc.close();
      } catch {
        // ignore
      }
      this.pc = null;
    }

    this.chunkBuffers.clear();
    this.remotePeer = null;
    this.pendingAuthChallenge = null;
    this.setState('closed');
  }
}
