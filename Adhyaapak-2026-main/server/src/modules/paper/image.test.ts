import { describe, expect, it } from "vitest";
import { makeJpeg, makePng } from "../../test/make-image";
import { readExifOrientation, validateAndCleanImage } from "./image";

describe("validateAndCleanImage: JPEG", () => {
  it("accepts a JPEG, reports its size, and removes the comment", () => {
    const img = validateAndCleanImage(makeJpeg());
    expect(img).toMatchObject({ type: "jpeg", mimeType: "image/jpeg", width: 400, height: 300, stripped: true });
    expect(img.bytes.toString("latin1")).not.toContain("Riya");
  });

  it("removes EXIF (camera, location text) but keeps the rotation so the photo displays upright", () => {
    const original = makeJpeg({ orientation: 6, gpsText: "GPS-51.5N-0.12W-iPhone\0" });
    expect(original.toString("latin1")).toContain("GPS-51.5N");
    const img = validateAndCleanImage(original);
    expect(img.bytes.toString("latin1")).not.toContain("GPS-51.5N");
    expect(img.bytes.toString("latin1")).not.toContain("iPhone");
    // The orientation survives in a minimal EXIF block.
    const app1 = img.bytes.indexOf(Buffer.from([0xff, 0xe1]));
    expect(app1).toBeGreaterThan(0);
    expect(readExifOrientation(img.bytes.subarray(app1 + 4, app1 + 2 + img.bytes.readUInt16BE(app1 + 2)))).toBe(6);
  });

  it("adds no EXIF block when the photo was already upright", () => {
    const img = validateAndCleanImage(makeJpeg({ orientation: 1 }));
    expect(img.bytes.includes(Buffer.from("Exif", "latin1"))).toBe(false);
  });

  it("drops data hidden after the end-of-image marker", () => {
    const img = validateAndCleanImage(makeJpeg({ trailing: Buffer.from("HIDDEN-PAYLOAD") }));
    expect(img.bytes.toString("latin1")).not.toContain("HIDDEN");
    expect(img.bytes.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
  });

  it("does not alter the compressed picture data", () => {
    const img = validateAndCleanImage(makeJpeg());
    expect(img.bytes.includes(Buffer.from([0x12, 0x34, 0x56, 0x78]))).toBe(true);
  });

  it("rejects a cut-off JPEG, and tiny or enormous pictures", () => {
    expect(() => validateAndCleanImage(makeJpeg({ truncate: true }))).toThrow(/cut off|damaged/);
    expect(() => validateAndCleanImage(makeJpeg({ width: 50, height: 50 }))).toThrow(/too small/);
    expect(() => validateAndCleanImage(makeJpeg({ width: 20000, height: 300 }))).toThrow(/extremely large/);
  });
});

describe("validateAndCleanImage: PNG", () => {
  it("accepts a PNG and removes text chunks", () => {
    const original = makePng({ textChunk: "Author=Riya Sharma" });
    expect(original.toString("latin1")).toContain("Riya Sharma");
    const img = validateAndCleanImage(original);
    expect(img).toMatchObject({ type: "png", mimeType: "image/png", width: 300, height: 300, stripped: true });
    expect(img.bytes.toString("latin1")).not.toContain("Riya");
  });

  it("leaves a clean PNG byte-for-byte unchanged", () => {
    const original = makePng();
    const img = validateAndCleanImage(original);
    expect(img.stripped).toBe(false);
    expect(img.bytes.equals(original)).toBe(true);
  });

  it("rejects a PNG that is cut off or missing its data", () => {
    const png = makePng();
    expect(() => validateAndCleanImage(png.subarray(0, png.length - 20))).toThrow();
    expect(() => validateAndCleanImage(png.subarray(0, 33))).toThrow();
  });
});

describe("validateAndCleanImage: other files", () => {
  it("never trusts the file name: a script, text or PDF is refused", () => {
    for (const bytes of [Buffer.from("<script>alert(1)</script>"), Buffer.from("%PDF-1.4 ..."), Buffer.from("GIF89a....."), Buffer.alloc(0), Buffer.from([0xff, 0xd8])]) {
      expect(() => validateAndCleanImage(bytes)).toThrow();
    }
  });
  it("explains HEIC", () => {
    const heic = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypheic"), Buffer.alloc(20)]);
    expect(() => validateAndCleanImage(heic)).toThrow(/JPEG and PNG/);
  });
});
