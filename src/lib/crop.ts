/** Crop: left and size are fractions of width; top is a fraction of height. */
export type Crop = { left: number; top: number; size: number };
export type Dimensions = { width: number; height: number };

export type OutputFormat = 'square' | 'portrait';
export const outputRatio = (format: OutputFormat) => format === 'portrait' ? 4 / 5 : 1;

export function cropBounds({ width, height }: Dimensions, ratio = 1) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RangeError('Image dimensions must be finite and positive.');
  }
  const shortest = Math.min(width, height * ratio);
  // Equivalent to min(1, 24 / shortest) of the shortest edge.
  return { min: Math.min(24, shortest) / width, max: shortest / width };
}

function limit(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function centeredCrop(dimensions: Dimensions, ratio = 1): Crop {
  const { max: size } = cropBounds(dimensions, ratio);
  return {
    left: (1 - size) / 2,
    top: (1 - size * dimensions.width / dimensions.height / ratio) / 2,
    size,
  };
}

/** Non-finite sizes use the maximum crop; non-finite offsets are centered. */
export function clampCrop(crop: Crop, dimensions: Dimensions, ratio = 1): Crop {
  const { min, max } = cropBounds(dimensions, ratio);
  const size = Number.isFinite(crop.size) ? limit(crop.size, min, max) : max;
  const maxLeft = Math.max(0, 1 - size);
  const maxTop = Math.max(0, 1 - size * dimensions.width / dimensions.height / ratio);
  return {
    left: Number.isFinite(crop.left) ? limit(crop.left, 0, maxLeft) : maxLeft / 2,
    top: Number.isFinite(crop.top) ? limit(crop.top, 0, maxTop) : maxTop / 2,
    size,
  };
}

/** newSize is width-normalized. Preserve the center unless an image edge prevents it. */
export function resizeCrop(crop: Crop, newSize: number, dimensions: Dimensions, ratio = 1): Crop {
  const current = clampCrop(crop, dimensions, ratio);
  const { size } = clampCrop({ ...current, size: newSize }, dimensions, ratio);
  const delta = (current.size - size) / 2;
  return clampCrop({
    left: current.left + delta,
    top: current.top + delta * dimensions.width / dimensions.height / ratio,
    size,
  }, dimensions, ratio);
}
