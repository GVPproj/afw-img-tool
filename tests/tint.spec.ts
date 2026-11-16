import { expect, test, type Page } from '@playwright/test'

async function tonalPhoto(page: Page) {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1080
    const context = canvas.getContext('2d')!
    // Neutral endpoints plus a midtone make tint and retained grain observable.
    for (const [index, color] of ['#000000', '#808080', '#ffffff'].entries()) {
      context.fillStyle = color
      context.fillRect(index * 360, 0, 360, 1080)
    }
    return canvas.toDataURL().split(',')[1]
  })
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

async function inspectTint(page: Page, png: Buffer, highlight: number[]) {
  return page.evaluate(async ({ base64, highlight }) => {
    const image = new Image()
    image.src = `data:image/png;base64,${base64}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    const pixel = (x: number) => Array.from(context.getImageData(x, 400, 1, 1).data)
    const midtones = context.getImageData(480, 400, 100, 100).data
    const reds = new Set<number>()
    for (let i = 0; i < midtones.length; i += 4) reds.add(midtones[i])
    const countInk = (x: number, y: number, w: number, h: number) => {
      const { data } = context.getImageData(x, y, w, h)
      let count = 0
      for (let i = 0; i < data.length; i += 4) {
        if (highlight.every((channel, index) => data[i + index] === channel)) count++
      }
      return count
    }
    return {
      width: canvas.width, height: canvas.height,
      shadow: pixel(100), highlight: pixel(900), midtone: pixel(500), grainLevels: reds.size,
      textInk: countInk(0, 0, 350, 200),
      chirInk: countInk(0, canvas.height - 200, 300, 200),
      // The left edge of AFW sits over the gray stripe in both formats;
      // unlike the white stripe, that background cannot count as highlight ink.
      afwInk: countInk(630, canvas.height - 150, 80, 150),
    }
  }, { base64: png.toString('base64'), highlight })
}

for (const { tint, highlight, format, height } of [
  { tint: 'Copper', highlight: [224, 108, 58], format: 'Square', height: 1080 },
  { tint: 'Berry', highlight: [179, 68, 121], format: '4:5', height: 1350 },
  { tint: 'Lime', highlight: [226, 255, 120], format: '4:5', height: 1350 },
]) {
test(`CHIR ${tint} tint maps photo tones and matches text and both logos in preview/download`, async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('group', { name: 'Tint', exact: true }).getByRole('radio', { name: 'None', exact: true })).toBeChecked()
  await page.getByRole('radio', { name: format, exact: true }).check()
  await page.getByLabel('Photo file').setInputFiles(await tonalPhoto(page))
  const original = await ready(page)
  await page.getByRole('radio', { name: tint, exact: true }).check()
  await ready(page, original)
  const pixels = await inspectTint(page, await downloadPng(page), highlight)
  expect(pixels).toMatchObject({ width: 1080, height, shadow: [0, 26, 114, 255], highlight: [...highlight, 255] })
  expect(pixels.midtone[0]).toBeGreaterThan(0)
  expect(pixels.midtone[0]).toBeLessThan(highlight[0])
  expect(pixels.grainLevels).toBeGreaterThan(10)
  expect(pixels.textInk).toBeGreaterThan(500)
  expect(pixels.chirInk).toBeGreaterThan(5000)
  expect(pixels.afwInk).toBeGreaterThan(1000)
})
}

test('tint is keyboard selectable, reversible, preserved across stations, and never affects Island City', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Photo file').setInputFiles(await tonalPhoto(page))
  let url = await ready(page)
  const untinted = await downloadPng(page)
  await page.getByRole('radio', { name: 'Island City', exact: true }).check()
  url = await ready(page, url)
  const island = await downloadPng(page)
  await expect(page.getByRole('group', { name: 'Tint', exact: true })).toHaveCount(0)
  await page.getByRole('radio', { name: 'CHIR FM', exact: true }).check()
  url = await ready(page, url)
  await page.getByRole('radio', { name: 'None', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('radio', { name: 'Copper', exact: true })).toBeChecked()
  url = await ready(page, url)
  const copper = await downloadPng(page)
  expect(copper.equals(untinted)).toBe(false)
  await page.getByRole('radio', { name: 'Island City', exact: true }).check()
  url = await ready(page, url)
  expect((await downloadPng(page)).equals(island), 'cached logos and source colors remain untouched').toBe(true)
  await expect(page.getByRole('group', { name: 'Tint', exact: true })).toHaveCount(0)
  await page.getByRole('radio', { name: 'CHIR FM', exact: true }).check()
  url = await ready(page, url)
  await expect(page.getByRole('radio', { name: 'Copper', exact: true })).toBeChecked()
  expect((await downloadPng(page)).equals(copper)).toBe(true)
  await page.getByRole('radio', { name: 'None', exact: true }).check()
  url = await ready(page, url)
  expect((await downloadPng(page)).equals(untinted), 'None restores every original pixel').toBe(true)

  // Rapid changes must leave only the final choice available for download.
  await page.getByRole('radio', { name: 'Copper', exact: true }).check()
  await page.getByRole('radio', { name: 'Berry', exact: true }).check()
  await page.getByRole('radio', { name: 'Lime', exact: true }).check()
  await ready(page, url)
  const lime = await inspectTint(page, await downloadPng(page), [226, 255, 120])
  expect(lime.highlight).toEqual([226, 255, 120, 255])
  expect(lime.afwInk).toBeGreaterThan(1000)
  await page.setViewportSize({ width: 320, height: 800 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
