/**
 * Client-side capture quality feedback (blur + lighting) — NOT face recognition.
 * Embeddings are computed only on the backend.
 */
export interface QualityReport {
  brightness: number; // 0..255 mean luma
  sharpness: number; // variance of Laplacian
  issues: Array<'blurry' | 'too_dark' | 'too_bright'>;
  ok: boolean;
}

const MIN_SHARPNESS = 40;
const MIN_BRIGHTNESS = 50;
const MAX_BRIGHTNESS = 215;

export function analyzePixels(data: Uint8ClampedArray, width: number, height: number): QualityReport {
  const n = width * height;
  const gray = new Float32Array(n);
  let lum = 0;
  for (let i = 0; i < n; i += 1) {
    const g = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!;
    gray[i] = g;
    lum += g;
  }
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const lap = gray[i - 1]! + gray[i + 1]! + gray[i - width]! + gray[i + width]! - 4 * gray[i]!;
      sum += lap;
      sumSq += lap * lap;
      count += 1;
    }
  }
  const brightness = n ? lum / n : 0;
  const mean = count ? sum / count : 0;
  const sharpness = count ? sumSq / count - mean * mean : 0;
  const issues: QualityReport['issues'] = [];
  if (sharpness < MIN_SHARPNESS) issues.push('blurry');
  if (brightness < MIN_BRIGHTNESS) issues.push('too_dark');
  if (brightness > MAX_BRIGHTNESS) issues.push('too_bright');
  return { brightness, sharpness, issues, ok: issues.length === 0 };
}

/** Analyse the centre of a video/image source, downscaled for speed. */
export function analyzeSource(source: CanvasImageSource, srcW: number, srcH: number): QualityReport | null {
  if (!srcW || !srcH) return null;
  const w = 160;
  const h = Math.round((srcH / srcW) * w);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);
  // Centre 60% — where the face should be.
  const cx = Math.round(w * 0.2);
  const cy = Math.round(h * 0.2);
  const cw = Math.round(w * 0.6);
  const ch = Math.round(h * 0.6);
  const { data } = ctx.getImageData(cx, cy, cw, ch);
  return analyzePixels(data, cw, ch);
}

/** Draw a source into a JPEG data URL whose longest side is ≤ maxSide (keeps uploads small). */
export function toJpegDataUrl(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  { maxSide = 720, mirror = false, quality = 0.88 } = {},
): string {
  const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
  const w = Math.round(srcW * scale);
  const h = Math.round(srcH * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  if (mirror) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

export function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image'));
    };
    img.src = url;
  });
}

export const ISSUE_TEXT: Record<string, string> = {
  blurry: 'Image is blurry — hold still',
  too_dark: 'Too dark — add light',
  too_bright: 'Too bright — avoid direct light',
  face_too_small: 'Move closer to the camera',
  multiple_faces: 'More than one face in frame',
};
