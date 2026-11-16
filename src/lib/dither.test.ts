import { describe, expect, it } from 'vitest';
import { diffusionDither } from './dither';

const dark = [12, 24, 48] as const;
const light = [220, 250, 128] as const;

function image(width: number, pixels: number[][]) {
  return { width, height: pixels.length / width, data: new Uint8ClampedArray(pixels.flatMap(rgb => [...rgb, 255])) };
}

function inks(input: ReturnType<typeof image>) {
  const output = [];
  for (let i = 0; i < input.data.length; i += 4) output.push(Array.from(input.data.slice(i, i + 3)));
  return output;
}

const gray = (value: number) => [value, value, value];

describe('diffusionDither', () => {
  it('maps black and white exactly to the inks and preserves alpha', () => {
    const input = image(2, [gray(0), gray(255), gray(255), gray(0)]);
    diffusionDither(input, dark, light);
    expect(inks(input)).toEqual([dark, light, light, dark]);
    expect(Array.from(input.data).filter((_, i) => i % 4 === 3)).toEqual([255, 255, 255, 255]);
  });

  it('converts RGB to weighted grayscale before quantizing', () => {
    for (const [rgb, expected] of [
      [[255, 0, 0], dark], [[0, 255, 0], light], [[0, 0, 255], dark],
    ] as const) {
      const input = image(1, [[...rgb]]);
      diffusionDither(input, dark, light);
      expect(inks(input)).toEqual([expected]);
    }
  });

  it('uses the print grayscale curve rather than gamma-encoded RGB coverage', () => {
    // Reference-calibrated tonal anchors: sRGB #808080 covers about 42%, not 50%.
    for (const [rgb, expected] of [
      [gray(64), 0.1831], [gray(128), 0.4164], [gray(192), 0.6936],
      [[255, 0, 0], 0.4128], [[0, 255, 0], 0.8257], [[0, 0, 255], 0.2227],
    ] as const) {
      const input = image(128, Array.from({ length: 128 * 128 }, () => [...rgb]));
      diffusionDither(input, dark, light);
      const coverage = inks(input).filter(rgb => rgb[0] === light[0]).length / (128 * 128);
      expect(Math.abs(coverage - expected)).toBeLessThan(0.01);
    }
  });

  it('diffuses error rather than independently thresholding each pixel', () => {
    const input = image(2, Array.from({ length: 4 }, () => gray(128)));
    diffusionDither(input, dark, light);
    expect(inks(input)).toEqual([dark, light, dark, light]);
  });

  it('discards horizontal edge errors instead of wrapping them into another row', () => {
    const input = image(1, [gray(128), gray(128), gray(128)]);
    diffusionDither(input, dark, light);
    expect(inks(input)).toEqual([dark, light, dark]);
    const row = image(3, [gray(128), gray(128), gray(128)]);
    diffusionDither(row, dark, light);
    expect(inks(row)).toEqual([dark, light, dark]);
  });

  it('is deterministic, uses only two inks, and preserves the print-gray coverage', () => {
    for (const [tone, expectedCoverage] of [[32, 0.0888], [64, 0.1831], [128, 0.4164], [192, 0.6936], [224, 0.8454]]) {
      const pixels = Array.from({ length: 128 * 128 }, () => gray(tone));
      const first = image(128, pixels);
      const second = image(128, pixels);
      diffusionDither(first, dark, light);
      diffusionDither(second, dark, light);
      expect(first.data).toEqual(second.data);
      let whites = 0;
      for (const rgb of inks(first)) {
        if (rgb[0] === light[0]) {
          expect(rgb).toEqual(light);
          whites++;
        } else {
          expect(rgb).toEqual(dark);
        }
      }
      expect(Math.abs(whites / pixels.length - expectedCoverage)).toBeLessThan(0.01);
    }
  });
});
