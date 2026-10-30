import { deflateSync } from "node:zlib";

/** Small structurally valid JPEG/PNG files for tests (the pixels are not meant to be looked at). */

const u16 = (n: number) => Buffer.from([(n >> 8) & 0xff, n & 0xff]);
const segment = (marker: number, payload: Buffer) => Buffer.concat([Buffer.from([0xff, marker]), u16(payload.length + 2), payload]);

export function exifWithOrientation(orientation: number, extra = ""): Buffer {
  // Big-endian TIFF with two entries: Orientation, and a fake "make" text we expect to be removed.
  const text = Buffer.from(extra || "SECRET-CAMERA-MAKE\0", "latin1");
  const tiff = Buffer.concat([
    Buffer.from("MM\0*", "latin1"), Buffer.from([0, 0, 0, 8]),
    u16(1), u16(0x0112), u16(3), Buffer.from([0, 0, 0, 1]), u16(orientation), u16(0),
    Buffer.from([0, 0, 0, 0]),
    text,
  ]);
  return segment(0xe1, Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]));
}

export function makeJpeg(opts: { width?: number; height?: number; orientation?: number; gpsText?: string; trailing?: Buffer; truncate?: boolean } = {}): Buffer {
  const { width = 400, height = 300 } = opts;
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  parts.push(segment(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")));
  if (opts.orientation) parts.push(exifWithOrientation(opts.orientation, opts.gpsText));
  parts.push(segment(0xfe, Buffer.from("a comment with a name: Riya", "latin1")));
  parts.push(segment(0xc0, Buffer.concat([Buffer.from([8]), u16(height), u16(width), Buffer.from([1, 1, 0x11, 0])])));
  parts.push(segment(0xda, Buffer.from([1, 1, 0, 0, 63, 0])));
  parts.push(Buffer.from([0x12, 0x34, 0x56, 0x78]));
  if (!opts.truncate) parts.push(Buffer.from([0xff, 0xd9]));
  if (opts.trailing) parts.push(opts.trailing);
  return Buffer.concat(parts);
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Buffer) => {
  let c = 0xffffffff;
  for (const byte of b) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

export function makePng(opts: { width?: number; height?: number; textChunk?: string } = {}): Buffer {
  const { width = 300, height = 300 } = opts;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width, 0xff)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr)];
  if (opts.textChunk) parts.push(chunk("tEXt", Buffer.from(`Comment\0${opts.textChunk}`, "latin1")));
  parts.push(chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}
