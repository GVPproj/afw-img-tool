import { clampCrop, outputRatio, type OutputFormat, type Crop } from './crop';

export type Tint = 'none' | 'copper' | 'berry' | 'lime';

export type Photo = {
  /** Full-resolution, natively EXIF-oriented source. Valid until dispose(). */
  source: CanvasImageSource;
  width: number;
  height: number;
  previewUrl: string;
  name: string;
  dispose: () => void;
};

const SIZE = 1080;
const PREVIEW_SIZE = 1400;
const DECODE_ERROR = 'This image could not be decoded. It may be damaged or too large for this browser. Try exporting a smaller JPEG or PNG.';
const HEIC_ERROR = 'HEIC/HEIF photos are not supported. Export or convert the photo to JPEG or PNG first (on iPhone, choose Most Compatible in Camera settings for future photos).';

function canvas(width: number, height: number, opaque = false) {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  const context = element.getContext('2d', { alpha: !opaque });
  if (!context) throw new Error('This browser could not create an image canvas.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  return { element, context };
}

function releaseCanvas(element: HTMLCanvasElement) {
  element.width = 0;
  element.height = 0;
}

function toBlob(element: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    element.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The browser could not export this image. Try a smaller photo.'));
    }, type, 0.92);
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      image.onload = image.onerror = null;
      if (image.naturalWidth && image.naturalHeight) resolve(image);
      else {
        image.removeAttribute('src');
        reject(new Error(DECODE_ERROR));
      }
    };
    image.onerror = () => {
      image.onload = image.onerror = null;
      image.removeAttribute('src');
      reject(new Error(DECODE_ERROR));
    };
    // Modern HTMLImageElement decoding applies EXIF orientation itself, just as
    // createImageBitmap(from-image) does. Never apply an additional transform.
    image.src = url;
  });
}

async function sniff(file: File): Promise<'image/jpeg' | 'image/png'> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  } catch {
    throw new Error('This file could not be read. Please select it again.');
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const png = [137, 80, 78, 71, 13, 10, 26, 10];
  if (png.every((byte, i) => bytes[i] === byte)) return 'image/png';

  const header = String.fromCharCode(...bytes);
  const heifBrands = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'];
  const isHeif = header.slice(4, 8) === 'ftyp' && heifBrands.some((brand) => header.includes(brand, 8));
  if (isHeif || /\.(heic|heif)$/i.test(file.name) || /^image\/hei[cf]/i.test(file.type)) {
    throw new Error(HEIC_ERROR);
  }
  throw new Error('Choose a JPEG or PNG photo. Other image formats are not supported.');
}

/** Validate by signature, decode once natively, retain full source and make a small preview. */
export async function loadPhoto(file: File): Promise<Photo> {
  const type = await sniff(file);
  // Do not trust the supplied MIME type; it can be missing or incorrect.
  const blob = file.slice(0, file.size, type);
  let bitmap: ImageBitmap | undefined;
  let image: HTMLImageElement | undefined;
  let decodeUrl: string | undefined;
  let previewUrl: string | undefined;
  let preview: HTMLCanvasElement | undefined;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    bitmap?.close();
    image?.removeAttribute('src');
    if (decodeUrl) URL.revokeObjectURL(decodeUrl);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  };

  try {
    if (typeof createImageBitmap === 'function') {
      try {
        bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      } catch {
        // Some browsers support bitmap decoding but not this format/options.
        // The fallback also uses native orientation, not a second EXIF pass.
      }
    }
    if (!bitmap) {
      decodeUrl = URL.createObjectURL(blob);
      image = await loadImage(decodeUrl);
    }
    const source = bitmap ?? image!;
    const width = bitmap ? bitmap.width : image!.naturalWidth;
    const height = bitmap ? bitmap.height : image!.naturalHeight;
    if (width <= 0 || height <= 0) throw new Error(DECODE_ERROR);
    const scale = Math.min(1, PREVIEW_SIZE / Math.max(width, height));
    const { element, context } = canvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)), true);
    preview = element;
    context.fillStyle = '#000';
    context.fillRect(0, 0, element.width, element.height);
    context.drawImage(source, 0, 0, element.width, element.height);
    previewUrl = URL.createObjectURL(await toBlob(element, 'image/jpeg'));
    return { source, width, height, previewUrl, name: file.name, dispose };
  } catch {
    dispose();
    throw new Error(DECODE_ERROR);
  } finally {
    if (preview) releaseCanvas(preview);
  }
}

/** Rasterize at 2x, find actual alpha bounds, then resize the trimmed mark. */
async function trimmedLogo(url: string, width: number): Promise<HTMLCanvasElement> {
  const image = await loadImage(url);
  let raster: HTMLCanvasElement | undefined;
  let result: HTMLCanvasElement | undefined;
  try {
    const { element, context } = canvas(width * 2, Math.max(1, Math.round(width * 2 * image.naturalHeight / image.naturalWidth)));
    raster = element;
    context.drawImage(image, 0, 0, element.width, element.height);
    const { data } = context.getImageData(0, 0, element.width, element.height);
    let left = element.width;
    let top = element.height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < element.height; y++) {
      for (let x = 0; x < element.width; x++) {
        if (data[(y * element.width + x) * 4 + 3] !== 0) {
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
      }
    }
    if (right < left) throw new Error('The logo asset is empty.');
    const trimmedWidth = right - left + 1;
    const trimmedHeight = bottom - top + 1;
    const target = canvas(width, Math.max(1, Math.round(trimmedHeight * width / trimmedWidth)));
    result = target.element;
    target.context.drawImage(element, left, top, trimmedWidth, trimmedHeight, 0, 0, result.width, result.height);
    return result;
  } catch (error) {
    if (result) releaseCanvas(result);
    throw error;
  } finally {
    image.removeAttribute('src');
    if (raster) releaseCanvas(raster);
  }
}

function cachedLogo(url: string, width: number) {
  // Cache only a fixed asset, never photo data; allow retry after a load failure.
  let logo: Promise<HTMLCanvasElement> | undefined;
  return () => {
    logo ??= trimmedLogo(url, width).catch(() => {
      logo = undefined;
      throw new Error('The thumbnail logos could not be loaded. Reload the page and try again.');
    });
    return logo;
  };
}

const loadIslandLogo = cachedLogo(new URL('../assets/island-city.svg', import.meta.url).href, 324);
const loadChirLogo = cachedLogo(new URL('../assets/chir-fm.svg', import.meta.url).href, 198);
const loadAfwLogo = cachedLogo(new URL('../assets/Logo-Mark_AFW.svg', import.meta.url).href, 454);

// One fixed 1080px noise canvas shared by all renders, with no photo references.
let grain: HTMLCanvasElement | undefined;
function getGrain(): HTMLCanvasElement {
  if (grain) return grain;
  const { element, context: noiseContext } = canvas(SIZE, SIZE, true);
  try {
    const noise = noiseContext.createImageData(SIZE, SIZE);
    const { data } = noise;
    // Box–Muller: independent Gaussian samples, mean 128 and sigma 25.
    // One intensity per pixel gives monochrome (not colored) grain.
    for (let i = 0; i < data.length; i += 8) {
      const radius = Math.sqrt(-2 * Math.log(1 - Math.random())) * 25;
      const angle = 2 * Math.PI * Math.random();
      const first = 128 + radius * Math.cos(angle);
      const second = 128 + radius * Math.sin(angle);
      data[i] = data[i + 1] = data[i + 2] = first;
      data[i + 3] = 255;
      if (i + 4 < data.length) {
        data[i + 4] = data[i + 5] = data[i + 6] = second;
        data[i + 7] = 255;
      }
    }
    noiseContext.putImageData(noise, 0, 0);
    grain = element;
    return grain;
  } catch (error) {
    releaseCanvas(element);
    throw error;
  }
}

function addGrain(context: CanvasRenderingContext2D) {
  const noise = getGrain();
  context.save();
  try {
    context.globalCompositeOperation = 'soft-light';
    if (context.globalCompositeOperation !== 'soft-light') {
      throw new Error('This browser does not support soft-light image blending.');
    }
    context.drawImage(noise, 0, 0, context.canvas.width, context.canvas.height);
  } finally {
    context.restore();
  }
}

/** Map luminance (including grain) from theme navy to the selected theme ink. */
function applyTint(context: CanvasRenderingContext2D, ink: string) {
  const { element, context: palette } = canvas(256, 1, true);
  try {
    // Canvas resolves CSS colors and provides a small lookup table for the photo.
    const gradient = palette.createLinearGradient(0.5, 0, 255.5, 0);
    gradient.addColorStop(0, getComputedStyle(document.documentElement).getPropertyValue('--color-brand-navy').trim());
    gradient.addColorStop(1, ink);
    palette.fillStyle = gradient;
    palette.fillRect(0, 0, 256, 1);
    const colors = palette.getImageData(0, 0, 256, 1).data;
    const image = context.getImageData(0, 0, context.canvas.width, context.canvas.height);
    const { data } = image;
    for (let i = 0; i < data.length; i += 4) {
      const tone = Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) * 4;
      data[i] = colors[tone];
      data[i + 1] = colors[tone + 1];
      data[i + 2] = colors[tone + 2];
    }
    context.putImageData(image, 0, 0);
  } finally {
    releaseCanvas(element);
  }
}

function drawLogo(context: CanvasRenderingContext2D, logo: HTMLCanvasElement, x: number, y: number, ink?: string) {
  if (!ink) {
    context.drawImage(logo, x, y);
    return;
  }
  // Recolor an alpha mask, never the cached original or the photo beneath it.
  const { element, context: mask } = canvas(logo.width, logo.height);
  try {
    mask.drawImage(logo, 0, 0);
    mask.globalCompositeOperation = 'source-in';
    mask.fillStyle = ink;
    mask.fillRect(0, 0, element.width, element.height);
    context.drawImage(element, x, y);
  } finally {
    releaseCanvas(element);
  }
}

function drawChirDetails(context: CanvasRenderingContext2D, host: string, date: string, ink = '#e2ff78') {
  context.fillStyle = ink;
  context.font = '44px Iosevka';
  context.textBaseline = 'top';
  const lineHeight = 50;
  const left = 16;
  const right = 620;
  context.fillText('A Friendly Wave Radio', left, 16);
  ['Tuesdays at 7:00pm', '107.9 fm / 102.1 fm', 'Chir.fm'].forEach((line, index) => {
    context.fillText(line, right, 16 + index * lineHeight);
  });

  // Wrap host names within the left column, including unbroken long names.
  // Shrink unusually long entries rather than clipping or overlapping the schedule.
  let lines: string[] = [];
  let fontSize = 44;
  do {
    context.font = `${fontSize}px Iosevka`;
    lines = [];
    let line = '';
    for (const word of host.trim().split(/\s+/).filter(Boolean)) {
      if (line && context.measureText(`${line} ${word}`).width > 500) {
        lines.push(line);
        line = '';
      }
      for (const character of (line ? ' ' : '') + word) {
        if (context.measureText(line + character).width > 500) {
          lines.push(line);
          line = '';
        }
        line += character;
      }
    }
    if (line) lines.push(line);
    if (lines.length <= 3) break;
    fontSize -= 2;
  } while (fontSize >= 20);
  lines.forEach((line, index) => context.fillText(line, left, 66 + index * lineHeight));

  // Parse calendar components locally; UTC parsing can shift the displayed day.
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [year, month, day] = date.split('-').map(Number);
    const showDate = new Date(0);
    showDate.setFullYear(year, month - 1, day);
    context.font = '44px Iosevka';
    context.fillText(showDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), left, 66 + lines.length * lineHeight);
  }
}

/** Opaque 1080px PNG. Stable grain never covers logos; AFW is always included. */
export async function renderThumbnail(
  photo: Photo,
  crop: Crop,
  { islandCity = true, format = 'square', radio = 'island-city', host = '', date = '', tint = 'none' }: {
    islandCity?: boolean;
    format?: OutputFormat;
    radio?: 'island-city' | 'chir-fm';
    host?: string;
    date?: string;
    tint?: Tint;
  } = {},
): Promise<Blob> {
  const ratio = outputRatio(format);
  const height = Math.round(SIZE / ratio);
  const normalized = clampCrop(crop, photo, ratio);
  const [island, afw, chir] = await Promise.all([
    radio === 'island-city' && islandCity ? loadIslandLogo() : undefined,
    loadAfwLogo(),
    radio === 'chir-fm' ? loadChirLogo() : undefined,
  ]);
  if (radio === 'chir-fm') await document.fonts.load('44px Iosevka');
  const { element, context } = canvas(SIZE, height, true);
  try {
    const side = Math.max(1, Math.min(Math.round(normalized.size * photo.width), photo.width, photo.height * ratio));
    const cropHeight = Math.min(photo.height, side / ratio);
    const left = Math.max(0, Math.min(Math.round(normalized.left * photo.width), photo.width - side));
    const top = Math.max(0, Math.min(Math.round(normalized.top * photo.height), photo.height - cropHeight));
    context.fillStyle = '#000';
    context.fillRect(0, 0, SIZE, height);
    try {
      context.drawImage(photo.source, left, top, side, cropHeight, 0, 0, SIZE, height);
    } catch {
      throw new Error('The photo is no longer available. Select it again before exporting.');
    }
    addGrain(context);
    const ink = radio === 'chir-fm' && tint !== 'none'
      ? getComputedStyle(document.documentElement).getPropertyValue(`--color-brand-${tint}`).trim()
      : undefined;
    if (ink) applyTint(context, ink);
    if (island) context.drawImage(island, 49, 49);
    if (radio === 'chir-fm') drawChirDetails(context, host, date, ink);
    if (chir) drawLogo(context, chir, 24, height - chir.height - 20, ink);
    drawLogo(context, afw, SIZE - afw.width, height - afw.height, ink);
    return await toBlob(element);
  } finally {
    releaseCanvas(element);
  }
}
