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

async function liveResult(page: Page, previousUrl?: string) {
  const download = page.getByRole('link', { name: 'Download PNG' })
  await expect(download).toBeVisible()
  if (previousUrl) await expect(download).not.toHaveAttribute('href', previousUrl)
  const url = (await download.getAttribute('href'))!
  await expect(page.locator('.crop-selection .result-image')).toHaveAttribute('src', url)
  return url
}

async function downloadedPixels(page: Page) {
  const pending = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download PNG' }).click()
  const stream = await (await pending).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  const png = Buffer.concat(chunks)
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`
  const matches = await page.locator('.result-image').evaluate(async (preview: HTMLImageElement, url) => {
    const downloaded = new Image()
    downloaded.src = url
    await Promise.all([preview.decode(), downloaded.decode()])
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1080
    const ctx = canvas.getContext('2d')!
    const pixels = (image: HTMLImageElement) => {
      ctx.clearRect(0, 0, 1080, 1080)
      ctx.drawImage(image, 0, 0)
      return ctx.getImageData(0, 0, 1080, 1080).data
    }
    const actual = pixels(downloaded)
    const shown = pixels(preview)
    return downloaded.naturalWidth === 1080 && downloaded.naturalHeight === 1080 &&
      actual.every((value, index) => value === shown[index])
  }, dataUrl)
  expect(matches, 'downloaded PNG pixels must match the live preview').toBe(true)
  return dataUrl
}

test('private photo → live keyboard crop → 1080 PNG; reset and replacement', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Download PNG' })).toHaveCount(0)
  await expect(page.getByRole('slider', { name: 'Crop size' })).toBeDisabled()
  const requests: string[] = []
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(`${request.method()} ${request.url()}`) })
  await page.getByLabel('Photo file').setInputFiles(await photoFile(page))
  await expect(page.getByRole('status')).toContainText('Photo ready')
  await expect(page.getByText('sunset.png · 900 × 600')).toBeVisible()
  const originalUrl = await liveResult(page)
  const size = page.getByRole('slider', { name: 'Crop size' })
  await size.focus()
  await size.press('Home')
  await size.press('Shift+ArrowRight')
  await expect(size).toHaveAttribute('aria-valuenow', '4.1')
  const croppedUrl = await liveResult(page, originalUrl)
  const download = page.getByRole('link', { name: 'Download PNG' })
  await expect(download).toHaveAttribute('download', 'sunset_thumb.png')
  const details = await page.locator('.result-image').evaluate(async (image: HTMLImageElement) => {
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(image, 0, 0)
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let lime = 0
    let opaque = true
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] === 226 && pixels[i + 1] === 255 && pixels[i + 2] === 120) lime++
      if (pixels[i + 3] !== 255) opaque = false
    }
    return { width: image.naturalWidth, height: image.naturalHeight, lime, opaque }
  })
  expect(details).toMatchObject({ width: 1080, height: 1080, opaque: true })
  expect(details.lime).toBeGreaterThan(1000)
  const downloadEvent = page.waitForEvent('download')
  await download.click()
  expect((await downloadEvent).suggestedFilename()).toBe('sunset_thumb.png')
  await page.getByRole('button', { name: 'Reset crop' }).click()
  await expect(size).toHaveAttribute('aria-valuenow', '100')
  const resetUrl = await liveResult(page, croppedUrl)
  await page.getByLabel('Photo file').setInputFiles(await photoFile(page, 'replacement.png'))
  await expect(page.getByText('replacement.png · 900 × 600')).toBeVisible()
  await liveResult(page, resetUrl)
  await expect(download).toHaveAttribute('download', 'replacement_thumb.png')
  expect(requests.filter(request => !request.startsWith('GET http://127.0.0.1:4173/'))).toEqual([])
  expect(errors).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('portrait toggle updates crop and PNG dimensions, then returns to square', async ({ page }) => {
  await page.goto('/')
  const portrait = page.getByRole('radio', { name: '4:5', exact: true })
  await expect(portrait).not.toBeChecked()
  await portrait.check()
  await page.getByLabel('Photo file').setInputFiles(await photoFile(page))
  let url = await liveResult(page)
  const selection = page.locator('.crop-selection')
  const box = (await selection.boundingBox())!
  expect(box.width / box.height).toBeCloseTo(0.8, 2)
  await expect(page.locator('.result-image')).toHaveJSProperty('naturalHeight', 1350)
  await page.getByRole('slider', { name: 'Crop size' }).press('PageDown')
  url = await liveResult(page, url)
  await page.getByRole('button', { name: 'Reset crop' }).click()
  url = await liveResult(page, url)
  const pending = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download PNG' }).click()
  const stream = await (await pending).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  const png = Buffer.concat(chunks)
  expect(png.readUInt32BE(16)).toBe(1080)
  expect(png.readUInt32BE(20)).toBe(1350)
  await page.getByRole('radio', { name: 'Square', exact: true }).check()
  await liveResult(page, url)
  await expect(page.locator('.result-image')).toHaveJSProperty('naturalHeight', 1080)
  const square = (await selection.boundingBox())!
  expect(square.width / square.height).toBeCloseTo(1, 2)
})

test('knobs and matching reset graphic fit one row on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto('/')
  await page.getByLabel('Photo file').setInputFiles(await photoFile(page))
  await liveResult(page)
  const size = page.getByRole('slider', { name: 'Crop size' })
  await size.press('PageDown')
  await expect(size).toHaveAttribute('aria-valuenow', '90')
  const horizontal = page.getByRole('slider', { name: 'Horizontal position' })
  const vertical = page.getByRole('slider', { name: 'Vertical position' })
  await horizontal.press('Home')
  await vertical.press('End')
  await expect(horizontal).toHaveAttribute('aria-valuenow', '0')
  await expect(vertical).toHaveAttribute('aria-valuenow', '100')
  const boxes = await page.locator('.crop-dial, .crop-reset svg').evaluateAll(elements => elements.map(element => {
    const { y, width, height } = element.getBoundingClientRect()
    return { y, width, height }
  }))
  expect(boxes).toHaveLength(4)
  for (const box of boxes) {
    expect(box.width).toBe(44)
    expect(box.height).toBe(44)
    expect(Math.abs(box.y - boxes[0].y)).toBeLessThan(1)
  }
  await page.getByRole('button', { name: 'Reset crop' }).click()
  await expect(size).toHaveAttribute('aria-valuenow', '100')
  await expect(horizontal).toHaveAttribute('aria-valuenow', '50')
  await expect(vertical).toBeDisabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('knob pointer dragging updates the crop and stops on release', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Mouse interaction; mobile runs the keyboard and layout workflow.')
  await page.goto('/')
  await page.getByLabel('Photo file').setInputFiles(await photoFile(page))
  await liveResult(page)
  const size = page.getByRole('slider', { name: 'Crop size' })
  const box = (await size.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 40)
  await expect(size).toHaveAttribute('aria-valuenow', '80')
  await page.mouse.up()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await expect(size).toHaveAttribute('aria-valuenow', '80')
  await liveResult(page)
})

test('invalid files fail usefully and a valid file recovers', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Photo file').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not a photo') })
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Download PNG' })).toHaveCount(0)
  await expect(page.locator('.result-image')).toHaveCount(0)
  await page.getByLabel('Photo file').setInputFiles(await photoFile(page))
  await expect(page.getByRole('status')).toContainText('Photo ready')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await liveResult(page)
})

test('pointer crop remains square and in bounds after resizing viewport', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Mouse drag is covered on desktop; keyboard workflow runs on mobile.')
  await page.goto('/')
  await page.getByLabel('Photo file').setInputFiles(await photoFile(page))
  await expect(page.getByRole('status')).toContainText('Photo ready')
  const originalUrl = await liveResult(page)
  const selection = page.locator('.crop-selection')
  const before = (await selection.boundingBox())!
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
  await page.mouse.down()
  await page.mouse.move(before.x + before.width / 2 + 35, before.y + before.height / 2)
  await page.mouse.up()
  expect((await selection.boundingBox())!.x).toBeGreaterThan(before.x)
  const movedUrl = await liveResult(page, originalUrl)
  await page.locator('.crop-handle').scrollIntoViewIfNeeded()
  const handle = (await page.locator('.crop-handle').boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x - 60, handle.y - 60)
  await page.mouse.up()
  expect((await selection.boundingBox())!.width).toBeLessThan(before.width)
  await liveResult(page, movedUrl)
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
    await liveResult(page)
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

test('Island City always includes artwork and restores identical pixels after switching stations', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('radio', { name: 'Island City', exact: true }).check()
  await expect(page.getByRole('checkbox', { name: 'Island City overlay' })).toHaveCount(0)
  await expect(page.getByText('Artwork', { exact: true })).toHaveCount(0)
  await expect(page.getByText('AFW logo and film grain are always included.')).toHaveCount(0)
  await page.getByLabel('Photo file').setInputFiles(await photoFile(page))
  const originalUrl = await liveResult(page)
  const withIsland = await downloadedPixels(page)

  await page.getByRole('radio', { name: 'CHIR FM', exact: true }).check()
  const withoutUrl = await liveResult(page, originalUrl)
  const withoutIsland = await downloadedPixels(page)
  await page.getByRole('radio', { name: 'Island City', exact: true }).check()
  await liveResult(page, withoutUrl)
  const restored = await downloadedPixels(page)
  const comparison = await page.evaluate(async (urls) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1080
    const ctx = canvas.getContext('2d')!
    const images = await Promise.all(urls.map(async url => {
      const image = new Image()
      image.src = url
      await image.decode()
      ctx.drawImage(image, 0, 0)
      return ctx.getImageData(0, 0, 1080, 1080).data
    }))
    const ink = images.map(() => ({ topLeft: 0, lowerRight: 0 }))
    let changedTopLeft = 0
    let changedElsewhere = 0
    let restoredDifferences = 0
    for (let y = 0; y < 1080; y++) {
      for (let x = 0; x < 1080; x++) {
        const offset = (y * 1080 + x) * 4
        const topLeft = x < 540 && y < 540
        images.forEach((pixels, index) => {
          if (pixels[offset] === 226 && pixels[offset + 1] === 255 && pixels[offset + 2] === 120) {
            if (topLeft) ink[index].topLeft++
            if (x >= 540 && y >= 540) ink[index].lowerRight++
          }
        })
        const changed = [0, 1, 2, 3].some(channel => images[0][offset + channel] !== images[1][offset + channel])
        if (changed && topLeft) changedTopLeft++
        if (changed && !topLeft) changedElsewhere++
        if ([0, 1, 2, 3].some(channel => images[0][offset + channel] !== images[2][offset + channel])) restoredDifferences++
      }
    }
    return { ink, changedTopLeft, changedElsewhere, restoredDifferences }
  }, [withIsland, withoutIsland, restored])
  expect(comparison.ink[0].topLeft).toBeGreaterThan(1000)
  expect(comparison.ink[0].lowerRight).toBeGreaterThan(1000)
  expect(comparison.changedTopLeft).toBeGreaterThan(1000)
  expect(comparison.restoredDifferences, 'restoring the overlay must reproduce every pixel').toBe(0)
})

test('CHIR FM shows date and host controls and renders show details without Island City artwork', async ({ page }) => {
  await page.addInitScript(() => {
    const fillText = CanvasRenderingContext2D.prototype.fillText
    ;(window as any).showText = []
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
      ;(window as any).showText.push({ text, x, y })
      if (maxWidth === undefined) fillText.call(this, text, x, y)
      else fillText.call(this, text, x, y, maxWidth)
    }
  })
  await page.goto('/')
  const island = (await page.getByRole('radio', { name: 'Island City', exact: true }).boundingBox())!
  const chir = (await page.getByRole('radio', { name: 'CHIR FM', exact: true }).boundingBox())!
  const aspect = (await page.getByRole('radio', { name: 'Square', exact: true }).boundingBox())!
  expect(Math.abs(island.y - chir.y)).toBeLessThan(1)
  expect(chir.x).toBeLessThan(island.x)
  expect(aspect.y).toBeGreaterThan(island.y + island.height)
  await expect(page.getByRole('radio', { name: 'CHIR FM', exact: true })).toBeChecked()
  await expect(page.locator('.settings-legend', { hasText: 'Radio' })).toHaveCount(0)
  await expect(page.getByLabel('Host name')).toBeVisible()
  await expect(page.getByLabel('Show date')).toHaveAttribute('type', 'date')
  await expect(page.getByLabel('Show date')).toHaveClass(/input/)
  await expect(page.getByLabel('Island City overlay')).toHaveCount(0)
  await page.getByLabel('Show date').fill('2026-11-10')
  await page.getByLabel('Host name').fill('Christina Novak & Emily McMartin')
  await page.getByLabel('Photo file').setInputFiles(await photoFile(page))
  let url = await liveResult(page)
  await downloadedPixels(page)
  const text = await page.evaluate(() => (window as any).showText)
  expect(text).toEqual(expect.arrayContaining([
    { text: 'A Friendly Wave Radio', x: 16, y: 16 },
    { text: 'Christina Novak &', x: 16, y: 66 },
    { text: 'Emily McMartin', x: 16, y: 116 },
    { text: 'November 10, 2026', x: 16, y: 166 },
    { text: 'Tuesdays at 7:00pm', x: 620, y: 16 },
    { text: '107.9 fm / 102.1 fm', x: 620, y: 66 },
    { text: 'Chir.fm', x: 620, y: 116 },
  ]))
  await page.getByLabel('Host name').fill('Another Host')
  url = await liveResult(page, url)
  await page.getByLabel('Show date').fill('2026-12-01')
  url = await liveResult(page, url)
  await page.getByRole('radio', { name: '4:5', exact: true }).check()
  url = await liveResult(page, url)
  await expect(page.locator('.result-image')).toHaveJSProperty('naturalHeight', 1350)
  await page.getByRole('radio', { name: 'Island City', exact: true }).check()
  url = await liveResult(page, url)
  await expect(page.getByLabel('Show date')).toBeVisible()
  await expect(page.getByLabel('Show date')).toHaveValue('2026-12-01')
  await expect(page.getByLabel('Host name')).toHaveCount(0)
  await expect(page.getByLabel('Island City overlay')).toHaveCount(0)
  await page.getByRole('radio', { name: 'CHIR FM', exact: true }).check()
  await liveResult(page, url)
  await expect(page.getByLabel('Show date')).toHaveValue('2026-12-01')
  await expect(page.getByLabel('Host name')).toHaveValue('Another Host')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('CHIR vector logo stays inset at bottom left in both formats and is absent for Island City', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Photo file').setInputFiles(await photoFile(page))
  let url = await liveResult(page)
  const logoBounds = () => page.locator('.result-image').evaluate(async (image: HTMLImageElement) => {
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(image, 0, 0)
    const { data } = ctx.getImageData(0, canvas.height - 200, 300, 200)
    const xs: number[] = [], ys: number[] = []
    for (let y = 0; y < 200; y++) for (let x = 0; x < 300; x++) {
      const i = (y * 300 + x) * 4
      if (data[i] === 226 && data[i + 1] === 255 && data[i + 2] === 120) {
        xs.push(x)
        ys.push(y)
      }
    }
    return xs.length ? { left: Math.min(...xs), right: Math.max(...xs), bottom: 199 - Math.max(...ys), count: xs.length } : null
  })
  for (const format of ['Square', '4:5']) {
    await page.getByRole('radio', { name: format, exact: true }).check()
    if (format === '4:5') url = await liveResult(page, url)
    const bounds = (await logoBounds())!
    expect(bounds.count).toBeGreaterThan(5000)
    expect(bounds.left).toBeGreaterThanOrEqual(24)
    expect(bounds.left).toBeLessThan(27)
    expect(bounds.right).toBeLessThan(222)
    expect(bounds.bottom).toBeGreaterThanOrEqual(20)
    expect(bounds.bottom).toBeLessThan(23)
  }
  await page.getByRole('radio', { name: 'Island City', exact: true }).check()
  await liveResult(page, url)
  expect(await logoBounds()).toBeNull()
})

test('one workspace puts preview left of settings above 900px and stacks without mobile overflow', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Photo file').setInputFiles(await photoFile(page))
  await liveResult(page)
  await expect(page.getByRole('region', { name: 'Thumbnail editor' })).toHaveCount(1)
  await expect(page.locator('.preview-panel')).toHaveCount(1)
  await expect(page.locator('.settings-panel')).toHaveCount(1)
  await expect(page.locator('.result-image')).toHaveCount(1)
  await expect(page.locator('.crop-stage > .crop-image + .crop-selection > .result-image')).toHaveCount(1)

  for (const width of [1280, 901, 900, 390]) {
    await page.setViewportSize({ width, height: 900 })
    const preview = (await page.locator('.preview-panel').boundingBox())!
    const settings = (await page.locator('.settings-panel').boundingBox())!
    const upload = (await page.locator('.preview-panel').getByLabel('Photo file').boundingBox())!
    const stage = (await page.locator('.crop-stage').boundingBox())!
    expect(upload.y + upload.height).toBeLessThanOrEqual(stage.y)
    if (width > 900) {
      expect(preview.x + preview.width).toBeLessThanOrEqual(settings.x + 1)
      expect(Math.abs(preview.y - settings.y)).toBeLessThan(1)
      expect(Math.abs(preview.width - settings.width)).toBeLessThan(1)
    } else {
      expect(preview.y + preview.height).toBeLessThanOrEqual(settings.y + 1)
      expect(Math.abs(preview.x - settings.x)).toBeLessThan(1)
    }
    const selection = (await page.locator('.crop-selection').boundingBox())!
    const result = (await page.locator('.result-image').boundingBox())!
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(Math.abs(selection[key] - result[key])).toBeLessThan(1)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no overflow at ${width}px`).toBe(true)
  }
})
