import { expect, test, type Page } from '@playwright/test'

async function tonalPhoto(page: Page, background?: string) {
  const base64 = await page.evaluate(background => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1080
    const context = canvas.getContext('2d')!
    // Neutral endpoints plus a midtone make tint and retained grain observable.
    for (const [index, color] of ['#000000', '#808080', '#ffffff'].entries()) {
      context.fillStyle = color
      context.fillRect(index * 360, 0, 360, 1080)
    }
    // Keep artwork checks separate from highlight-colored photo marks.
    context.fillStyle = background ?? '#000'
    context.fillRect(0, background ? 0 : 500, 1080, 1080)
    return canvas.toDataURL().split(',')[1]
  }, background)
  return { name: 'tones.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') }
}

async function ready(page: Page, previous?: string) {
  const download = page.getByRole('link', { name: 'Download PNG' })
  await expect(download).toBeVisible()
  if (previous) await expect(download).not.toHaveAttribute('href', previous)
  return (await download.getAttribute('href'))!
}

async function downloadPng(page: Page) {
  const pending = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download PNG' }).click()
  const download = await pending
  expect(download.suggestedFilename()).toBe('tones_thumb.png')
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  const png = Buffer.concat(chunks)
  const preview = await page.locator('.result-image').evaluate(async (image: HTMLImageElement) => {
    const blob = await (await fetch(image.src)).blob()
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(',')[1])
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
  })
  expect(png.equals(Buffer.from(preview, 'base64')), 'download must match the preview').toBe(true)
  return png
}

async function inspectTint(page: Page, png: Buffer) {
  return page.evaluate(async base64 => {
    const image = new Image()
    image.src = `data:image/png;base64,${base64}`
    await image.decode()
    const canvas = document.createElement('canvas')
    // Artwork and endpoint samples use the unchanged 1080-wide design space.
    canvas.width = 1080
    canvas.height = Math.round(image.naturalHeight * 1080 / image.naturalWidth)
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const pixel = (x: number) => Array.from(context.getImageData(x, 400, 1, 1).data)
    // Inspect the full-density texture without adding analysis resampling.
    const native = document.createElement('canvas')
    native.width = image.naturalWidth
    native.height = image.naturalHeight
    const nativeContext = native.getContext('2d')!
    nativeContext.drawImage(image, 0, 0)
    const scale = image.naturalWidth / 1080
    const midtones = nativeContext.getImageData(Math.round(480 * scale), Math.round(400 * scale), 100, 100).data
    const reds = new Set<number>()
    let neutralMidtones = true
    for (let i = 0; i < midtones.length; i += 4) {
      reds.add(midtones[i])
      if (midtones[i] !== midtones[i + 1] || midtones[i] !== midtones[i + 2]) neutralMidtones = false
    }
    // The 3.2-design-pixel screen now repeats roughly 5px across and 2px down.
    let sumA = 0, sumB = 0, sumAA = 0, sumBB = 0, sumAB = 0, samples = 0
    for (let y = 0; y < 98; y++) for (let x = 0; x < 95; x++) {
      const a = midtones[(y * 100 + x) * 4]
      const b = midtones[((y + 2) * 100 + x + 5) * 4]
      sumA += a; sumB += b; sumAA += a * a; sumBB += b * b; sumAB += a * b; samples++
    }
    const screenCorrelation = (samples * sumAB - sumA * sumB)
      / Math.sqrt((samples * sumAA - sumA ** 2) * (samples * sumBB - sumB ** 2))
    // The most common non-background color in the title is solid artwork ink.
    const title = context.getImageData(0, 0, 350, 50).data
    const frequencies = new Map<string, number>()
    for (let i = 0; i < title.length; i += 4) {
      const rgb = Array.from(title.slice(i, i + 3))
      // Without duotone the title sits on black, not navy. Neither is ink.
      if (rgb.every(value => value === 0)
        || rgb.every((value, index) => value === [0, 26, 114][index])) continue
      const key = rgb.join(',')
      frequencies.set(key, (frequencies.get(key) ?? 0) + 1)
    }
    const artwork = [...frequencies].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number)
    const countInk = (x: number, y: number, w: number, h: number) => {
      const { data } = context.getImageData(x, y, w, h)
      let count = 0
      for (let i = 0; i < data.length; i += 4) {
        if (artwork.every((channel, index) => data[i + index] === channel)) count++
      }
      return count
    }
    // Compare every pixel in an artwork-free strip, including all three tones.
    // This catches photo changes that a handful of endpoint samples would miss.
    const photo = document.createElement('canvas')
    photo.width = canvas.width
    photo.height = 180
    photo.getContext('2d')!.drawImage(canvas, 0, 300, canvas.width, 180, 0, 0, canvas.width, 180)
    return {
      width: image.naturalWidth, height: image.naturalHeight, artwork,
      photoPixels: photo.toDataURL(), neutralMidtones,
      shadow: pixel(100), highlight: pixel(900), grainLevels: reds.size,
      midtoneRange: [Math.min(...reds), Math.max(...reds)], screenCorrelation,
      textInk: countInk(0, 0, 350, 200),
      chirInk: countInk(0, canvas.height - 200, 300, 200),
      // The black footer cannot be mistaken for artwork ink.
      afwInk: countInk(630, canvas.height - 150, 80, 150),
    }
  }, png.toString('base64'))
}

const colorCases = [
  { color: 'Copper', highlight: [224, 108, 58], format: 'Square', height: 1728 },
  { color: 'Berry', highlight: [179, 68, 121], format: '4:5', height: 2160 },
  { color: 'Lime', highlight: [226, 255, 120], format: '4:5', height: 2160 },
]

for (const { color, highlight, format, height } of colorCases) {
test(`CHIR ${color} duotone maps photo tones and matches text and both logos in preview/download`, async ({ page }) => {
  await page.goto('/')
  const colors = page.getByRole('group', { name: 'Color', exact: true })
  const duotone = page.getByRole('radio', { name: 'Duotone', exact: true })
  await expect(colors.getByRole('radio', { name: 'Lime', exact: true })).toBeChecked()
  await expect(duotone).not.toBeChecked()
  await page.getByRole('checkbox', { name: 'Corner gradient', exact: true }).uncheck()
  await page.getByRole('radio', { name: format, exact: true }).check()
  await colors.getByRole('radio', { name: color, exact: true }).check()
  await page.getByLabel('Photo file').setInputFiles(await tonalPhoto(page))
  let url = await ready(page)
  const original = await downloadPng(page)
  const untreated = await inspectTint(page, original)
  expect(untreated.artwork).toEqual(highlight)
  expect(untreated.shadow).toEqual([0, 0, 0, 255])
  expect(untreated.highlight).toEqual([255, 255, 255, 255])
  await duotone.check()
  url = await ready(page, url)
  const treated = await downloadPng(page)
  const pixels = await inspectTint(page, treated)
  expect(pixels).toMatchObject({ width: 1728, height, shadow: [0, 26, 114, 255], highlight: [...highlight, 255] })
  // Screened midtones have a repeating print structure, not just random grain.
  expect(pixels.screenCorrelation).toBeGreaterThan(0.15)
  // Keep the print texture subtle rather than splitting midtones into two inks.
  expect(pixels.midtoneRange[1] - pixels.midtoneRange[0]).toBeLessThan(highlight[0] * 0.6)
  expect(pixels.grainLevels).toBeGreaterThan(10)
  expect(pixels.artwork).toEqual(highlight)
  expect(pixels.textInk).toBeGreaterThan(500)
  expect(pixels.chirInk).toBeGreaterThan(5000)
  expect(pixels.afwInk).toBeGreaterThan(1000)
  expect(pixels.photoPixels).not.toBe(untreated.photoPixels)

  await page.getByRole('radio', { name: 'Normal', exact: true }).check()
  url = await ready(page, url)
  await expect(colors.getByRole('radio', { name: color, exact: true })).toBeChecked()
  expect((await downloadPng(page)).equals(original), 'duotone off restores the photo without resetting artwork color').toBe(true)
  await duotone.check()
  await ready(page, url)
  expect((await downloadPng(page)).equals(treated), 'duotone on restores the exact screened treatment').toBe(true)
})
}

for (const format of ['Square', '4:5']) {
test(`${format}: all colors recolor text and both logos without changing photo pixels when duotone is off`, async ({ page }) => {
  await page.goto('/')
  const colors = page.getByRole('group', { name: 'Color', exact: true })
  const duotone = page.getByRole('radio', { name: 'Duotone', exact: true })
  const gradient = page.getByRole('checkbox', { name: 'Corner gradient', exact: true })
  await expect(colors.getByRole('radio')).toHaveCount(6)
  await expect(page.getByRole('radio', { name: 'None', exact: true })).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Tint', exact: true })).toHaveCount(0)
  await expect(colors.getByRole('radio', { name: 'Lime', exact: true })).toBeChecked()
  await expect(duotone).not.toBeChecked()
  await expect(gradient).not.toBeChecked()
  await expect(gradient).toBeEnabled()
  await page.getByRole('radio', { name: format, exact: true }).check()
  await page.getByLabel('Photo file').setInputFiles(await tonalPhoto(page))
  let url = await ready(page)
  const original = await downloadPng(page)
  const baseline = await inspectTint(page, original)
  expect(baseline.artwork).toEqual([226, 255, 120])

  for (const { color, highlight } of colorCases) {
    await colors.getByRole('radio', { name: color, exact: true }).check()
    url = await ready(page, url)
    await expect(duotone).not.toBeChecked()
    await expect(gradient).toBeEnabled()
    await expect(gradient).not.toBeChecked()
    const pixels = await inspectTint(page, await downloadPng(page))
    expect(pixels).toMatchObject({
      width: 1728, height: format === 'Square' ? 1728 : 2160,
      shadow: [0, 0, 0, 255], highlight: [255, 255, 255, 255],
      artwork: highlight, neutralMidtones: true,
    })
    expect(pixels.photoPixels === baseline.photoPixels, `${color} must leave the entire photo strip unchanged`).toBe(true)
    expect(pixels.grainLevels, 'the existing neutral grain is retained').toBeGreaterThan(10)
    expect(pixels.textInk).toBeGreaterThan(500)
    expect(pixels.chirInk).toBeGreaterThan(5000)
    expect(pixels.afwInk).toBeGreaterThan(1000)
  }
  expect((await downloadPng(page)).equals(original), 'returning to Lime restores every pixel').toBe(true)
})
}

test('color and duotone are independently keyboard selectable', async ({ page }) => {
  await page.goto('/')
  const colors = page.getByRole('group', { name: 'Color', exact: true })
  const duotone = page.getByRole('radio', { name: 'Duotone', exact: true })
  const gradient = page.getByRole('checkbox', { name: 'Corner gradient', exact: true })
  await gradient.uncheck()
  await page.getByLabel('Photo file').setInputFiles(await tonalPhoto(page))
  let url = await ready(page)
  const original = await downloadPng(page)
  const baseline = await inspectTint(page, original)
  await colors.getByRole('radio', { name: 'Lime', exact: true }).focus()
  // Native radio navigation wraps and skips no hidden "None" option.
  await page.keyboard.press('ArrowRight')
  await expect(colors.getByRole('radio', { name: 'Copper', exact: true })).toBeChecked()
  url = await ready(page, url)
  const copper = await downloadPng(page)
  const pixels = await inspectTint(page, copper)
  expect(pixels.artwork).toEqual([224, 108, 58])
  expect(pixels.photoPixels).toBe(baseline.photoPixels)
  await expect(duotone).not.toBeChecked()
  await expect(gradient).toBeEnabled()

  // Downloading moves focus to the link; resume navigation on the radio.
  await colors.getByRole('radio', { name: 'Copper', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(colors.getByRole('radio', { name: 'Berry', exact: true })).toBeChecked()
  await page.keyboard.press('ArrowLeft')
  await expect(colors.getByRole('radio', { name: 'Copper', exact: true })).toBeChecked()
  await duotone.focus()
  await page.keyboard.press('Space')
  await expect(duotone).toBeChecked()
  await expect(gradient).toBeEnabled()
  url = await ready(page, url)
  const treated = await inspectTint(page, await downloadPng(page))
  expect(treated.artwork).toEqual([224, 108, 58])
  expect(treated.shadow).toEqual([0, 26, 114, 255])
  expect(treated.highlight).toEqual([224, 108, 58, 255])
  await page.getByRole('radio', { name: 'Normal', exact: true }).focus()
  await page.keyboard.press('Space')
  await expect(page.getByRole('radio', { name: 'Normal', exact: true })).toBeChecked()
  await expect(duotone).not.toBeChecked()
  await expect(gradient).toBeEnabled()
  await ready(page, url)
  await expect(colors.getByRole('radio', { name: 'Copper', exact: true })).toBeChecked()
  expect((await downloadPng(page)).equals(copper), 'selecting Normal clears duotone, not the selected color').toBe(true)
  await page.setViewportSize({ width: 320, height: 800 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

for (const { color, highlight } of colorCases) {
for (const duotone of [false, true]) {
test(`${color} keeps canonical text and logo colors on dark and bright photos with duotone ${duotone ? 'on' : 'off'}`, async ({ page }) => {
  await page.goto('/')
  await page.getByRole('radio', { name: color, exact: true }).check()
  await page.getByRole('radio', { name: duotone ? 'Duotone' : 'Normal', exact: true }).check()
  await page.getByLabel('Photo file').setInputFiles(await tonalPhoto(page, '#000000'))
  let url = await ready(page)
  const dark = await downloadPng(page)
  await page.getByLabel('Photo file').setInputFiles(await tonalPhoto(page, '#aaaaaa'))
  url = await ready(page, url)
  const bright = await downloadPng(page)
  const inks = await page.evaluate(async ({ dark, bright, highlight }) => {
    async function pixels(base64: string) {
      const image = new Image()
      image.src = `data:image/png;base64,${base64}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1080
      const context = canvas.getContext('2d')!
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      return context.getImageData(0, 0, 1080, 1080).data
    }
    const before = await pixels(dark)
    const after = await pixels(bright)
    return [[0, 0, 350, 50], [0, 880, 300, 200], [630, 930, 80, 150]].map(([left, top, width, height]) => {
      for (let y = top + 1; y < top + height - 1; y++) for (let x = left + 1; x < left + width - 1; x++) {
        // Require a solid 3x3 interior, not a resampled edge that rounded to ink.
        const solid = [-1, 0, 1].every(dy => [-1, 0, 1].every(dx =>
          highlight.every((channel, index) => before[((y + dy) * 1080 + x + dx) * 4 + index] === channel)))
        if (solid) {
          const i = (y * 1080 + x) * 4
          return Array.from(after.slice(i, i + 3))
        }
      }
      return []
    })
  }, { dark: dark.toString('base64'), bright: bright.toString('base64'), highlight })
  expect(inks[0]).toEqual(highlight)
  expect(inks[1]).toEqual(inks[0])
  expect(inks[2]).toEqual(inks[0])
  await page.getByLabel('Photo file').setInputFiles(await tonalPhoto(page, '#000000'))
  await ready(page, url)
  expect((await downloadPng(page)).equals(dark), 'photo changes must not mutate the cached artwork').toBe(true)
})
}
}

for (const format of ['Square', '4:5']) {
test(`${format} duotone corners gently darken while the central photo stays untouched`, async ({ page }) => {
  await page.goto('/')
  await page.getByRole('radio', { name: format, exact: true }).check()
  await page.getByRole('radio', { name: 'Copper', exact: true }).check()
  const gradient = page.getByRole('checkbox', { name: 'Corner gradient', exact: true })
  await expect(gradient).not.toBeChecked()
  await gradient.check()
  await expect(gradient).toBeEnabled()
  await page.getByRole('radio', { name: 'Duotone', exact: true }).check()
  await expect(gradient).toBeEnabled()
  await page.getByLabel('Photo file').setInputFiles(await tonalPhoto(page, '#ffffff'))
  let url = await ready(page)
  const png = await downloadPng(page)
  await gradient.focus()
  await page.keyboard.press('Space')
  await expect(gradient).not.toBeChecked()
  url = await ready(page, url)
  const unshaded = await downloadPng(page)
  expect(unshaded.equals(png)).toBe(false)
  const pixels = await page.evaluate(async ({ shaded, unshaded }) => {
    const image = new Image()
    image.src = `data:image/png;base64,${shaded}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = 1080
    canvas.height = Math.round(image.naturalHeight * 1080 / image.naturalWidth)
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const { width, height } = canvas
    const sample = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data)
    // Sample background only, outside the text and opaque logo shapes.
    const points = [[4, 4], [width - 4, 4], [4, height - 4], [width - 4, height - 240]]
    const corners = points.map(([x, y]) => sample(x, y))
    const center = context.getImageData(width / 2 - 100, height / 2 - 50, 200, 100).data
    const centerColors = new Set<string>()
    for (let i = 0; i < center.length; i += 4) centerColors.add(Array.from(center.slice(i, i + 4)).join(','))
    const topMiddle = sample(width / 2, 4)
    const unshadedImage = new Image()
    unshadedImage.src = `data:image/png;base64,${unshaded}`
    await unshadedImage.decode()
    context.drawImage(unshadedImage, 0, 0, canvas.width, canvas.height)
    const unshadedCorners = points.map(([x, y]) => sample(x, y))
    const unshadedCenter = context.getImageData(width / 2 - 100, height / 2 - 50, 200, 100).data
    return { corners, centerColors: [...centerColors], topMiddle, unshadedCorners,
      centerChanged: center.some((value, index) => value !== unshadedCenter[index]) }
  }, { shaded: png.toString('base64'), unshaded: unshaded.toString('base64') })
  expect(pixels.centerColors, 'the central subject must not receive the corner fade').toEqual(['224,108,58,255'])
  for (const corner of pixels.corners) {
    expect(corner[0]).toBeLessThan(224 * 0.98)
    expect(corner[0]).toBeGreaterThanOrEqual(224 * 0.45)
    expect(corner[3]).toBe(255)
  }
  expect(pixels.corners[0][0]).toBeLessThanOrEqual(224 * 0.55)
  expect(pixels.topMiddle[0]).toBeGreaterThan(pixels.corners[0][0])
  // Shading must reach behind the text across the top, not just the extreme corners.
  expect(pixels.topMiddle[0]).toBeLessThan(224 * 0.7)
  expect(pixels.centerChanged).toBe(false)
  for (const corner of pixels.unshadedCorners) expect(corner).toEqual([224, 108, 58, 255])
  await gradient.check()
  await ready(page, url)
  expect((await downloadPng(page)).equals(png), 're-enabling restores the exact shaded image').toBe(true)
})
}

test('color, duotone, and gradient choices are available and preserved across stations', async ({ page }) => {
  await page.goto('/')
  const colors = page.getByRole('group', { name: 'Color', exact: true })
  const duotone = page.getByRole('radio', { name: 'Duotone', exact: true })
  const gradient = page.getByRole('checkbox', { name: 'Corner gradient', exact: true })
  await expect(gradient).not.toBeChecked()
  for (const station of ['Island City', 'Sunday', 'CHIR FM']) {
    await page.getByRole('radio', { name: station, exact: true }).check()
    await expect(gradient).not.toBeChecked()
  }
  await gradient.check()
  await expect(gradient).toBeEnabled()
  await page.getByLabel('Photo file').setInputFiles(await tonalPhoto(page))
  let url = await ready(page)
  const original = await downloadPng(page)
  await page.getByRole('radio', { name: 'Island City', exact: true }).check()
  url = await ready(page, url)
  const island = await downloadPng(page)
  await expect(colors).toBeVisible()
  await expect(duotone).not.toBeChecked()
  await expect(gradient).toBeChecked()
  await expect(gradient).toBeEnabled()
  await page.getByRole('radio', { name: 'CHIR FM', exact: true }).check()
  url = await ready(page, url)
  await expect(colors.getByRole('radio', { name: 'Lime', exact: true })).toBeChecked()
  await expect(duotone).not.toBeChecked()
  await expect(gradient).toBeChecked()
  await expect(gradient).toBeEnabled()
  expect((await downloadPng(page)).equals(original)).toBe(true)

  async function roundTrip(expected: Buffer) {
    await page.getByRole('radio', { name: 'Island City', exact: true }).check()
    url = await ready(page, url)
    await expect(colors).toBeVisible()
    await expect(colors.getByRole('radio', { name: 'Copper', exact: true })).toBeChecked()
    await expect(duotone).toBeVisible()
    await expect(gradient).toBeVisible()
    expect((await downloadPng(page)).equals(island), 'shared color settings also update Island City').toBe(false)
    await page.getByRole('radio', { name: 'CHIR FM', exact: true }).check()
    url = await ready(page, url)
    await expect(colors.getByRole('radio', { name: 'Copper', exact: true })).toBeChecked()
    expect((await downloadPng(page)).equals(expected), 'returning to CHIR restores the exact image').toBe(true)
  }

  await colors.getByRole('radio', { name: 'Copper', exact: true }).check()
  url = await ready(page, url)
  const shadedOriginal = await downloadPng(page)
  await gradient.uncheck()
  url = await ready(page, url)
  const untreated = await downloadPng(page)
  expect(untreated.equals(shadedOriginal), 'gradient changes pixels without duotone').toBe(false)
  await duotone.check()
  url = await ready(page, url)
  const unshaded = await downloadPng(page)
  await colors.getByRole('radio', { name: 'Berry', exact: true }).check()
  url = await ready(page, url)
  await expect(duotone).toBeChecked()
  await expect(gradient).not.toBeChecked()
  const berry = await inspectTint(page, await downloadPng(page))
  expect(berry.artwork).toEqual([179, 68, 121])
  expect(berry.highlight).toEqual([179, 68, 121, 255])
  await colors.getByRole('radio', { name: 'Copper', exact: true }).check()
  url = await ready(page, url)
  expect((await downloadPng(page)).equals(unshaded), 'color changes preserve duotone and gradient settings').toBe(true)
  await roundTrip(unshaded)
  await expect(duotone).toBeChecked()
  await expect(gradient).toBeEnabled()
  await expect(gradient).not.toBeChecked()

  await page.getByRole('radio', { name: 'Normal', exact: true }).check()
  url = await ready(page, url)
  await expect(gradient).toBeEnabled()
  await expect(gradient).not.toBeChecked()
  expect((await downloadPng(page)).equals(untreated), 'disabling both effects restores untreated pixels').toBe(true)
  await roundTrip(untreated)
  await expect(duotone).not.toBeChecked()
  await expect(gradient).toBeEnabled()
  await expect(gradient).not.toBeChecked()

  await duotone.check()
  url = await ready(page, url)
  expect((await downloadPng(page)).equals(unshaded)).toBe(true)
  await gradient.check()
  url = await ready(page, url)
  const shaded = await downloadPng(page)
  expect(shaded.equals(unshaded)).toBe(false)
  await roundTrip(shaded)
  await expect(duotone).toBeChecked()
  await expect(gradient).toBeEnabled()
  await expect(gradient).toBeChecked()

  await page.getByRole('radio', { name: 'Normal', exact: true }).check()
  url = await ready(page, url)
  await expect(gradient).toBeEnabled()
  await expect(gradient).toBeChecked()
  expect((await downloadPng(page)).equals(shadedOriginal), 'gradient restores shaded pixels without duotone').toBe(true)
  await gradient.uncheck()
  url = await ready(page, url)
  expect((await downloadPng(page)).equals(untreated), 'gradient off restores untreated pixels without duotone').toBe(true)
  await gradient.check()
  url = await ready(page, url)
  expect((await downloadPng(page)).equals(shadedOriginal)).toBe(true)
  await colors.getByRole('radio', { name: 'Lime', exact: true }).check()
  await ready(page, url)
  await expect(gradient).toBeChecked()
  await expect(gradient).toBeEnabled()
  expect((await downloadPng(page)).equals(original)).toBe(true)
})

test('rapid color, duotone, and gradient changes publish only the final state', async ({ page }) => {
  await page.goto('/')
  const colors = page.getByRole('group', { name: 'Color', exact: true })
  const duotone = page.getByRole('radio', { name: 'Duotone', exact: true })
  const gradient = page.getByRole('checkbox', { name: 'Corner gradient', exact: true })
  await colors.getByRole('radio', { name: 'Berry', exact: true }).check()
  await duotone.check()
  await gradient.uncheck()
  await page.getByLabel('Photo file').setInputFiles(await tonalPhoto(page))
  let url = await ready(page)
  const treated = await downloadPng(page)
  await page.getByRole('radio', { name: 'Normal', exact: true }).check()
  url = await ready(page, url)
  const untreated = await downloadPng(page)

  // Do not wait for intermediate renders: colors must not reset the effect or gradient.
  await colors.getByRole('radio', { name: 'Copper', exact: true }).check()
  await duotone.check()
  await gradient.check()
  await colors.getByRole('radio', { name: 'Lime', exact: true }).check()
  await page.getByRole('radio', { name: 'Normal', exact: true }).check()
  await colors.getByRole('radio', { name: 'Berry', exact: true }).check()
  await duotone.check()
  await gradient.uncheck()
  await gradient.check()
  await gradient.uncheck()
  url = await ready(page, url)
  await expect(colors.getByRole('radio', { name: 'Berry', exact: true })).toBeChecked()
  await expect(duotone).toBeChecked()
  await expect(gradient).not.toBeChecked()
  await expect(gradient).toBeEnabled()
  expect((await downloadPng(page)).equals(treated), 'only the final Berry duotone image is downloadable').toBe(true)

  await gradient.check()
  await colors.getByRole('radio', { name: 'Copper', exact: true }).check()
  await page.getByRole('radio', { name: 'Normal', exact: true }).check()
  await colors.getByRole('radio', { name: 'Lime', exact: true }).check()
  await duotone.check()
  await colors.getByRole('radio', { name: 'Berry', exact: true }).check()
  await gradient.uncheck()
  await page.getByRole('radio', { name: 'Normal', exact: true }).check()
  await ready(page, url)
  await expect(colors.getByRole('radio', { name: 'Berry', exact: true })).toBeChecked()
  await expect(duotone).not.toBeChecked()
  await expect(gradient).toBeEnabled()
  await expect(gradient).not.toBeChecked()
  expect((await downloadPng(page)).equals(untreated), 'a superseded duotone render must not replace the final untreated photo').toBe(true)
})
