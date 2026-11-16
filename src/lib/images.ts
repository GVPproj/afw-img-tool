import { clampCrop, type Crop } from './crop';

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
    context.drawImage(noise, 0, 0);
  } finally {
    context.restore();
  }
}

/** Opaque 1080px PNG. Stable grain never covers logos; AFW is always included. */
export async function renderThumbnail(
  photo: Photo,
  crop: Crop,
  { islandCity = true }: { islandCity?: boolean } = {},
): Promise<Blob> {
  const normalized = clampCrop(crop, photo);
  const [island, afw] = await Promise.all([
    islandCity ? loadIslandLogo() : undefined,
    loadAfwLogo(),
  ]);
  const { element, context } = canvas(SIZE, SIZE, true);
  try {
    // Match the reference pipeline's source-pixel rounding and square geometry.
    const side = Math.max(1, Math.min(Math.round(normalized.size * photo.width), photo.width, photo.height));
    const left = Math.max(0, Math.min(Math.round(normalized.left * photo.width), photo.width - side));
    const top = Math.max(0, Math.min(Math.round(normalized.top * photo.height), photo.height - side));
    context.fillStyle = '#000';
    context.fillRect(0, 0, SIZE, SIZE);
    try {
      context.drawImage(photo.source, left, top, side, side, 0, 0, SIZE, SIZE);
    } catch {
      throw new Error('The photo is no longer available. Select it again before exporting.');
    }
    addGrain(context);
    if (island) context.drawImage(island, 49, 49);
    context.drawImage(afw, SIZE - afw.width, SIZE - afw.height);
    return await toBlob(element);
  } finally {
    releaseCanvas(element);
  }
}
