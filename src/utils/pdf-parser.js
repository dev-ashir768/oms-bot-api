import fs from "fs";
async function extractTextFromPdf(filePath) {
  const { default: pdfParse } = await import("pdf-parse/lib/pdf-parse.js");
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  return data.text;
}
export {
  extractTextFromPdf
};

//# sourceMappingURL=pdf-parser.js.map
