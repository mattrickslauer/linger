// Rasterise an inline SVG figure to PNG (base64, no data: prefix). Gemini Nano accepts only
// PNG/JPEG inline data, so figures are converted before they are sent to either backend.
export async function svgToPngBase64(svg: string, width: number): Promise<string> {
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const ratio = img.naturalHeight / img.naturalWidth || 0.53;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = Math.round(width * ratio);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png").split(",")[1];
  } finally {
    URL.revokeObjectURL(url);
  }
}
