import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalStorage } from "../files/storage";
import { makePdf } from "../../test/make-pdf";
import { LIMITS, cleanText, extractDocumentText, extractPastedText } from "./extract-text";

const SAMPLE = "Class 6 Mathematics. Fractions. Students learn to name fractions, find equivalent fractions, and add and subtract fractions with unlike denominators.";
const buf = (s: string) => Buffer.from(s, "utf8");
const refusal = (p: Promise<unknown>) => p.then(() => undefined, (e: { code: string; message: string }) => e);

describe("cleanText", () => {
  it("unifies line endings, collapses spacing and trims", () => {
    expect(cleanText("  a \r\n\r\n\r\n\r\nb\t\tc   d ")).toBe("a\n\nb c d");
  });
});

describe("text files", () => {
  it("reads a .txt or .md file", async () => {
    const r = await extractDocumentText("syllabus.txt", buf(SAMPLE));
    expect(r).toEqual({ fileType: "text", text: SAMPLE, pageCount: null });
    expect((await extractDocumentText("notes.MD", buf(SAMPLE))).fileType).toBe("text");
  });

  it("refuses wrong file types, NUL bytes, invalid UTF-8, too little and too much text", async () => {
    expect((await refusal(extractDocumentText("tool.exe", buf(SAMPLE))))?.message).toMatch(/Only PDF, .txt and .md/);
    expect((await refusal(extractDocumentText("a.txt", Buffer.concat([buf(SAMPLE), Buffer.from([0])]))))?.message).toMatch(/does not look like a text file/);
    expect((await refusal(extractDocumentText("a.txt", Buffer.concat([buf(SAMPLE), Buffer.from([0xc3, 0x28])]))))?.message).toMatch(/not valid UTF-8/);
    expect((await refusal(extractDocumentText("a.txt", buf("short"))))?.message).toMatch(/not enough text/);
    const long = await refusal(extractDocumentText("a.txt", buf("word ".repeat(6000))));
    expect(long).toMatchObject({ code: "validation_error" });
    expect(long?.message).toMatch(/too long[\s\S]*one chapter or unit at a time/);
  });

  it("accepts pasted text with the same limits", () => {
    expect(extractPastedText(`  ${SAMPLE}  `).text).toBe(SAMPLE);
    expect(() => extractPastedText("x")).toThrow(/not enough text/);
    expect(() => extractPastedText(`${SAMPLE}\u0000`)).toThrow(/does not look like text/);
  });
});

describe("PDF files", () => {
  it("extracts the text of a text-based PDF, across pages", async () => {
    const r = await extractDocumentText("syllabus.pdf", makePdf([["Class 6 Mathematics. Fractions chapter outline.", "Students name fractions and compare them."], ["Next: adding fractions with unlike denominators (needs common denominators)."]]));
    expect(r.fileType).toBe("pdf");
    expect(r.pageCount).toBe(2);
    expect(r.text).toContain("Fractions chapter outline");
    expect(r.text).toContain("needs common denominators");
  });

  it("explains that a scanned PDF (no text layer) cannot be read, instead of returning nothing", async () => {
    const e = await refusal(extractDocumentText("scan.pdf", makePdf([[], []])));
    expect(e).toMatchObject({ code: "validation_error" });
    expect(e?.message).toMatch(/may be a scan[\s\S]*Paste the text instead/);
  });

  it("refuses a damaged PDF and a PDF that is too long", async () => {
    expect((await refusal(extractDocumentText("bad.pdf", Buffer.from("%PDF-1.4\nthis is not really a pdf"))))?.message).toMatch(/could not open this PDF/);
    const many = Array.from({ length: LIMITS.maxPages + 1 }, () => [SAMPLE]);
    expect((await refusal(extractDocumentText("big.pdf", makePdf(many))))?.message).toMatch(/limit is 60/);
  });

  it("checks what the file really is, not what its name says", async () => {
    const pdf = makePdf([[SAMPLE]]);
    expect((await refusal(extractDocumentText("looks-like-text.txt", pdf)))?.message).toMatch(/name and contents do not match/);
    expect((await refusal(extractDocumentText("fake.pdf", buf(SAMPLE))))?.message).toMatch(/name and contents do not match/);
    expect((await refusal(extractDocumentText("program.exe", pdf)))?.message).toMatch(/name and contents do not match/);
  });
});

describe("LocalStorage (private storage)", () => {
  it("stores, reads and deletes files by opaque key", async () => {
    const dir = await mkdtemp(join(tmpdir(), "adhyaapak-storage-"));
    try {
      const storage = new LocalStorage(dir);
      const key = await storage.put(Buffer.from("hello"));
      expect(key).toMatch(/^[a-f0-9]{32}$/);
      expect((await storage.get(key)).toString()).toBe("hello");
      await storage.delete(key);
      await expect(storage.get(key)).rejects.toThrow();
      await storage.delete(key); // deleting twice is harmless
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses keys that could escape the storage folder", async () => {
    const dir = await mkdtemp(join(tmpdir(), "adhyaapak-storage-"));
    try {
      const storage = new LocalStorage(dir);
      for (const bad of ["../secret", "..\\secret", "/etc/passwd", "a".repeat(31), "g".repeat(32), "", "a".repeat(32) + "/x"]) {
        await expect(storage.get(bad), bad).rejects.toThrow(/Invalid storage key/);
        await expect(storage.delete(bad), bad).rejects.toThrow(/Invalid storage key/);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
