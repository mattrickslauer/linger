// PDF → paragraphs, entirely in the browser. Gemini Nano does not accept PDF input, and the
// letters people struggle with are often private, so we extract text locally and only ever send
// the paragraph a reader is stuck on.

import type { Doc } from "./article";

interface Line {
  y: number;
  h: number;
  text: string;
}

export async function docFromPdf(file: File): Promise<Doc> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const paragraphs: string[] = [];
  for (let n = 1; n <= Math.min(pdf.numPages, 30); n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    // Group items into lines by baseline, then lines into paragraphs by vertical gaps.
    const lines: Line[] = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      const h = Math.abs(item.transform[3]) || item.height || 10;
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - y) < h * 0.5) last.text += (last.text.endsWith("-") ? "" : " ") + item.str;
      else lines.push({ y, h, text: item.str });
    }
    let current = "";
    for (let i = 0; i < lines.length; i++) {
      const gap = i > 0 ? lines[i - 1].y - lines[i].y : 0;
      if (current && gap > lines[i].h * 1.6) {
        paragraphs.push(current);
        current = "";
      }
      current += (current ? " " : "") + lines[i].text.trim();
    }
    if (current) paragraphs.push(current);
  }
  const clean = paragraphs.map((p) => p.replace(/\s+/g, " ").trim()).filter((p) => p.length > 1);
  const title = clean.length > 1 && clean[0].length < 120 ? clean.shift()! : file.name.replace(/\.pdf$/i, "");
  return {
    title,
    byline: `Opened from ${file.name}. The file never left this device.`,
    blocks: clean.map((text, i) => ({ kind: "p" as const, id: `pdf${i}`, text })),
  };
}
