export function chunkText(
  text: string,
  chunkSize = 1000,
  chunkOverlap = 200
): string[] {
  const chunks: string[] = [];
  const cleanedText = text.replace(/\s+/g, " ").trim();

  if (cleanedText.length <= chunkSize) {
    return cleanedText.length > 0 ? [cleanedText] : [];
  }

  let start = 0;
  while (start < cleanedText.length) {
    let end = start + chunkSize;
    if (end < cleanedText.length) {
      const lastSpace = cleanedText.lastIndexOf(" ", end);
      if (lastSpace > start) end = lastSpace;
    }
    const chunk = cleanedText.slice(start, end).trim();
    if (chunk.length > 0) chunks.push(chunk);
    start = end - chunkOverlap;
    if (start >= cleanedText.length) break;
  }

  return chunks;
}
