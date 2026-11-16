import { expect, test, type Page } from '@playwright/test'

const navy = [0, 26, 114]
const themes = [
  { color: 'Lime', ink: [226, 255, 120], format: 'Square', height: 1728 },
  { color: 'Copper', ink: [224, 108, 58], format: '4:5', height: 2160 },
  { color: 'Berry', ink: [179, 68, 121], format: '4:5', height: 2160 },
]

const normalOption = (page: Page) => page.getByRole('radio', { name: 'Normal', exact: true })
const ditherToggle = (page: Page) => page.getByRole('radio', { name: 'Diffusion Dither', exact: true })
const duotoneToggle = (page: Page) => page.getByRole('radio', { name: 'Duotone', exact: true })
const gradientToggle = (page: Page) => page.getByRole('checkbox', { name: 'Corner gradient', exact: true })

async function tonalPhoto(page: Page, solid?: string) {
  const base64 = await page.evaluate(solid => {
    const canvas = document.createElement('canvas')
    // Neither export size is the source size: dithering before resizing would
    // interpolate extra colors, or enlarge the diffusion dots.
    canvas.width = canvas.height = 1440
    const context = canvas.getContext('2d')!
    context.fillStyle = solid ?? '#000000'
    context.fillRect(0, 0, 1440, 1440)
    if (!solid) {
      // This band crosses an artwork-free strip in both centered crops.
      // Black behind the title and footer isolates text/logo comparisons.
      for (const [index, color] of ['#000000', '#808080', '#ffffff'].entries()) {
        context.fillStyle = color
        context.fillRect(index * 480, 400, 480, 240)
      }
    }
    return canvas.toDataURL('image/png').split(',')[1]
  }, solid)
  return { name: 'dither-tones.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') }
}

async function ready(page: Page, previous?: string) {
  const download = page.getByRole('link', { name: 'Download PNG' })
  await expect(download).toBeVisible()
  if (previous) await expect(download).not.toHaveAttribute('href', previous)
  const url = (await download.getAttribute('href'))!
  await expect(page.locator('.result-image')).toHaveAttribute('src', url)
  return url
}

async function downloadPng(page: Page) {
  const pending = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download PNG' }).click()
  const download = await pending
  expect(download.suggestedFilename()).toBe('dither-tones_thumb.png')
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  const png = Buffer.concat(chunks)
  const preview = await page.locator('.result-image').evaluate(async (image: HTMLImageElement) => {
    await image.decode()
    const blob = await (await fetch(image.src)).blob()
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(',')[1])
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
  })
  expect(png.equals(Buffer.from(preview, 'base64')), 'download must match the displayed preview bytes').toBe(true)
  return png
}

async function inspectPhoto(page: Page, png: Buffer, ink: number[]) {
  return page.evaluate(async ({ base64, ink, navy }) => {
    const image = new Image()
    image.src = `data:image/png;base64,${base64}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')!
    // Never resample: binary inks and single-pixel diffusion must be inspected
    // at native output resolution, even though regions are specified logically.
    context.drawImage(image, 0, 0)
    const scale = image.naturalWidth / 1080
    const logicalHeight = image.naturalHeight / scale
    const physicalRect = (x: number, y: number, width: number, height: number) => {
      const left = Math.round(x * scale)
      const top = Math.round(y * scale)
      return [left, top, Math.round((x + width) * scale) - left, Math.round((y + height) * scale) - top] as const
    }
    const colors = (data: Uint8ClampedArray) => {
      const unique = new Set<string>()
      for (let i = 0; i < data.length; i += 4) unique.add(Array.from(data.slice(i, i + 4)).join(','))
      return [...unique].sort()
    }
    // Same normalized positions within the 1440-square fixture's centered crop.
    const patch = (x: number) => context.getImageData(...physicalRect(x, 400, 80, 60))
    const { data: midtones, width: patchWidth, height: patchHeight } = patch(490)
    const mask: number[] = []
    for (let i = 0; i < midtones.length; i += 4) {
      mask.push(ink.every((channel, index) => midtones[i + index] === channel) ? 1 : 0)
    }
    let transitions = 0
    for (let y = 0; y < patchHeight; y++) for (let x = 0; x < patchWidth - 1; x++) {
      if (mask[y * patchWidth + x] !== mask[y * patchWidth + x + 1]) transitions++
    }
    // Entire regions, including antialiased edges, not just opaque ink pixels.
    const artwork = [[0, 0, 350, 200], [0, logicalHeight - 200, 300, 200], [630, logicalHeight - 150, 80, 150]]
      .map(([left, top, w, h]) => {
        const [x, y, width, height] = physicalRect(left, top, w, h)
        const { data } = context.getImageData(x, y, width, height)
        let inkPixels = 0, edgePixels = 0
        for (let i = 0; i < data.length; i += 4) {
          const isInk = ink.every((channel, index) => data[i + index] === channel)
          const isNavy = navy.every((channel, index) => data[i + index] === channel)
          if (isInk) inkPixels++
          if (!isInk && !isNavy) edgePixels++
        }
        const region = document.createElement('canvas')
        region.width = width
        region.height = height
        region.getContext('2d')!.drawImage(image, x, y, width, height, 0, 0, width, height)
        return { pixels: region.toDataURL(), inkPixels, edgePixels }
      })
    return {
      width: canvas.width, height: canvas.height,
      shadow: colors(patch(100).data), highlight: colors(patch(900).data),
      // Include boundaries between the three tones, where resampling is most visible.
      photoColors: colors(context.getImageData(...physicalRect(0, 400, 1080, 60)).data),
      midtoneColors: colors(midtones), coverage: mask.reduce((sum, value) => sum + value, 0) / mask.length,
      transitions: transitions / ((patchWidth - 1) * patchHeight), mask: mask.join(''), artwork,
    }
  }, { base64: png.toString('base64'), ink, navy })
}

function expectTwoInks(pixels: Awaited<ReturnType<typeof inspectPhoto>>, ink: number[], height: number) {
  const palette = [[...navy, 255].join(','), [...ink, 255].join(',')].sort()
  expect(pixels).toMatchObject({ width: 1728, height })
  expect(pixels.shadow).toEqual([[...navy, 255].join(',')])
  expect(pixels.highlight).toEqual([[...ink, 255].join(',')])
  expect(pixels.photoColors, 'no grain or interpolated colors may remain in the photo').toEqual(palette)
  expect(pixels.midtoneColors, 'a flat midtone must diffuse into both inks, not threshold to one').toEqual(palette)
  // Print-gray conversion gives #808080 about 42% coverage (not the old 50%).
  // It remains independent of the selected colored inks.
  expect(pixels.coverage).toBeGreaterThan(0.40)
  expect(pixels.coverage).toBeLessThan(0.44)
  expect(pixels.transitions, 'diffusion dots must remain at final-pixel resolution').toBeGreaterThan(0.6)
}

for (const { color, ink, format, height } of themes) {
  test(`${format} ${color}: diffusion exports two photo inks and preserves text and both logos`, async ({ page }) => {
    await page.goto('/')
    const dither = ditherToggle(page)
    const duotone = duotoneToggle(page)
    await expect(normalOption(page)).toBeChecked()
    await expect(normalOption(page)).toBeEnabled()
    await expect(dither).not.toBeChecked()
    await expect(dither).toBeEnabled()
    await expect(duotone).not.toBeChecked()
    await expect(duotone).toBeEnabled()
    await gradientToggle(page).uncheck()
    await page.getByRole('radio', { name: format, exact: true }).check()
    await page.getByRole('radio', { name: color, exact: true }).check()
    await duotone.check()
    await page.getByLabel('Photo file').setInputFiles(await tonalPhoto(page))
    let url = await ready(page)
    const original = await downloadPng(page)
    const before = await inspectPhoto(page, original, ink)

    await dither.check()
    url = await ready(page, url)
    await expect(normalOption(page)).not.toBeChecked()
    await expect(duotone).toBeEnabled()
    await expect(duotone).not.toBeChecked()
    await expect(gradientToggle(page)).toBeEnabled()
    await expect(gradientToggle(page)).not.toBeChecked()
    const treated = await downloadPng(page)
    const pixels = await inspectPhoto(page, treated, ink)
    expectTwoInks(pixels, ink, height)
    expect(treated.equals(original), 'diffusion must differ from continuous duotone treatment').toBe(false)
    // Both treatments map the black artwork backdrop to navy. The complete
    // composited regions must therefore match, including smooth edge pixels.
    expect(pixels.artwork).toEqual(before.artwork)
    for (const [index, minimum] of [500, 5000, 1000].entries()) {
      expect(pixels.artwork[index].inkPixels).toBeGreaterThan(minimum * 1.6 ** 2)
      expect(pixels.artwork[index].edgePixels, 'artwork must not itself be quantized').toBeGreaterThan(0)
    }

    await duotone.check()
    url = await ready(page, url)
    await expect(dither).not.toBeChecked()
    await expect(duotone).toBeEnabled()
    await expect(duotone).toBeChecked()
    expect((await downloadPng(page)).equals(original), 'selecting Duotone restores its PNG byte-for-byte').toBe(true)
    await dither.check()
    await ready(page, url)
    expect((await downloadPng(page)).equals(treated), 'selecting Diffusion Dither restores the same result').toBe(true)
  })
}

test('Normal, Diffusion Dither, and Duotone are mutually exclusive without mutating previous outputs', async ({ page }) => {
  await page.goto('/')
  const dither = ditherToggle(page)
  const duotone = duotoneToggle(page)
  await expect(normalOption(page)).toBeChecked()
  await expect(dither).not.toBeChecked()
  await expect(duotone).not.toBeChecked()
  for (const option of [normalOption(page), dither, duotone]) await expect(option).toBeEnabled()
  await gradientToggle(page).uncheck()
  await page.getByLabel('Photo file').setInputFiles(await tonalPhoto(page))
  let url = await ready(page)
  const untreated = await downloadPng(page)
  await dither.check()
  url = await ready(page, url)
  await expect(normalOption(page)).not.toBeChecked()
  await expect(duotone).toBeEnabled()
  await expect(duotone).not.toBeChecked()
  const diffusion = await downloadPng(page)
  expect(diffusion.equals(untreated)).toBe(false)

  await normalOption(page).check()
  url = await ready(page, url)
  await expect(dither).not.toBeChecked()
  await expect(duotone).toBeEnabled()
  await expect(duotone).not.toBeChecked()
  expect((await downloadPng(page)).equals(untreated), 'Normal restores the original grayscale/grain bytes').toBe(true)
  await duotone.check()
  url = await ready(page, url)
  await expect(normalOption(page)).not.toBeChecked()
  await expect(dither).not.toBeChecked()
  const screened = await downloadPng(page)
  expect(screened.equals(untreated)).toBe(false)
  await dither.check()
  url = await ready(page, url)
  await expect(duotone).toBeEnabled()
  await expect(duotone).not.toBeChecked()
  expect((await downloadPng(page)).equals(diffusion), 'previously selecting Duotone must not affect diffusion pixels').toBe(true)
  await duotone.check()
  url = await ready(page, url)
  await expect(dither).not.toBeChecked()
  await expect(duotone).toBeEnabled()
  await expect(duotone).toBeChecked()
  expect((await downloadPng(page)).equals(screened)).toBe(true)
  await normalOption(page).check()
  await ready(page, url)
  expect((await downloadPng(page)).equals(untreated), 'neither effect may mutate the source or cached grain').toBe(true)
})

test('Space selects Diffusion Dither and ArrowUp selects Normal', async ({ page }) => {
  await page.goto('/')
  const dither = ditherToggle(page)
  const duotone = duotoneToggle(page)
  await gradientToggle(page).uncheck()
  await page.getByLabel('Photo file').setInputFiles(await tonalPhoto(page))
  let url = await ready(page)
  const original = await downloadPng(page)
  await dither.focus()
  await page.keyboard.press('Space')
  await expect(dither).toBeChecked()
  await expect(dither).toBeFocused()
  await expect(normalOption(page)).not.toBeChecked()
  await expect(duotone).toBeEnabled()
  await expect(duotone).not.toBeChecked()
  url = await ready(page, url)
  expectTwoInks(await inspectPhoto(page, await downloadPng(page), themes[0].ink), themes[0].ink, 1728)
  // Downloading moves focus; explicitly return to the keyboard control.
  await dither.focus()
  await page.keyboard.press('ArrowUp')
  await expect(normalOption(page)).toBeChecked()
  await expect(normalOption(page)).toBeFocused()
  await expect(dither).not.toBeChecked()
  await expect(duotone).toBeEnabled()
  await expect(duotone).not.toBeChecked()
  await ready(page, url)
  expect((await downloadPng(page)).equals(original)).toBe(true)
})

test('station, format, and theme changes retain Diffusion Dither as the only selected effect', async ({ page }) => {
  await page.goto('/')
  const dither = ditherToggle(page)
  const duotone = duotoneToggle(page)
  await gradientToggle(page).uncheck()
  await duotone.check()
  await page.getByLabel('Photo file').setInputFiles(await tonalPhoto(page))
  let url = await ready(page)
  const original = await downloadPng(page)
  await dither.check()
  url = await ready(page, url)
  const diffusion = await downloadPng(page)
  const baseline = await inspectPhoto(page, diffusion, themes[0].ink)
  let ink = themes[0].ink
  let height = 1728
  for (const choice of ['Copper', 'Island City', 'Sunday', 'CC', '4:5', 'Berry', 'CHIR FM', 'Square', 'Lime']) {
    await page.getByRole('radio', { name: choice, exact: true }).check()
    url = await ready(page, url)
    await expect(page.getByRole('radio', { name: choice, exact: true })).toBeChecked()
    await expect(dither).toBeChecked()
    await expect(dither).toBeEnabled()
    await expect(normalOption(page)).not.toBeChecked()
    await expect(normalOption(page)).toBeEnabled()
    await expect(duotone).not.toBeChecked()
    await expect(duotone).toBeEnabled()
    await expect(gradientToggle(page)).not.toBeChecked()
    await expect(gradientToggle(page)).toBeEnabled()
    ink = themes.find(theme => theme.color === choice)?.ink ?? ink
    if (choice === '4:5') height = 2160
    if (choice === 'Square') height = 1728
    const pixels = await inspectPhoto(page, await downloadPng(page), ink)
    expectTwoInks(pixels, ink, height)
    if (choice === 'Copper') {
      expect(pixels.mask, 'theme changes recolor the same grayscale diffusion, not its dot placement').toBe(baseline.mask)
    }
  }
  expect((await downloadPng(page)).equals(diffusion), 'returning to CHIR/Square/Lime restores every byte').toBe(true)
  await duotone.check()
  await ready(page, url)
  await expect(dither).not.toBeChecked()
  await expect(duotone).toBeChecked()
  await expect(duotone).toBeEnabled()
  expect((await downloadPng(page)).equals(original), 'explicitly selecting Duotone reproduces its output after all setting changes').toBe(true)
})

test('Corner gradient remains independently selectable while diffusion is on', async ({ page }) => {
  await page.goto('/')
  const dither = ditherToggle(page)
  const gradient = gradientToggle(page)
  await expect(gradient).not.toBeChecked()
  await dither.check()
  await page.getByLabel('Photo file').setInputFiles(await tonalPhoto(page, '#ffffff'))
  let url = await ready(page)
  const unshaded = await downloadPng(page)
  await expect(gradient).toBeEnabled()
  await gradient.check()
  url = await ready(page, url)
  const shaded = await downloadPng(page)
  expect(shaded.equals(unshaded), 'gradient still changes the diffusion image').toBe(false)
  await expect(dither).toBeChecked()
  await normalOption(page).check()
  url = await ready(page, url)
  await expect(gradient).toBeChecked()
  await expect(gradient).toBeEnabled()
  await dither.check()
  url = await ready(page, url)
  await expect(gradient).toBeChecked()
  expect((await downloadPng(page)).equals(shaded)).toBe(true)
  await gradient.uncheck()
  await ready(page, url)
  await expect(dither).toBeChecked()
  expect((await downloadPng(page)).equals(unshaded), 'gradient off restores the unshaded diffusion image').toBe(true)
})

for (const finalDither of [true, false]) {
  test(`rapid photo effect selections publish only the final ${finalDither ? 'Diffusion Dither' : 'Duotone'} preview/download`, async ({ page }) => {
    await page.goto('/')
    const dither = ditherToggle(page)
    const duotone = duotoneToggle(page)
    await gradientToggle(page).uncheck()
    await duotone.check()
    await page.getByLabel('Photo file').setInputFiles(await tonalPhoto(page))
    let url = await ready(page)
    const original = await downloadPng(page)
    await dither.check()
    url = await ready(page, url)
    const diffusion = await downloadPng(page)
    if (finalDither) {
      await duotone.check()
      url = await ready(page, url)
    }
    // Start opposite the final state. Do not wait for any intermediate render.
    for (const checked of [finalDither, !finalDither, finalDither, !finalDither, finalDither]) {
      await (checked ? dither : duotone).check()
    }
    await ready(page, url)
    await expect(dither).toBeChecked({ checked: finalDither })
    await expect(normalOption(page)).not.toBeChecked()
    await expect(duotone).toBeChecked({ checked: !finalDither })
    for (const option of [normalOption(page), dither, duotone]) await expect(option).toBeEnabled()
    await expect(gradientToggle(page)).not.toBeChecked()
    const expected = finalDither ? diffusion : original
    expect((await downloadPng(page)).equals(expected), 'a superseded render must not replace the final selection').toBe(true)
  })
}
