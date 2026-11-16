import { expect, test, type Page } from '@playwright/test'

type TextCall = { text: string; x: number; y: number; font: string; baseline: string; width: number; height: number }
type SpiedWindow = Window & { islandText: TextCall[] }

async function spyText(page: Page) {
  await page.addInitScript(() => {
    const state = window as unknown as SpiedWindow
    state.islandText = []
    const fillText = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
      state.islandText.push({ text, x, y, font: this.font, baseline: this.textBaseline, width: this.canvas.width, height: this.canvas.height })
      // Observe the real draw, rather than replacing the pixels under test.
      if (maxWidth === undefined) fillText.call(this, text, x, y)
      else fillText.call(this, text, x, y, maxWidth)
    }
  })
}

async function photoFile(page: Page) {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1080
    canvas.height = 1350
    const context = canvas.getContext('2d')!
    for (const [index, color] of ['#000000', '#808080', '#ffffff'].entries()) {
      context.fillStyle = color
      context.fillRect(index * 360, 0, 360, canvas.height)
    }
    // Keep the date and AFW regions on black, away from white photo pixels.
    context.fillStyle = '#000000'
    context.fillRect(0, 850, 1080, 500)
    return canvas.toDataURL().split(',')[1]
  })
  return { name: 'island.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') }
}

async function ready(page: Page, previous?: string) {
  const download = page.getByRole('link', { name: 'Download PNG' })
  await expect(download).toBeVisible()
  if (previous) await expect(download).not.toHaveAttribute('href', previous)
  const url = (await download.getAttribute('href'))!
  await expect(page.locator('.crop-selection .result-image')).toHaveAttribute('src', url)
  return url
}

async function downloadPng(page: Page) {
  const pending = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download PNG' }).click()
  const download = await pending
  expect(download.suggestedFilename()).toBe('island_thumb.png')
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  const png = Buffer.concat(chunks)
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const preview = await page.locator('.result-image').evaluate(async (image: HTMLImageElement) => {
    const blob = await (await fetch(image.src)).blob()
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(',')[1])
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
  })
  expect(png.equals(Buffer.from(preview, 'base64')), 'download must match the live preview').toBe(true)
  return png
}

async function inspectPng(page: Page, png: Buffer, ink: number[]) {
  return page.evaluate(async ({ base64, ink }) => {
    const image = new Image()
    image.src = `data:image/png;base64,${base64}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    const region = (left: number, top: number, width: number, height: number) => {
      const { data } = context.getImageData(left, top, width, height)
      let count = 0, nonBlack = 0, minX = width, maxY = -1
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] || data[i + 1] || data[i + 2]) nonBlack++
        if (ink.every((channel, index) => data[i + index] === channel)) {
          count++
          minX = Math.min(minX, (i / 4) % width)
          maxY = Math.max(maxY, Math.floor(i / 4 / width))
        }
      }
      return { count, nonBlack, left: left + minX, bottom: height - 1 - maxY }
    }
    const sample = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data)
    // Entire artwork-free central strip, outside the corner fade in both formats.
    const photo = document.createElement('canvas')
    photo.width = 1080
    photo.height = 80
    photo.getContext('2d')!.drawImage(image, 0, Math.floor(canvas.height / 2) - 40, 1080, 80, 0, 0, 1080, 80)
    return {
      width: canvas.width, height: canvas.height,
      island: region(49, 49, 324, 302),
      date: region(0, canvas.height - 90, 600, 90),
      afw: region(626, canvas.height - 442, 454, 442),
      photo: photo.toDataURL(),
      shadow: sample(100, 400), highlight: sample(900, 400),
      topRight: sample(1076, 4), center: sample(900, Math.floor(canvas.height / 2)),
    }
  }, { base64: png.toString('base64'), ink })
}

const formats = [
  { format: 'Square', height: 1080 },
  { format: '4:5', height: 1350 },
]
const colors = [
  { color: 'Lime', ink: [226, 255, 120] },
  { color: 'Copper', ink: [224, 108, 58] },
  { color: 'Berry', ink: [179, 68, 121] },
]

for (const { format, height } of formats) {
  test(`Island City ${format}: long-form date is bottom-left in 44px Iosevka; clearing it omits the draw`, async ({ page }) => {
    await spyText(page)
    await page.goto('/')
    // This test distinguishes date ink from an untreated black background.
    await page.getByRole('checkbox', { name: 'Corner gradient', exact: true }).uncheck()
    await page.getByRole('radio', { name: 'Island City', exact: true }).check()
    await page.getByRole('radio', { name: format, exact: true }).check()
    const date = page.getByLabel('Show date', { exact: true })
    await expect(date).toBeVisible()
    await expect(date).toHaveAttribute('type', 'date')
    await expect(page.getByLabel('Host name', { exact: true })).toHaveCount(0)
    await date.fill('2026-11-10')
    await page.getByLabel('Photo file').setInputFiles(await photoFile(page))
    let url = await ready(page)
    const calls = await page.evaluate(() => (window as unknown as SpiedWindow).islandText)
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      expect(call).toEqual({ text: 'November 10, 2026', x: 24, y: height - 20, font: '44px Iosevka', baseline: 'bottom', width: 1080, height })
    }
    const drawn = await inspectPng(page, await downloadPng(page), colors[0].ink)
    expect(drawn).toMatchObject({ width: 1080, height })
    expect(drawn.date.count).toBeGreaterThan(500)
    expect(drawn.date.left).toBeGreaterThanOrEqual(24)
    expect(drawn.date.left).toBeLessThan(30)
    expect(drawn.date.bottom).toBeGreaterThanOrEqual(20)
    expect(drawn.date.bottom).toBeLessThan(40)

    await page.evaluate(() => { (window as unknown as SpiedWindow).islandText = [] })
    await date.fill('')
    url = await ready(page, url)
    expect(await page.evaluate(() => (window as unknown as SpiedWindow).islandText)).toEqual([])
    const empty = await inspectPng(page, await downloadPng(page), colors[0].ink)
    expect(empty.date.nonBlack, 'no date pixels remain in the black bottom-left region').toBe(0)
    expect(empty.island.count).toBe(drawn.island.count)
    expect(empty.afw.count).toBe(drawn.afw.count)
    expect(empty.photo).toBe(drawn.photo)
  })

  test(`Island City ${format}: every color recolors Island logo, date and AFW without changing the untreated photo`, async ({ page }) => {
    await page.goto('/')
    await page.getByRole('radio', { name: 'Island City', exact: true }).check()
    await page.getByRole('radio', { name: format, exact: true }).check()
    await page.getByLabel('Show date').fill('2026-11-10')
    const controls = page.getByRole('group', { name: 'Color', exact: true })
    await expect(controls.getByRole('radio')).toHaveCount(3)
    const duotone = controls.getByRole('checkbox', { name: 'Duotone', exact: true })
    const gradient = controls.getByRole('checkbox', { name: 'Corner gradient', exact: true })
    await expect(duotone).not.toBeChecked()
    await expect(gradient).not.toBeChecked()
    await expect(gradient).toBeEnabled()
    await gradient.uncheck()
    await page.getByLabel('Photo file').setInputFiles(await photoFile(page))
    let url = await ready(page)
    const original = await downloadPng(page)
    const baseline = await inspectPng(page, original, colors[0].ink)
    for (const { color, ink } of colors) {
      if (color !== 'Lime') {
        await controls.getByRole('radio', { name: color, exact: true }).check()
        url = await ready(page, url)
      }
      const pixels = await inspectPng(page, await downloadPng(page), ink)
      expect(pixels).toMatchObject({ width: 1080, height, shadow: [0, 0, 0, 255], highlight: [255, 255, 255, 255] })
      expect(pixels.island.count, `${color} Island logo ink`).toBeGreaterThan(1000)
      expect(pixels.date.count, `${color} date ink`).toBeGreaterThan(500)
      expect(pixels.afw.count, `${color} AFW logo ink`).toBeGreaterThan(1000)
      expect(pixels.photo === baseline.photo, `${color} leaves every pixel of the photo strip unchanged`).toBe(true)
      await expect(duotone).not.toBeChecked()
      await expect(gradient).toBeEnabled()
      await expect(gradient).not.toBeChecked()
    }
    await controls.getByRole('radio', { name: 'Lime', exact: true }).check()
    await ready(page, url)
    expect((await downloadPng(page)).equals(original), 'returning to Lime restores every pixel').toBe(true)
  })

  test(`Island City ${format}: duotone treats the photo and corner gradient is reversible without shading artwork`, async ({ page }) => {
    await page.goto('/')
    await page.getByRole('radio', { name: 'Island City', exact: true }).check()
    await page.getByRole('radio', { name: format, exact: true }).check()
    await page.getByRole('radio', { name: 'Copper', exact: true }).check()
    await page.getByLabel('Show date').fill('2026-11-10')
    const duotone = page.getByRole('checkbox', { name: 'Duotone', exact: true })
    const gradient = page.getByRole('checkbox', { name: 'Corner gradient', exact: true })
    await gradient.uncheck()
    await page.getByLabel('Photo file').setInputFiles(await photoFile(page))
    let url = await ready(page)
    const untreated = await downloadPng(page)
    await duotone.check()
    await expect(gradient).toBeEnabled()
    await gradient.uncheck()
    url = await ready(page, url)
    const unshaded = await downloadPng(page)
    const pixels = await inspectPng(page, unshaded, colors[1].ink)
    expect(pixels).toMatchObject({ width: 1080, height, shadow: [0, 26, 114, 255], highlight: [224, 108, 58, 255], topRight: [224, 108, 58, 255] })
    await gradient.check()
    url = await ready(page, url)
    const shaded = await inspectPng(page, await downloadPng(page), colors[1].ink)
    expect(shaded.topRight[0]).toBeLessThan(pixels.topRight[0] * 0.7)
    expect(shaded.topRight[3]).toBe(255)
    expect(shaded.center).toEqual(pixels.center)
    expect(shaded.photo).toBe(pixels.photo)
    for (const region of ['island', 'date', 'afw'] as const) {
      expect(shaded[region].count).toBeGreaterThan(500)
      // Antialiased edge pixels can round to ink on an unshaded highlight.
      // Solid artwork must remain canonical even as the background darkens.
      expect(shaded[region].count, `${region} keeps solid Copper ink above the fade`).toBeGreaterThan(pixels[region].count * 0.99)
    }
    await gradient.uncheck()
    url = await ready(page, url)
    expect((await downloadPng(page)).equals(unshaded)).toBe(true)
    await duotone.uncheck()
    await ready(page, url)
    await expect(gradient).toBeEnabled()
    expect((await downloadPng(page)).equals(untreated), 'duotone off restores the original photo and artwork').toBe(true)
  })
}

test('Show date and all Color controls are shared in both directions across station switches; host stays CHIR-only', async ({ page }) => {
  await page.goto('/')
  const date = page.getByLabel('Show date', { exact: true })
  const host = page.getByLabel('Host name', { exact: true })
  const controls = page.getByRole('group', { name: 'Color', exact: true })
  const duotone = controls.getByRole('checkbox', { name: 'Duotone', exact: true })
  const gradient = controls.getByRole('checkbox', { name: 'Corner gradient', exact: true })
  await host.fill('Station-switch host')
  await date.fill('2026-11-10')
  await controls.getByRole('radio', { name: 'Copper', exact: true }).check()
  await duotone.check()
  await gradient.uncheck()
  await page.getByLabel('Photo file').setInputFiles(await photoFile(page))
  let url = await ready(page)
  await page.getByRole('radio', { name: 'Island City', exact: true }).check()
  url = await ready(page, url)
  await expect(host).toHaveCount(0)
  await expect(date).toBeVisible()
  await expect(date).toHaveValue('2026-11-10')
  await expect(controls.getByRole('radio', { name: 'Copper', exact: true })).toBeChecked()
  await expect(duotone).toBeChecked()
  await expect(gradient).toBeEnabled()
  await expect(gradient).not.toBeChecked()

  // Edit on Island, then verify CHIR receives the same settings, not a private copy.
  await date.fill('2027-01-02')
  await controls.getByRole('radio', { name: 'Berry', exact: true }).check()
  await gradient.check()
  await duotone.uncheck()
  url = await ready(page, url)
  const island = await downloadPng(page)
  await expect(gradient).toBeEnabled()
  await expect(gradient).toBeChecked()
  await gradient.uncheck()
  url = await ready(page, url)
  const unshadedIsland = await downloadPng(page)
  expect(unshadedIsland.equals(island), 'gradient changes pixels without duotone').toBe(false)
  await gradient.check()
  url = await ready(page, url)
  expect((await downloadPng(page)).equals(island), 'gradient restores shaded pixels without duotone').toBe(true)
  await page.getByRole('radio', { name: 'CHIR FM', exact: true }).check()
  url = await ready(page, url)
  await expect(host).toBeVisible()
  await expect(host).toHaveValue('Station-switch host')
  await expect(date).toHaveValue('2027-01-02')
  await expect(controls.getByRole('radio', { name: 'Berry', exact: true })).toBeChecked()
  await expect(duotone).not.toBeChecked()
  await expect(gradient).toBeChecked()
  await expect(gradient).toBeEnabled()
  await page.getByRole('radio', { name: 'Island City', exact: true }).check()
  await ready(page, url)
  await expect(host).toHaveCount(0)
  expect((await downloadPng(page)).equals(island), 'switching stations preserves the complete Island rendering').toBe(true)
})
