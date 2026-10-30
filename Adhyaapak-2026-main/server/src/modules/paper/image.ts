import { AppError } from "../../http/errors";

export type ImageType = "jpeg" | "png";

export interface CleanImage {
  type: ImageType;
  mimeType: "image/jpeg" | "image/png";
  bytes: Buffer;
  width: number;
  height: number;
  /** True when metadata (location, camera, time, thumbnails, text) was removed. */
  stripped: boolean;
}

export const MIN_SIDE = 200;
export const MAX_SIDE = 12000;

const invalid = (message: string) => new AppError("validation_error", message);
const BAD_FILE = "That does not look like a valid JPEG or PNG photo. Take the photo again, or choose a different file.";

/**
 * Checks that the bytes really are a well-formed JPEG or PNG (the file name and the browser's claimed
 * type are not trusted) and returns a copy with privacy-sensitive metadata removed. Phone photos carry
 * GPS position, device and time; none of it is needed to read a worksheet. Pixels are never re-encoded,
 * so handwriting is not degraded. The camera's rotation flag is kept so the photo displays upright.
 */
export function validateAndCleanImage(input: Buffer): CleanImage {
  if (input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) return cleanJpeg(input);
  if (input.length >= 8 && input.subarray(0, 8).equals(PNG_SIGNATURE)) return cleanPng(input);
  throw invalid("Only JPEG and PNG photos are supported. (iPhone HEIC photos: choose “Most Compatible” in camera settings, or share as JPEG.)");
}

function checkSize(width: number, height: number) {
  if (width < MIN_SIDE || height < MIN_SIDE) throw invalid("That photo is too small to read. Take it again closer, or at a higher quality.");
  if (width > MAX_SIDE || height > MAX_SIDE) throw invalid("That photo is extremely large. Take it again at a lower quality.");
}

// ---------------------------------------------------------------- JPEG

const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function cleanJpeg(buf: Buffer): CleanImage {
  const kept: Buffer[] = [Buffer.from([0xff, 0xd8])];
  let pos = 2;
  let orientation = 1;
  let width = 0;
  let height = 0;
  let removedAny = false;
  let sawScan = false;

  while (pos < buf.length) {
    if (buf[pos] !== 0xff) throw invalid(BAD_FILE);
    // Fill bytes (extra 0xFF) are allowed before a marker.
    while (buf[pos] === 0xff && pos < buf.length) pos++;
    const marker = buf[pos++];
    if (marker === undefined) throw invalid(BAD_FILE);
    if (marker === 0xd9) break; // EOI before any scan: no picture data
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue; // markers with no length
    if (pos + 2 > buf.length) throw invalid(BAD_FILE);
    const length = buf.readUInt16BE(pos);
    if (length < 2 || pos + length > buf.length) throw invalid(BAD_FILE);
    const segment = buf.subarray(pos - 2, pos + length); // marker bytes included
    const payload = buf.subarray(pos + 2, pos + length);

    if (marker === 0xe1) {
      orientation = Math.max(orientation === 1 ? readExifOrientation(payload) : orientation, 1);
      removedAny = true;
    } else if ((marker >= 0xe2 && marker <= 0xef) || marker === 0xfe) {
      removedAny = true; // other application data, comments
    } else {
      if (SOF_MARKERS.has(marker)) {
        if (payload.length < 5) throw invalid(BAD_FILE);
        height = payload.readUInt16BE(1);
        width = payload.readUInt16BE(3);
      }
      kept.push(Buffer.from(segment));
    }
    pos += length;

    if (marker === 0xda) {
      // Start of scan: the rest is compressed picture data up to the end of the file.
      sawScan = true;
      const rest = buf.subarray(pos);
      // Keep up to the last end-of-image marker; anything appended after it (embedded previews, hidden data) is dropped.
      const eoi = rest.lastIndexOf(Buffer.from([0xff, 0xd9]));
      if (eoi === -1) throw invalid("That photo looks cut off or damaged. Take it again, or choose a different file.");
      if (eoi + 2 < rest.length) removedAny = true;
      kept.push(Buffer.from(rest.subarray(0, eoi + 2)));
      break;
    }
  }

  if (!sawScan || width === 0 || height === 0) throw invalid(BAD_FILE);
  checkSize(width, height);

  // Re-insert a minimal EXIF block holding only the rotation, right after the start-of-image marker.
  if (orientation > 1) kept.splice(1, 0, minimalOrientationExif(orientation));
  return { type: "jpeg", mimeType: "image/jpeg", bytes: Buffer.concat(kept), width, height, stripped: removedAny };
}

/** Reads the Orientation tag (1–8) from an EXIF APP1 payload; 1 when absent or malformed. */
export function readExifOrientation(payload: Buffer): number {
  try {
    if (payload.length < 14 || payload.toString("latin1", 0, 6) !== "Exif\0\0") return 1;
    const tiff = payload.subarray(6);
    const little = tiff.toString("latin1", 0, 2) === "II";
    if (!little && tiff.toString("latin1", 0, 2) !== "MM") return 1;
    const u16 = (o: number) => (little ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
    const u32 = (o: number) => (little ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
    if (u16(2) !== 0x002a) return 1;
    const ifd = u32(4);
    const count = u16(ifd);
    for (let i = 0; i < Math.min(count, 64); i++) {
      const entry = ifd + 2 + i * 12;
      if (u16(entry) === 0x0112 && u16(entry + 2) === 3) {
        const v = u16(entry + 8);
        return v >= 1 && v <= 8 ? v : 1;
      }
    }
  } catch {
    // Truncated EXIF: treat as upright.
  }
  return 1;
}

function minimalOrientationExif(orientation: number): Buffer {
  const b = Buffer.alloc(36);
  b.writeUInt16BE(0xffe1, 0);
  b.writeUInt16BE(34, 2); // length: itself (2) + 32 bytes of data
  b.write("Exif\0\0", 4, "latin1");
  b.write("MM", 10, "latin1");
  b.writeUInt16BE(0x002a, 12);
  b.writeUInt32BE(8, 14); // first IFD directly after the header
  b.writeUInt16BE(1, 18); // one entry
  b.writeUInt16BE(0x0112, 20);
  b.writeUInt16BE(3, 22); // type SHORT
  b.writeUInt32BE(1, 24); // count
  b.writeUInt16BE(orientation, 28);
  return b;
}

// ---------------------------------------------------------------- PNG

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Chunks needed to draw the picture correctly. Everything else (text, time, EXIF, profiles) is dropped. */
const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "sBIT", "bKGD", "pHYs"]);

function cleanPng(buf: Buffer): CleanImage {
  const kept: Buffer[] = [PNG_SIGNATURE];
  let pos = 8;
  let width = 0;
  let height = 0;
  let sawData = false;
  let sawEnd = false;
  let removedAny = false;

  while (pos + 12 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    const end = pos + 12 + length;
    if (end > buf.length) throw invalid("That photo looks cut off or damaged. Take it again, or choose a different file.");
    if (pos === 8 && type !== "IHDR") throw invalid(BAD_FILE);
    if (type === "IHDR") {
      if (length !== 13) throw invalid(BAD_FILE);
      width = buf.readUInt32BE(pos + 8);
      height = buf.readUInt32BE(pos + 12);
    }
    if (type === "IDAT") sawData = true;
    if (PNG_KEEP.has(type)) kept.push(Buffer.from(buf.subarray(pos, end)));
    else removedAny = true;
    pos = end;
    if (type === "IEND") {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd || !sawData || !width || !height) throw invalid(BAD_FILE);
  if (pos < buf.length) removedAny = true; // anything appended after the end of the image is dropped
  checkSize(width, height);
  return { type: "png", mimeType: "image/png", bytes: Buffer.concat(kept), width, height, stripped: removedAny };
}
