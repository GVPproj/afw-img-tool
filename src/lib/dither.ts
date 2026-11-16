type RGB = readonly [number, number, number];

const linearSRGB = Float64Array.from({ length: 256 }, (_, byte) => {
  const value = byte / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
});
// Empirical print-gray approximation calibrated against the supplied Photoshop
// bitmap reference. This is not an emulation of Photoshop's ICC gray profiles.
const PRINT_GRAY_GAMMA = 1.75;

/** Print grayscale → two inks using Floyd–Steinberg diffusion, in final output pixels.
 * Input must already be flattened and resized; alpha is preserved.
 */
export function diffusionDither(image: Pick<ImageData, 'data' | 'width' | 'height'>, dark: RGB, light: RGB) {
  const { data, width, height } = image;
  // Padding discards errors outside the image without wrapping across edges.
  let current = new Float64Array(width + 2);
  let next = new Float64Array(width + 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // Mix light, not gamma-encoded RGB bytes, then encode the print gray tone.
      const luminance = 0.2126 * linearSRGB[data[i]] + 0.7152 * linearSRGB[data[i + 1]] + 0.0722 * linearSRGB[data[i + 2]];
      const gray = 255 * luminance ** (1 / PRINT_GRAY_GAMMA);
      const value = gray + current[x + 1];
      const white = value >= 127.5;
      const ink = white ? light : dark;
      data[i] = ink[0];
      data[i + 1] = ink[1];
      data[i + 2] = ink[2];
      const error = value - (white ? 255 : 0);
      current[x + 2] += error * 7 / 16;
      next[x] += error * 3 / 16;
      next[x + 1] += error * 5 / 16;
      next[x + 2] += error / 16;
    }
    [current, next] = [next, current];
    next.fill(0);
  }
}
