import { AppError } from "../../http/errors";

/** Limits that keep one document within what a single AI call can sensibly handle. */
export const LIMITS = { maxPages: 60, maxChars: 24_000, minChars: 80 } as const;

export interface ExtractedDocument {
  fileType: "pdf" | "text";
  text: string;
  pageCount: number | null;
}

const reject = (message: string) => new AppError("validation_error", message);

const hasPdfSignature = (b: Buffer) => b.subarray(0, 5).toString("latin1") === "%PDF-";

/** Collapses runs of blank space and unifies line endings so stored text is predictable. */
export function cleanText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Checks what the file really is (not what its name claims) and returns plain text.
 *  - PDF: must start with the PDF signature and have a .pdf name; text is read without running any script;
 *  - text: .txt or .md, valid UTF-8, no NUL bytes.
 * Anything else is refused. Scanned PDFs (no text layer) are refused with a clear message.
 */
export async function extractDocumentText(filename: string, data: Buffer): Promise<ExtractedDocument> {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(filename.trim())?.[1]?.toLowerCase() ?? "";
  const isPdf = hasPdfSignature(data);

  if (ext === "pdf" || isPdf) {
    if (ext !== "pdf" || !isPdf) throw reject("This file's name and contents do not match. Upload a real PDF or a plain text file.");
    return extractPdf(data);
  }
  if (ext !== "txt" && ext !== "md") throw reject("Only PDF, .txt and .md files can be uploaded.");

  if (data.includes(0)) throw reject("This does not look like a text file.");
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    throw reject("This text file is not valid UTF-8. Save it as UTF-8 and try again.");
  }
  return finish("text", cleanText(decoded), null);
}

/** Accepts text pasted into the page. Same limits as a text file. */
export function extractPastedText(raw: string): ExtractedDocument {
  if (raw.includes("\u0000")) throw reject("This does not look like text.");
  return finish("text", cleanText(raw), null);
}

function finish(fileType: ExtractedDocument["fileType"], text: string, pageCount: number | null): ExtractedDocument {
  if (text.length < LIMITS.minChars) throw reject("There is not enough text to work with. Paste or upload the syllabus section itself.");
  if (text.length > LIMITS.maxChars) {
    throw reject(`This syllabus is too long (${text.length.toLocaleString("en-IN")} characters; the limit is ${LIMITS.maxChars.toLocaleString("en-IN")}). Upload one chapter or unit at a time.`);
  }
  return { fileType, text, pageCount };
}

async function extractPdf(data: Buffer): Promise<ExtractedDocument> {
  // Loaded on demand: it is a large module and only PDFs need it.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  let doc;
  const task = pdfjs.getDocument({
      data: new Uint8Array(data),
      // Read text only: no form scripts (XFA), no font programs from the untrusted file, no log noise.
      enableXfa: false,
      useSystemFonts: false,
      disableFontFace: true,
      verbosity: 0,
    });
  try {
    doc = await task.promise;
  } catch {
    await task.destroy().catch(() => undefined);
    throw reject("We could not open this PDF. It may be damaged or password protected.");
  }

  try {
    if (doc.numPages > LIMITS.maxPages) throw reject(`This PDF has ${doc.numPages} pages; the limit is ${LIMITS.maxPages}. Upload one chapter or unit at a time.`);
    const pages: string[] = [];
    let total = 0;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let line = "";
      let out = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        line += item.str;
        if (item.hasEOL) {
          out += `${line}\n`;
          line = "";
        }
      }
      out += line;
      pages.push(out);
      total += out.length;
      // Stop early on huge text so a hostile PDF cannot make us build an enormous string.
      if (total > LIMITS.maxChars * 2) break;
    }
    const text = cleanText(pages.join("\n\n"));
    if (text.length < LIMITS.minChars) {
      throw reject("We could not find readable text in this PDF. It may be a scan. Paste the text instead, or upload a text-based PDF.");
    }
    return finish("pdf", text, doc.numPages);
  } finally {
    await task.destroy(); // releases the document and its worker (pdf.js 6 destroys through the loading task)
  }
}
