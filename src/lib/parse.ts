import mammoth from "mammoth";

// Document parsing. Docling (Python) is the production choice; for the MVP we
// parse in-process: pdf-parse for PDF, mammoth for DOCX, raw text otherwise.

export async function parseDocument(buffer: Buffer, filename: string): Promise<string> {
  const ext = filename.toLowerCase().split(".").pop() || "";

  if (ext === "pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  }

  if (ext === "docx" || ext === "doc") {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  // txt / md / anything else — treat as UTF-8 text
  return buffer.toString("utf-8");
}
