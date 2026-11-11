/**
 * Imhotep Browser Sync - QR Code Pairing & Signaling Compression Engine
 *
 * Encodes WebRTC SDP offer/answer/ICE candidate tickets into ultra-compact payloads
 * suitable for standard QR codes and rapid camera scanning between desktop and mobile.
 */

import QRCode from 'qrcode';
import { CompactSignalPayload, PairingSignalTicket } from '../types/p2p';
import { uint8ArrayToBase64, base64ToUint8Array } from '../crypto/e2ee';

export interface QRCodeOptions {
  width?: number;
  margin?: number;
  darkColor?: string;
  lightColor?: string;
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
}

/**
 * Compresses a pairing signal ticket (SDP offer/answer and ICE candidates) using
 * native Deflate compression and Base64URL encoding to minimize QR matrix density.
 */
export async function compressSignalTicket(ticket: PairingSignalTicket): Promise<string> {
  const compact: CompactSignalPayload = {
    t: ticket.type === 'offer' ? 'o' : 'a',
    s: ticket.sdp,
    c: ticket.candidates
      ?.filter((cand) => Boolean(cand && cand.candidate))
      .map((cand) => ({
        c: cand.candidate || '',
        m: cand.sdpMid || undefined,
        i: cand.sdpMLineIndex ?? undefined,
      })),
    d: ticket.deviceId,
    n: ticket.deviceName,
    ts: ticket.timestamp,
    v: ticket.protocolVersion,
  };

  const json = JSON.stringify(compact);
  const encoder = new TextEncoder();
  const uncompressedBytes = encoder.encode(json);

  try {
    // Native browser CompressionStream
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    writer.write(uncompressedBytes);
    writer.close();

    const response = new Response(cs.readable);
    const compressedBuffer = await response.arrayBuffer();
    return 'IMH1:' + uint8ArrayToBase64(new Uint8Array(compressedBuffer));
  } catch {
    // Fallback if CompressionStream unavailable
    return 'IMH0:' + uint8ArrayToBase64(uncompressedBytes);
  }
}

/**
 * Decompresses a raw or compressed QR pairing payload back into a structured PairingSignalTicket.
 */
export async function decompressSignalTicket(payloadString: string): Promise<PairingSignalTicket> {
  const cleanPayload = payloadString.trim();

  // Handle plain JSON string
  if (cleanPayload.startsWith('{')) {
    const raw = JSON.parse(cleanPayload);
    return normalizeSignalTicket(raw);
  }

  let isDeflated = true;
  let base64Data = cleanPayload;

  if (cleanPayload.startsWith('IMH1:')) {
    isDeflated = true;
    base64Data = cleanPayload.substring(5);
  } else if (cleanPayload.startsWith('IMH0:')) {
    isDeflated = false;
    base64Data = cleanPayload.substring(5);
  }

  const bytes = base64ToUint8Array(base64Data);

  let jsonStr: string;
  if (isDeflated) {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(bytes as unknown as BufferSource);
    writer.close();

    const response = new Response(ds.readable);
    jsonStr = await response.text();
  } else {
    jsonStr = new TextDecoder().decode(bytes);
  }

  const compact: CompactSignalPayload = JSON.parse(jsonStr);
  return {
    type: compact.t === 'o' ? 'offer' : 'answer',
    sdp: compact.s,
    candidates: (compact.c || []).map((cand) => ({
      candidate: cand.c,
      sdpMid: cand.m,
      sdpMLineIndex: cand.i,
    })),
    deviceId: compact.d,
    deviceName: compact.n || 'Remote Browser',
    timestamp: compact.ts,
    protocolVersion: compact.v || 1,
  };
}

/**
 * Normalizes loose JSON payload into standard PairingSignalTicket
 */
function normalizeSignalTicket(raw: any): PairingSignalTicket {
  return {
    type: raw.type || (raw.t === 'o' ? 'offer' : 'answer'),
    sdp: raw.sdp || raw.s || '',
    candidates: raw.candidates || (raw.c ? raw.c.map((c: any) => ({ candidate: c.c, sdpMid: c.m, sdpMLineIndex: c.i })) : []),
    deviceId: raw.deviceId || raw.d || 'unknown-device',
    deviceName: raw.deviceName || raw.n || 'Remote Browser',
    timestamp: raw.timestamp || raw.ts || Date.now(),
    protocolVersion: raw.protocolVersion || raw.v || 1,
  };
}

/**
 * Generates an SVG string representation of the pairing QR code.
 */
export async function generatePairingQRCodeSVG(
  ticketOrPayload: PairingSignalTicket | string,
  options: QRCodeOptions = {}
): Promise<string> {
  const content =
    typeof ticketOrPayload === 'string'
      ? ticketOrPayload
      : await compressSignalTicket(ticketOrPayload);

  return QRCode.toString(content, {
    type: 'svg',
    width: options.width || 280,
    margin: options.margin ?? 2,
    color: {
      dark: options.darkColor || '#0F172A', // Obsidian
      light: options.lightColor || '#FFFFFF',
    },
    errorCorrectionLevel: options.errorCorrectionLevel || 'M',
  });
}

/**
 * Generates a Data URL (base64 PNG) of the QR code for instant `img.src` rendering.
 */
export async function generatePairingQRCodeDataURL(
  ticketOrPayload: PairingSignalTicket | string,
  options: QRCodeOptions = {}
): Promise<string> {
  const content =
    typeof ticketOrPayload === 'string'
      ? ticketOrPayload
      : await compressSignalTicket(ticketOrPayload);

  return QRCode.toDataURL(content, {
    width: options.width || 280,
    margin: options.margin ?? 2,
    color: {
      dark: options.darkColor || '#0F172A',
      light: options.lightColor || '#FFFFFF',
    },
    errorCorrectionLevel: options.errorCorrectionLevel || 'M',
  });
}

/**
 * Renders the pairing QR code directly onto an existing HTMLCanvasElement.
 */
export async function renderPairingQRCodeToCanvas(
  canvas: HTMLCanvasElement,
  ticketOrPayload: PairingSignalTicket | string,
  options: QRCodeOptions = {}
): Promise<void> {
  const content =
    typeof ticketOrPayload === 'string'
      ? ticketOrPayload
      : await compressSignalTicket(ticketOrPayload);

  await QRCode.toCanvas(canvas, content, {
    width: options.width || 280,
    margin: options.margin ?? 2,
    color: {
      dark: options.darkColor || '#0F172A',
      light: options.lightColor || '#FFFFFF',
    },
    errorCorrectionLevel: options.errorCorrectionLevel || 'M',
  });
}

/**
 * Scans for a QR code from a video feed, image, or canvas using the native browser
 * BarcodeDetector API (supported in Chromium/Chrome and Android Kiwi/Lemur).
 */
export async function scanQRCodeFromSource(
  source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap | ImageData
): Promise<string | null> {
  const globalAny = window as any;

  if (typeof globalAny.BarcodeDetector !== 'undefined') {
    try {
      const barcodeDetector = new globalAny.BarcodeDetector({ formats: ['qr_code'] });
      const barcodes = await barcodeDetector.detect(source);
      if (barcodes && barcodes.length > 0) {
        return barcodes[0].rawValue;
      }
    } catch (err) {
      console.warn('BarcodeDetector error:', err);
    }
  }

  return null;
}
