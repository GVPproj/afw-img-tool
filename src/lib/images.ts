import { clampCrop, outputRatio, type OutputFormat, type Crop } from './crop';
import { diffusionDither } from './dither';

export type Color = 'copper' | 'berry' | 'lime';

export type Photo = {
  /** Full-resolution, natively EXIF-oriented source. Valid until dispose(). */
  source: CanvasImageSource;
  width: number;
  height: number;
  previewUrl: string;
  name: string;
  dispose: () => void;
};

export const OUTPUT_WIDTH = 1728;
// Artwork is laid out in the original design coordinates, rasterized at export density.
const DESIGN_WIDTH = 1080;
const OUTPUT_SCALE = OUTPUT_WIDTH / DESIGN_WIDTH;
const PREVIEW_SIZE = 1400;
type Logo = { element: HTMLCanvasElement; width: number; height: number };
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

/** Rasterize at 2x design size, trim alpha bounds, then render at export density. */
async function trimmedLogo(url: string, width: number): Promise<Logo> {
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
    const height = Math.max(1, Math.round(trimmedHeight * width / trimmedWidth));
    const target = canvas(Math.ceil(width * OUTPUT_SCALE), Math.ceil(height * OUTPUT_SCALE));
    result = target.element;
    target.context.drawImage(element, left, top, trimmedWidth, trimmedHeight, 0, 0, result.width, result.height);
    return { element: result, width, height };
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
  let logo: Promise<Logo> | undefined;
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
  const { element, context: noiseContext } = canvas(DESIGN_WIDTH, DESIGN_WIDTH, true);
  try {
    const noise = noiseContext.createImageData(DESIGN_WIDTH, DESIGN_WIDTH);
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

/** Mostly continuous duotone with a subtle print texture; artwork stays solid. */
function applyDuotone(context: CanvasRenderingContext2D, ink: string) {
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
    const screenStrength = 0.12;
    for (let i = 0; i < data.length; i += 4) {
      const luminance = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      const x = ((i / 4) % image.width) / OUTPUT_SCALE;
      const y = Math.floor(i / 4 / image.width) / OUTPUT_SCALE;
      // Preserve the original 3.2-design-pixel screen at the larger output size.
      const u = (x * 0.92388 + y * 0.382683) * 2 * Math.PI / 3.2;
      const v = (y * 0.92388 - x * 0.382683) * 2 * Math.PI / 3.2;
      const screen = (Math.cos(u) + Math.cos(v) + 2) / 4;
      const value = luminance ** 1.05;
      // Weighted white can round just below 1; keep that endpoint unscreened.
      const coverage = luminance <= 0 ? 0 : luminance >= 1 - Number.EPSILON ? 1
        : Math.max(0, Math.min(1, (value - screen) / 0.3 + 0.5));
      const tone = Math.round((value + (coverage - value) * screenStrength) * 255) * 4;
      data[i] = colors[tone];
      data[i + 1] = colors[tone + 1];
      data[i + 2] = colors[tone + 2];
    }
    context.putImageData(image, 0, 0);
  } finally {
    releaseCanvas(element);
  }
}

/** Resolve the two CSS inks, then dither the already-sized photo without grain. */
function applyDiffusionDither(context: CanvasRenderingContext2D, ink: string) {
  const { element, context: palette } = canvas(2, 1, true);
  try {
    palette.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-brand-navy').trim();
    palette.fillRect(0, 0, 1, 1);
    palette.fillStyle = ink;
    palette.fillRect(1, 0, 1, 1);
    const colors = palette.getImageData(0, 0, 2, 1).data;
    const image = context.getImageData(0, 0, context.canvas.width, context.canvas.height);
    diffusionDither(image, [colors[0], colors[1], colors[2]], [colors[4], colors[5], colors[6]]);
    context.putImageData(image, 0, 0);
  } finally {
    releaseCanvas(element);
  }
}

/** Feather navy beneath corner artwork, leaving the middle 40% of the photo clear. */
function shadeCorners(context: CanvasRenderingContext2D, shadeTop: boolean) {
  const { width, height } = context.canvas;
  const navy = getComputedStyle(document.documentElement).getPropertyValue('--color-brand-navy').trim();
  const corners = [[0, height], [width, height]];
  if (shadeTop) corners.push([0, 0], [width, 0]);
  for (const [x, y] of corners) {
    context.save();
    try {
      context.translate(x, y);
      context.scale(width * 0.75, height * 0.3);
      const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1);
      gradient.addColorStop(0, navy);
      gradient.addColorStop(0.25, navy);
      gradient.addColorStop(1, 'transparent');
      context.fillStyle = gradient;
      context.globalAlpha = 0.5;
      context.fillRect(-1, -1, 2, 2);
    } finally {
      context.restore();
    }
  }
}

function drawLogo(context: CanvasRenderingContext2D, logo: Logo, x: number, y: number, ink: string) {
  // Recolor the full-density alpha mask, never the cached original or the photo.
  const { element, context: mask } = canvas(logo.element.width, logo.element.height);
  try {
    mask.drawImage(logo.element, 0, 0);
    mask.globalCompositeOperation = 'source-in';
    mask.fillStyle = ink;
    mask.fillRect(0, 0, element.width, element.height);
    context.drawImage(element, x, y, logo.width, logo.height);
  } finally {
    releaseCanvas(element);
  }
}

/** Wrap at words, splitting oversized tokens; only reduce type when vertical space runs out. */
function layoutHost(context: CanvasRenderingContext2D, text: string, width: number, maxHeight: number, normalLineHeight: number) {
  let fontSize = 44;
  for (;;) {
    context.font = `${fontSize}px Iosevka`;
    const lines: string[] = [];
    let line = '';
    for (const word of text.trim().split(/\s+/).filter(Boolean)) {
      if (line && context.measureText(`${line} ${word}`).width > width) {
        lines.push(line);
        line = '';
      }
      for (const character of (line ? ' ' : '') + word) {
        if (line && context.measureText(line + character).width > width) {
          lines.push(line);
          line = '';
        }
        line += character;
      }
    }
    if (line) lines.push(line);
    const lineHeight = normalLineHeight * fontSize / 44;
    const height = lines.length * lineHeight;
    if (height <= maxHeight && lines.every(line => context.measureText(line).width <= width)) {
      return { lines, fontSize, lineHeight, height };
    }
    fontSize *= Math.min(0.9, Math.sqrt(maxHeight / height));
  }
}

function drawChirDetails(context: CanvasRenderingContext2D, host: string, date: string, ink: string, detailsBottom: number) {
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

  const hostLayout = layoutHost(context, host, 500, detailsBottom - 66 - lineHeight, lineHeight);
  hostLayout.lines.forEach((line, index) => context.fillText(line, left, 66 + index * hostLayout.lineHeight));

  drawShowDate(context, date, left, 66 + hostLayout.height);
}

function drawShowDate(context: CanvasRenderingContext2D, date: string, x: number, y: number) {
  // Parse calendar components locally; UTC parsing can shift the displayed day.
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [year, month, day] = date.split('-').map(Number);
    const showDate = new Date(0);
    showDate.setFullYear(year, month - 1, day);
    context.font = '44px Iosevka';
    context.fillText(showDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), x, y);
  }
}

function formatTime(time: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return '';
  const [hour, minute] = time.split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')}${hour < 12 ? 'am' : 'pm'}`;
}

function drawFooterDetails(context: CanvasRenderingContext2D, host: string, date: string, ink: string, cc: boolean, startTime: string, finishTime: string, height: number) {
  context.fillStyle = ink;
  context.font = '44px Iosevka';
  context.textBaseline = 'top';
  const left = 28;
  const right = 574;
  const lineHeight = 54;
  const hostLayout = layoutHost(context, host.trim() ? `with ${host.trim()}` : '', 510,
    height - 28 - 22 - 2 * lineHeight, lineHeight);
  const top = height - 22 - 2 * lineHeight - Math.max(lineHeight, hostLayout.height);
  const rightTop = height - 22 - 3 * lineHeight;
  context.font = '44px Iosevka';
  context.fillText('A Friendly Wave', left, top, 510);
  context.fillText(cc ? 'Community Curation' : 'Sunday Sessions', left, top + lineHeight, 510);
  context.font = `${hostLayout.fontSize}px Iosevka`;
  hostLayout.lines.forEach((line, index) => context.fillText(line, left, top + 2 * lineHeight + index * hostLayout.lineHeight));
  context.font = '44px Iosevka';
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [year, month, day] = date.split('-').map(Number);
    const showDate = new Date(0);
    showDate.setFullYear(year, month - 1, day);
    const formattedDate = showDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const label = cc ? formattedDate : formattedDate.replace(',', '');
    context.fillText(label, right, rightTop, 478);
  }
  const time = cc ? [formatTime(startTime), formatTime(finishTime)].filter(Boolean).join('–') : '10:15am–1:15pm';
  if (time) context.fillText(time, right, rightTop + lineHeight, 478);
  context.fillText('Cassette Café', right, rightTop + 2 * lineHeight, 478);
}

/** Opaque 1728px PNG. Effects run at export size before full-density artwork. */
export async function renderThumbnail(
  photo: Photo,
  crop: Crop,
  { format = 'square', radio = 'island-city', host = '', date = '', startTime = '', finishTime = '', color = 'lime', duotone = false, dither = false, cornerGradient = false }: {
    format?: OutputFormat;
    radio?: 'island-city' | 'chir-fm' | 'sunday' | 'cc';
    host?: string;
    date?: string;
    startTime?: string;
    finishTime?: string;
    color?: Color;
    duotone?: boolean;
    dither?: boolean;
    cornerGradient?: boolean;
  } = {},
): Promise<Blob> {
  const ratio = outputRatio(format);
  const height = Math.round(OUTPUT_WIDTH / ratio);
  const designHeight = DESIGN_WIDTH / ratio;
  const normalized = clampCrop(crop, photo, ratio);
  const footer = radio === 'sunday' || radio === 'cc';
  const [island, afw, chir] = await Promise.all([
    radio === 'island-city' ? loadIslandLogo() : undefined,
    !footer ? loadAfwLogo() : undefined,
    radio === 'chir-fm' ? loadChirLogo() : undefined,
  ]);
  if (radio !== 'island-city' || date) await document.fonts.load('44px Iosevka');
  const { element, context } = canvas(OUTPUT_WIDTH, height, true);
  try {
    const side = Math.max(1, Math.min(Math.round(normalized.size * photo.width), photo.width, photo.height * ratio));
    const cropHeight = Math.min(photo.height, side / ratio);
    const left = Math.max(0, Math.min(Math.round(normalized.left * photo.width), photo.width - side));
    const top = Math.max(0, Math.min(Math.round(normalized.top * photo.height), photo.height - cropHeight));
    context.fillStyle = '#000';
    context.fillRect(0, 0, OUTPUT_WIDTH, height);
    try {
      context.drawImage(photo.source, left, top, side, cropHeight, 0, 0, OUTPUT_WIDTH, height);
    } catch {
      throw new Error('The photo is no longer available. Select it again before exporting.');
    }
    const ink = getComputedStyle(document.documentElement).getPropertyValue(`--color-brand-${color}`).trim();
    if (dither) {
      applyDiffusionDither(context, ink);
    } else {
      addGrain(context);
      if (duotone) applyDuotone(context, ink);
    }
    if (cornerGradient) shadeCorners(context, !footer);
    // Only artwork uses design coordinates. Photo pixels, dither and shading
    // above are already at native output resolution and are never enlarged.
    context.scale(OUTPUT_SCALE, OUTPUT_SCALE);
    if (island) {
      drawLogo(context, island, 49, 49, ink);
      context.fillStyle = ink;
      context.textBaseline = 'bottom';
      drawShowDate(context, date, 24, designHeight - 20);
    }
    if (radio === 'chir-fm') drawChirDetails(context, host, date, ink, designHeight - (chir?.height ?? 0) - 40);
    if (chir) drawLogo(context, chir, 24, designHeight - chir.height - 20, ink);
    if (footer) drawFooterDetails(context, host, date, ink, radio === 'cc', startTime, finishTime, designHeight);
    if (afw) drawLogo(context, afw, DESIGN_WIDTH - afw.width, designHeight - afw.height, ink);
    return await toBlob(element);
  } finally {
    releaseCanvas(element);
  }
}
