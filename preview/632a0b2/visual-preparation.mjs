export const maxImageBytes = 2 * 1024 * 1024;
const maxSourceBytes = 20 * 1024 * 1024;
const maxSourcePixels = 40_000_000;
const maxPageCount = 60;

const pngMagic = [137, 80, 78, 71, 13, 10, 26, 10];
const ascii = (bytes, start, end) => String.fromCharCode(...bytes.subarray(start, end));
export function imageDimensions(bytes, type) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === "image/png" && bytes.length >= 24 && pngMagic.every((byte, i) => bytes[i] === byte) && ascii(bytes, 12, 16) === "IHDR") {
    return [view.getUint32(16), view.getUint32(20)];
  }
  if (type === "image/webp" && bytes.length >= 30 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    const chunk = ascii(bytes, 12, 16);
    if (chunk === "VP8X") return [1 + (view.getUint32(23, true) & 0xffffff), 1 + (bytes[26] | (bytes[27] << 8) | (bytes[28] << 16))];
    if (chunk === "VP8L" && bytes[20] === 47) {
      const packed = view.getUint32(21, true);
      return [1 + (packed & 0x3fff), 1 + ((packed >>> 14) & 0x3fff)];
    }
    if (chunk === "VP8 " && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) {
      return [view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff];
    }
  }
  if (type === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216) {
    for (let i = 2; i + 4 < bytes.length;) {
      if (bytes[i++] !== 255) break;
      while (bytes[i] === 255) i++;
      const marker = bytes[i++];
      if (marker === 0xda || marker === 0xd9 || i + 2 > bytes.length) break;
      const length = view.getUint16(i);
      if (length < 2 || i + length > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 8) {
        return [view.getUint16(i + 5), view.getUint16(i + 3)];
      }
      i += length;
    }
  }
  throw new Error("The file does not match a supported image format.");
}

async function digest(bytes) {
  if (!globalThis.crypto?.subtle) return null;
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    byte => byte.toString(16).padStart(2, "0")).join("");
}

async function payload(bytes, type, width, height, sha256 = undefined) {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 16384) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 16384)));
  }
  return {
    dataUrl: "data:" + type + ";base64," + btoa(chunks.join("")),
    prepared: { type, bytes: bytes.length, width, height, sha256: sha256 ?? await digest(bytes) }
  };
}

function canvasOf(width, height) {
  return Object.assign(document.createElement("canvas"), { width, height });
}

async function encodeCanvas(canvas, createCanvas) {
  let current = canvas;
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const blob = await new Promise(resolve => current.toBlob(resolve, "image/jpeg", attempt ? 0.7 : 0.86));
      if (blob?.size && blob.type === "image/jpeg" && blob.size <= maxImageBytes) {
        return await payload(new Uint8Array(await blob.arrayBuffer()), blob.type, current.width, current.height);
      }
      if (attempt === 3) break;
      const next = createCanvas(Math.max(1, Math.floor(current.width * .75)), Math.max(1, Math.floor(current.height * .75)));
      next.getContext("2d", { alpha: false }).drawImage(current, 0, 0, next.width, next.height);
      current.width = current.height = 0;
      current = next;
    }
    throw new Error("The prepared image exceeds the transmission limit.");
  } finally {
    current.width = current.height = 0;
  }
}

async function withTimeout(promise, cancel) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => { cancel(); reject(new Error("PDF preparation timed out.")); }, 15000);
    })]);
  } finally { clearTimeout(timer); }
}

async function loadPdf(bytes) {
  const pdf = await import("./vendor/pdfjs/pdf.min.mjs");
  pdf.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
  const task = pdf.getDocument({ data: bytes, isEvalSupported: false, useWasm: false, useSystemFonts: true,
    stopAtErrors: true, maxImageSize: maxSourcePixels });
  try {
    const document = await withTimeout(task.promise, () => { void task.destroy().catch(() => {}); });
    return { document, dispose: () => task.destroy() };
  } catch {
    await task.destroy().catch(() => {});
    throw new Error("Could not open this PDF. Password-protected or unsupported PDFs may fail.");
  }
}

export async function prepareSource(file, { decode = async blob => {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally { URL.revokeObjectURL(url); }
}, createCanvas = canvasOf, openPdf = loadPdf } = {}) {
  if (!file?.size || file.size > maxSourceBytes) throw new Error("Choose a file no larger than 20 MiB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = file.type || (/\.pdf$/i.test(file.name) ? "application/pdf" : "");
  const metadata = { name: file.name.slice(0, 180), source: "selected_file", type, bytes: bytes.length };
  if (type === "application/pdf") {
    if (ascii(bytes, 0, 5) !== "%PDF-") throw new Error("The file does not match the PDF format.");
    metadata.sha256 = await digest(bytes);
    const opened = await openPdf(bytes);
    const pdf = opened.document;
    if (pdf.numPages < 1 || pdf.numPages > maxPageCount) {
      await opened.dispose();
      throw new Error("Choose a PDF with 1–60 pages.");
    }
    return { metadata, pageCount: pdf.numPages, dispose: opened.dispose, async render(pageNumber) {
      const page = await pdf.getPage(pageNumber);
      const natural = page.getViewport({ scale: 1 });
      if (!Number.isFinite(natural.width) || !Number.isFinite(natural.height) ||
          natural.width <= 0 || natural.height <= 0) throw new Error("PDF page dimensions are invalid.");
      const viewport = page.getViewport({ scale: 1800 / Math.max(natural.width, natural.height) });
      const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
      try {
        const render = page.render({ canvas, canvasContext: canvas.getContext("2d", { alpha: false }), viewport });
        await withTimeout(render.promise, () => render.cancel?.());
        return { ...await encodeCanvas(canvas, createCanvas), metadata, adapted: true,
          page: { number: pageNumber, total: pdf.numPages } };
      } finally {
        canvas.width = canvas.height = 0;
        page.cleanup();
      }
    } };
  }

  const [width, height] = imageDimensions(bytes, type);
  if (!width || !height || width > 12000 || height > 12000 || width * height > maxSourcePixels) {
    throw new Error("Choose an image within 40 megapixels and 12,000 pixels per side.");
  }
  Object.assign(metadata, { width, height, sha256: await digest(bytes) });
  let image;
  try { image = await decode(file); } catch { throw new Error("The image could not be decoded."); }
  const w = image.naturalWidth, h = image.naturalHeight;
  if (!w || !h || w * h > maxSourcePixels) throw new Error("Decoded image dimensions are unsupported.");
  const adapted = bytes.length > maxImageBytes || w * h > 16000000;
  if (!adapted) return { ...await payload(bytes, type, w, h, metadata.sha256), metadata, adapted };
  const scale = Math.min(1, 1800 / Math.max(w, h));
  const canvas = createCanvas(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { ...await encodeCanvas(canvas, createCanvas), metadata, adapted };
}
