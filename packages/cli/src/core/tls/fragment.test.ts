import { describe, expect, it } from 'vitest';
import { DEFAULT_FRAGMENT } from '../config.js';
import { TLS_HEADER_SIZE, fragmentClientHello, isClientHello, splitBytes } from './fragment.js';

/** Build a minimal but structurally valid TLS handshake record. */
function clientHello(payloadLength: number): Buffer {
  const payload = Buffer.alloc(payloadLength, 0xaa);
  payload[0] = 0x01; // handshake type: client_hello
  const record = Buffer.alloc(TLS_HEADER_SIZE + payloadLength);
  record[0] = 0x16; // content type: handshake
  record[1] = 0x03;
  record[2] = 0x01;
  record.writeUInt16BE(payloadLength, 3);
  payload.copy(record, TLS_HEADER_SIZE);
  return record;
}

const on = { ...DEFAULT_FRAGMENT, enabled: true, size: 40 };

describe('isClientHello', () => {
  it('recognises a handshake record carrying a ClientHello', () => {
    expect(isClientHello(clientHello(300))).toBe(true);
  });

  it('rejects application data and short buffers', () => {
    expect(isClientHello(Buffer.from([0x17, 0x03, 0x03, 0x00, 0x05, 0x01]))).toBe(false);
    expect(isClientHello(Buffer.from('GET / HTTP/1.1'))).toBe(false);
    expect(isClientHello(Buffer.alloc(3))).toBe(false);
  });
});

describe('fragmentClientHello', () => {
  it('passes the buffer through when disabled', () => {
    const hello = clientHello(300);
    expect(fragmentClientHello(hello, { ...on, enabled: false })).toEqual([hello]);
  });

  it('leaves non-TLS payloads untouched', () => {
    const ssh = Buffer.from('SSH-2.0-OpenSSH_9.6\r\n');
    expect(fragmentClientHello(ssh, on)).toEqual([ssh]);
  });

  it('splits into TCP segments that reassemble to the original', () => {
    const hello = clientHello(300);
    const pieces = fragmentClientHello(hello, { ...on, tlsRecords: false });

    expect(pieces.length).toBe(Math.ceil(hello.length / on.size));
    expect(Buffer.concat(pieces)).toEqual(hello);
  });

  it('re-frames into individually valid TLS records', () => {
    const payloadLength = 300;
    const hello = clientHello(payloadLength);
    const records = fragmentClientHello(hello, { ...on, tlsRecords: true });

    expect(records.length).toBe(Math.ceil(payloadLength / on.size));

    for (const record of records) {
      expect(record[0]).toBe(0x16);
      expect(record[1]).toBe(0x03);
      expect(record[2]).toBe(0x01);
      // The declared length must match the bytes actually present.
      expect(record.readUInt16BE(3)).toBe(record.length - TLS_HEADER_SIZE);
    }

    const rejoined = Buffer.concat(records.map((r) => r.subarray(TLS_HEADER_SIZE)));
    expect(rejoined).toEqual(hello.subarray(TLS_HEADER_SIZE));
  });

  it('forwards a coalesced trailing record instead of corrupting it', () => {
    const hello = clientHello(100);
    const trailing = Buffer.from([0x14, 0x03, 0x03, 0x00, 0x01, 0x01]);
    const combined = Buffer.concat([hello, trailing]);

    const records = fragmentClientHello(combined, { ...on, tlsRecords: true, size: 40 });

    expect(records.at(-1)).toEqual(trailing);
  });
});

describe('splitBytes', () => {
  it('produces evenly sized pieces with a short tail', () => {
    expect(splitBytes(Buffer.from('abcdefg'), 3).map((b) => b.toString())).toEqual([
      'abc',
      'def',
      'g',
    ]);
  });
});
