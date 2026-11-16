import { describe, expect, it } from 'vitest';
import { centeredCrop, clampCrop, resizeCrop, type Crop, type Dimensions } from './crop';

function expectCrop(actual: Crop, expected: Crop) {
  expect(actual.left).toBeCloseTo(expected.left);
  expect(actual.top).toBeCloseTo(expected.top);
  expect(actual.size).toBeCloseTo(expected.size);
}

describe('centeredCrop', () => {
  it.each([
    [{ width: 1200, height: 800 }, { left: 1 / 6, top: 0, size: 2 / 3 }],
    [{ width: 800, height: 1200 }, { left: 0, top: 1 / 6, size: 1 }],
    [{ width: 800, height: 800 }, { left: 0, top: 0, size: 1 }],
    [{ width: 1, height: 4 }, { left: 0, top: 0.375, size: 1 }],
  ])('centers a maximum square in %j', (dimensions, expected) => {
    expectCrop(centeredCrop(dimensions), expected);
  });
});

describe('portrait crop', () => {
  const dimensions = { width: 1200, height: 800 };
  const ratio = 4 / 5;

  it('centers the maximum 4:5 rectangle', () => {
    expectCrop(centeredCrop(dimensions, ratio), { left: 7 / 30, top: 0, size: 8 / 15 });
  });

  it('clamps and resizes using the portrait height', () => {
    const crop = clampCrop({ left: 1, top: 1, size: 0.4 }, dimensions, ratio);
    expectCrop(crop, { left: 0.6, top: 0.25, size: 0.4 });
    const resized = resizeCrop(crop, 0.2, dimensions, ratio);
    expect(resized.left + resized.size / 2).toBeCloseTo(crop.left + crop.size / 2);
    expect(resized.top + resized.size * dimensions.width / dimensions.height / ratio / 2)
      .toBeCloseTo(crop.top + crop.size * dimensions.width / dimensions.height / ratio / 2);
  });
});

describe('clampCrop', () => {
  it('clamps position using the physical square height, not the width fraction', () => {
    expectCrop(clampCrop({ left: -2, top: 3, size: 0.5 }, { width: 1000, height: 800 }), {
      left: 0, top: 0.375, size: 0.5,
    });
  });

  it.each([
    [{ width: 1200, height: 800 }, 24 / 1200],
    [{ width: 800, height: 1200 }, 24 / 800],
    [{ width: 10, height: 5 }, 0.5],
  ])('has a 24-pixel minimum, limited by the short edge in %j', (dimensions, size) => {
    expectCrop(clampCrop({ left: 0, top: 0, size: -1 }, dimensions), { left: 0, top: 0, size });
  });

  it('limits oversized crops to the shortest edge', () => {
    expectCrop(clampCrop({ left: 1, top: 1, size: 100 }, { width: 1200, height: 800 }), {
      left: 1 / 3, top: 0, size: 2 / 3,
    });
  });

  it('uses safe defaults for non-finite values', () => {
    const dimensions = { width: 1200, height: 800 };
    expectCrop(clampCrop({ left: NaN, top: Infinity, size: NaN }, dimensions), centeredCrop(dimensions));
  });

  it('does not mutate a valid crop', () => {
    const crop = Object.freeze({ left: 0.1, top: 0.2, size: 0.3 });
    expect(clampCrop(crop, { width: 800, height: 1200 })).toEqual(crop);
  });

  it('is idempotent and stays inside both dimensions for extreme aspect ratios', () => {
    for (const dimensions of [{ width: 10000, height: 1 }, { width: 1, height: 10000 }]) {
      for (const size of [-1, 0, 0.1, 1, 100, Infinity]) {
        const crop = clampCrop({ left: 10, top: -1, size }, dimensions);
        expect(clampCrop(crop, dimensions)).toEqual(crop);
        expect(crop.left).toBeGreaterThanOrEqual(0);
        expect(crop.top).toBeGreaterThanOrEqual(0);
        expect(crop.left + crop.size).toBeLessThanOrEqual(1);
        expect(crop.top + crop.size * dimensions.width / dimensions.height).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('resizeCrop', () => {
  it.each<Dimensions>([{ width: 1000, height: 800 }, { width: 800, height: 1000 }])(
    'preserves both center coordinates in %j', (dimensions) => {
      const crop = { left: 0.2, top: 0.2, size: 0.4 };
      const resized = resizeCrop(crop, 0.2, dimensions);
      expect(resized.left + resized.size / 2).toBeCloseTo(crop.left + crop.size / 2);
      expect(resized.top + resized.size * dimensions.width / dimensions.height / 2)
        .toBeCloseTo(crop.top + crop.size * dimensions.width / dimensions.height / 2);
    },
  );

  it('shifts only as necessary when growing against an edge', () => {
    expectCrop(resizeCrop({ left: 0, top: 0.6, size: 0.2 }, 0.6, { width: 1000, height: 1000 }), {
      left: 0, top: 0.4, size: 0.6,
    });
  });

  it('clamps the new size before calculating the center', () => {
    expectCrop(resizeCrop({ left: 0.2, top: 0.2, size: 0.4 }, -10, { width: 1000, height: 1000 }), {
      left: 0.388, top: 0.388, size: 0.024,
    });
    expectCrop(resizeCrop({ left: 0.2, top: 0.2, size: 0.4 }, 10, { width: 1000, height: 1000 }), {
      left: 0, top: 0, size: 1,
    });
  });
});

it.each([0, -1, NaN, Infinity])('rejects invalid dimensions: %s', (invalid) => {
  for (const dimensions of [{ width: invalid, height: 100 }, { width: 100, height: invalid }]) {
    expect(() => centeredCrop(dimensions)).toThrow(RangeError);
    expect(() => clampCrop({ left: 0, top: 0, size: 1 }, dimensions)).toThrow(RangeError);
    expect(() => resizeCrop({ left: 0, top: 0, size: 1 }, 0.5, dimensions)).toThrow(RangeError);
  }
});
