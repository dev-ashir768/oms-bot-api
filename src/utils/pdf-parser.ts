import fs from "fs";

export async function extractTextFromPdf(filePath: string): Promise<string> {
  // Import the inner module directly to avoid pdf-parse's test file read bug
  const { default: pdfParse } = await import("pdf-parse/lib/pdf-parse.js");
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  return data.text;
}
