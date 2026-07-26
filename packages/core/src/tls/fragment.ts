import type { FragmentSettings } from '../types.js';

export const TLS_HEADER_SIZE = 5;
const CONTENT_TYPE_HANDSHAKE = 0x16;
const HANDSHAKE_TYPE_CLIENT_HELLO = 0x01;

/**
 * True when `data` starts with a TLS handshake record carrying a ClientHello —
 * i.e. the packet that contains the SNI a DPI box is looking for.
 *
 * v2 fragmented whatever the first client packet happened to be. Checking first
 * means non-TLS tunnels (SSH over CONNECT, plain sockets) pass through intact.
 */
export function isClientHello(data: Buffer): boolean {
  return (
    data.length > TLS_HEADER_SIZE &&
    data[0] === CONTENT_TYPE_HANDSHAKE &&
    data[TLS_HEADER_SIZE] === HANDSHAKE_TYPE_CLIENT_HELLO
  );
}

/**
 * Split a ClientHello so no single piece contains a complete SNI.
 *
 * Two strategies:
 * - **TCP split** (`tlsRecords: false`) — one TLS record, chopped across
 *   several `write()` calls. Beats boxes that inspect single segments.
 * - **Record split** (`tlsRecords: true`) — the handshake payload is re-framed
 *   into several individually valid TLS records. Beats boxes that reassemble
 *   the TCP stream but inspect record-by-record. Legal per RFC 8446 §5.1: a
 *   handshake message may span multiple records.
 *
 * Returns `[data]` unchanged when fragmentation is off or the payload is not a
 * ClientHello.
 */
export function fragmentClientHello(data: Buffer, settings: FragmentSettings): Buffer[] {
  if (!settings.enabled || settings.size < 1 || !isClientHello(data)) {
    return [data];
  }
  return settings.tlsRecords
    ? splitIntoRecords(data, settings.size)
    : splitBytes(data, settings.size);
}

/** Chop a buffer into `size`-byte pieces. */
export function splitBytes(data: Buffer, size: number): Buffer[] {
  const pieces: Buffer[] = [];
  for (let offset = 0; offset < data.length; offset += size) {
    pieces.push(data.subarray(offset, offset + size));
  }
  return pieces;
}

/**
 * Re-frame one TLS record's payload into N records of at most `size` bytes,
 * reusing the original content type and legacy version.
 *
 * Anything after the first record (a coalesced second record, which does
 * happen) is forwarded untouched as a final piece — v2 silently corrupted it by
 * treating the whole buffer as one record's payload.
 */
function splitIntoRecords(data: Buffer, size: number): Buffer[] {
  const contentType = data[0];
  const versionMajor = data[1];
  const versionMinor = data[2];
  if (contentType === undefined || versionMajor === undefined || versionMinor === undefined) {
    return [data];
  }

  const declaredLength = data.readUInt16BE(3);
  const payloadEnd = Math.min(TLS_HEADER_SIZE + declaredLength, data.length);
  const payload = data.subarray(TLS_HEADER_SIZE, payloadEnd);

  const records: Buffer[] = [];
  for (let offset = 0; offset < payload.length; offset += size) {
    const slice = payload.subarray(offset, offset + size);
    const record = Buffer.allocUnsafe(TLS_HEADER_SIZE + slice.length);
    record[0] = contentType;
    record[1] = versionMajor;
    record[2] = versionMinor;
    record.writeUInt16BE(slice.length, 3);
    slice.copy(record, TLS_HEADER_SIZE);
    records.push(record);
  }

  const trailing = data.subarray(payloadEnd);
  if (trailing.length > 0) {
    records.push(trailing);
  }

  return records.length > 0 ? records : [data];
}
