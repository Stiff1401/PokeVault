/**
 * Client-side frame analysis for the live scanner quality gate.
 * Everything runs on small canvases so it is cheap enough for a 300 ms loop.
 */

/** Normalised rectangle (0..1) relative to the card frame. */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Target zones on a 63:88 Pokémon card. The values were tuned by measuring
 * Tesseract hit rates on Scarlet & Violet and Sword & Shield era scans.
 */
export const CARD_REGIONS: { title: Region; titleWide: Region; number: Region } = {
  /** Card name without the stage icon on the left and the HP value on the right. */
  title: { x: 0.18, y: 0.04, w: 0.56, h: 0.075 },
  /** Wider second look for names that start further left (Trainer, ex, older layouts). */
  titleWide: { x: 0.08, y: 0.03, w: 0.7, h: 0.1 },
  /** Single text line at the bottom left holding the collector number `XXX/YYY`. */
  number: { x: 0.03, y: 0.94, w: 0.36, h: 0.04 },
};

export const CARD_ASPECT = 63 / 88;

export interface QualityThresholds {
  /** Minimum Laplacian variance for a sharp collector number. */
  sharpness: number;
  /** Maximum share of clipped white pixels (0..1). */
  glare: number;
}

export interface FrameQuality {
  sharpness: number;
  glare: number;
  focusOk: boolean;
  glareOk: boolean;
  ok: boolean;
}

/** Variance of the 3x3 Laplacian – the classic "is this in focus" measure. */
export function laplacianVariance(data: Uint8ClampedArray, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const lap = gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }
  if (!count) return 0;
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

/** Share of clipped highlight pixels (R, G and B all above 248). */
export function glareRatio(data: Uint8ClampedArray): number {
  let clipped = 0;
  const pixels = data.length / 4;
  for (let p = 0; p < data.length; p += 4) {
    if (data[p] > 248 && data[p + 1] > 248 && data[p + 2] > 248) clipped++;
  }
  return pixels ? clipped / pixels : 0;
}

export function regionToPixels(region: Region, width: number, height: number): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.round(region.x * width),
    y: Math.round(region.y * height),
    w: Math.max(1, Math.round(region.w * width)),
    h: Math.max(1, Math.round(region.h * height)),
  };
}

/**
 * Analyses a canvas that contains exactly the card frame.
 * Sharpness is measured on the collector-number strip, glare on the whole card.
 */
export function analyzeCardFrame(canvas: HTMLCanvasElement, thresholds: QualityThresholds): FrameQuality {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || !canvas.width || !canvas.height) {
    return { sharpness: 0, glare: 0, focusOk: false, glareOk: false, ok: false };
  }
  const strip = regionToPixels(CARD_REGIONS.number, canvas.width, canvas.height);
  const stripData = ctx.getImageData(strip.x, strip.y, strip.w, strip.h);
  const sharpness = laplacianVariance(stripData.data, strip.w, strip.h);

  const full = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const glare = glareRatio(full.data);

  const focusOk = sharpness >= thresholds.sharpness;
  const glareOk = glare <= thresholds.glare;
  return { sharpness, glare, focusOk, glareOk, ok: focusOk && glareOk };
}

/**
 * Maps a rectangle given in the coordinates of an `object-fit: cover` video
 * element back to the intrinsic pixel coordinates of the video stream.
 */
export function elementRectToVideoRect(
  video: HTMLVideoElement,
  rect: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const cw = video.clientWidth;
  const ch = video.clientHeight;
  if (!vw || !vh || !cw || !ch) return { x: 0, y: 0, w: 0, h: 0 };
  const scale = Math.max(cw / vw, ch / vh);
  const offsetX = (vw * scale - cw) / 2;
  const offsetY = (vh * scale - ch) / 2;
  return {
    x: (rect.x + offsetX) / scale,
    y: (rect.y + offsetY) / scale,
    w: rect.w / scale,
    h: rect.h / scale,
  };
}
