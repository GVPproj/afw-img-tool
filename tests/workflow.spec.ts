import { expect, test, type Page } from '@playwright/test'

async function photoFile(page: Page, name = 'sunset.png', orientation?: number) {
  const base64 = await page.evaluate((jpeg) => {
    const canvas = document.createElement('canvas')
    canvas.width = 900
    canvas.height = 600
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#168091'
    ctx.fillRect(0, 0, 450, 600)
    ctx.fillStyle = '#bb5030'
    ctx.fillRect(450, 0, 450, 600)
    return canvas.toDataURL(jpeg ? 'image/jpeg' : 'image/png').split(',')[1]
  }, orientation !== undefined)
  let buffer = Buffer.from(base64, 'base64')
  if (orientation !== undefined) {
    // Minimal little-endian EXIF IFD with one Orientation SHORT entry.
    const exif = Buffer.from([255, 225, 0, 34, 69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 18, 1, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0])
    buffer = Buffer.concat([buffer.subarray(0, 2), exif, buffer.subarray(2)])
  }
  return { name, mimeType: '', buffer }
}

test('private photo → keyboard crop → 1080 PNG; reset and replacement', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Generate thumbnail' })).toBeDisabled()
  const requests: string[] = []
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(`${request.method()} ${request.url()}`) })
  await page.getByLabel('Photo file').setInputFiles(await photoFile(page))
  await expect(page.getByRole('status')).toContainText('Photo ready')
  await expect(page.getByText('sunset.png · 900 × 600')).toBeVisible()
  const size = page.getByRole('slider', { name: 'Crop size' })
  await size.focus()
  await size.press('Home')
  await size.press('ArrowRight')
  await expect(size).toHaveValue('0.1')
  await page.getByRole('button', { name: 'Generate thumbnail' }).click()
  const download = page.getByRole('link', { name: 'Download PNG' })
  await expect(download).toBeVisible()
  await expect(download).toHaveAttribute('download', 'sunset_thumb.png')
  const details = await page.locator('.result-image').evaluate(async (image: HTMLImageElement) => {
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(image, 0, 0)
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let yellow = 0
    let opaque = true
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] === 255 && pixels[i + 1] === 234 && pixels[i + 2] === 72) yellow++
      if (pixels[i + 3] !== 255) opaque = false
    }
    return { width: image.naturalWidth, height: image.naturalHeight, yellow, opaque }
  })
  expect(details).toMatchObject({ width: 1080, height: 1080, opaque: true })
  expect(details.yellow).toBeGreaterThan(1000)
  const downloadEvent = page.waitForEvent('download')
  await download.click()
  expect((await downloadEvent).suggestedFilename()).toBe('sunset_thumb.png')
  await page.getByRole('button', { name: 'Reset crop' }).click()
  await expect(download).toHaveCount(0)
  await expect(size).toHaveValue('100')
  await page.getByLabel('Photo file').setInputFiles(await photoFile(page, 'replacement.png'))
  await expect(page.getByText('replacement.png · 900 × 600')).toBeVisible()
  expect(requests.filter(request => !request.startsWith('GET http://127.0.0.1:4173/'))).toEqual([])
  expect(errors).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('invalid files fail usefully and a valid file recovers', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Photo file').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not a photo') })
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Generate thumbnail' })).toBeDisabled()
  await page.getByLabel('Photo file').setInputFiles(await photoFile(page))
  await expect(page.getByRole('status')).toContainText('Photo ready')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('pointer crop remains square and in bounds after resizing viewport', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Mouse drag is covered on desktop; keyboard workflow runs on mobile.')
  await page.goto('/')
  await page.getByLabel('Photo file').setInputFiles(await photoFile(page))
  await expect(page.getByRole('status')).toContainText('Photo ready')
  const selection = page.locator('.crop-selection')
  const before = (await selection.boundingBox())!
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
  await page.mouse.down()
  await page.mouse.move(before.x + before.width / 2 + 35, before.y + before.height / 2)
  await page.mouse.up()
  expect((await selection.boundingBox())!.x).toBeGreaterThan(before.x)
  await page.locator('.crop-handle').scrollIntoViewIfNeeded()
  const handle = (await page.locator('.crop-handle').boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x - 60, handle.y - 60)
  await page.mouse.up()
  expect((await selection.boundingBox())!.width).toBeLessThan(before.width)
  await page.setViewportSize({ width: 600, height: 900 })
  const box = (await selection.boundingBox())!
  const bounds = (await page.locator('.crop-stage').boundingBox())!
  expect(Math.abs(box.width - box.height)).toBeLessThan(2)
  expect(box.x).toBeGreaterThanOrEqual(bounds.x - 1)
  expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1)
})

for (const orientation of [2, 6]) {
  test(`JPEG EXIF orientation ${orientation} is applied once, preview and export agree`, async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('Photo file').setInputFiles(await photoFile(page, 'oriented.jpg', orientation))
    await expect(page.getByRole('status')).toContainText('Photo ready')
    const dimensions = orientation === 6 ? '600 × 900' : '900 × 600'
    await expect(page.getByText(`oriented.jpg · ${dimensions}`)).toBeVisible()
    const box = (await page.locator('.crop-selection').boundingBox())!
    expect(Math.abs(box.width - box.height)).toBeLessThan(2)
    await page.getByRole('button', { name: 'Generate thumbnail' }).click()
    await expect(page.getByRole('link', { name: 'Download PNG' })).toBeVisible()
    const samples = await page.evaluate(async () => {
      const sample = async (selector: string) => {
        const image = document.querySelector<HTMLImageElement>(selector)!
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 100
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(image, 0, 0, 100, 100)
        return [[25, 50], [50, 25]].map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data))
      }
      return { preview: await sample('.crop-image'), result: await sample('.result-image') }
    })
    // Mirroring puts red at left; 90° CW rotation puts teal at top.
    const index = orientation === 2 ? 0 : 1
    for (const pixels of [samples.preview[index], samples.result[index]]) {
      expect(pixels[0] > pixels[1]).toBe(orientation === 2)
    }
  })
}
