import { expect, test } from '@playwright/test'

test('a late decode cannot replace a newer photo and releases its bitmap', async ({ page }) => {
  await page.addInitScript(() => {
    const decode = window.createImageBitmap.bind(window)
    let calls = 0
    let active = 0
    ;(window as any).staleClosed = false
    ;(window as any).decodeStats = { calls: 0, maxActive: 0 }
    window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
      const first = ++calls === 1
      const stats = (window as any).decodeStats
      stats.calls = calls
      stats.maxActive = Math.max(stats.maxActive, ++active)
      const bitmap = await (decode as any)(...args)
      if (first) {
        const close = bitmap.close.bind(bitmap)
        bitmap.close = () => { (window as any).staleClosed = true; close() }
        await new Promise(resolve => setTimeout(resolve, 800))
      }
      active--
      return bitmap
    }) as typeof createImageBitmap
  })
  await page.goto('/')
  const buffer = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 80
    return canvas.toDataURL().split(',')[1]
  }), 'base64')
  await page.getByLabel('Photo file').setInputFiles({ name: 'first.png', mimeType: 'image/png', buffer })
  await expect(page.getByRole('status')).toContainText('Opening')
  await expect.poll(() => page.evaluate(() => (window as any).decodeStats.calls)).toBe(1)
  await page.getByLabel('Photo file').setInputFiles({ name: 'middle.png', mimeType: 'image/png', buffer })
  await page.getByLabel('Photo file').setInputFiles({ name: 'latest.png', mimeType: 'image/png', buffer })
  await expect(page.getByText('latest.png · 80 × 80')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).staleClosed)).toBe(true)
  expect(await page.evaluate(() => (window as any).decodeStats)).toEqual({ calls: 2, maxActive: 1 })
  await expect(page.getByText('latest.png · 80 × 80')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Download PNG' })).toHaveAttribute('download', 'latest_thumb.png')
  await expect(page.locator('.crop-selection .result-image')).toBeVisible()
})

test('crop size reaches both endpoints for a fractional minimum', async ({ page }) => {
  await page.goto('/')
  const buffer = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1080
    canvas.height = 1920
    return canvas.toDataURL().split(',')[1]
  }), 'base64')
  await page.getByLabel('Photo file').setInputFiles({ name: 'portrait.png', mimeType: 'image/png', buffer })
  await expect(page.getByRole('status')).toContainText('Photo ready')
  const download = page.getByRole('link', { name: 'Download PNG' })
  await expect(download).toBeVisible()
  const originalUrl = await download.getAttribute('href')
  const size = page.getByRole('slider', { name: 'Crop size' })
  await size.focus()
  await size.press('Home')
  await expect(size).toHaveAttribute('aria-valuenow', '2.2')
  await expect(download).toBeVisible()
  await expect(download).not.toHaveAttribute('href', originalUrl!)
  const minimumUrl = await download.getAttribute('href')
  await size.press('End')
  await expect(size).toHaveAttribute('aria-valuenow', '100')
  await expect(download).toBeVisible()
  await expect(download).not.toHaveAttribute('href', minimumUrl!)
  const geometry = await page.locator('.crop-selection').evaluate(element => {
    const rect = element.getBoundingClientRect()
    return { width: (element as HTMLElement).style.width, squareError: Math.abs(rect.width - rect.height) }
  })
  expect(geometry.width).toBe('100%')
  expect(geometry.squareError).toBeLessThan(1)
})

for (const replacePhoto of [false, true]) {
  test(`a stale thumbnail cannot commit after ${replacePhoto ? 'photo replacement' : 'settings changes'}`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => {
      // Hold encoded thumbnails, not the JPEG source preview. Explicit gates
      // exercise the race without relying on machine-dependent render timing.
      const state = { releases: [] as (() => void)[], committed: [] as string[] }
      ;(window as any).thumbnailRace = state
      const encode = HTMLCanvasElement.prototype.toBlob
      HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
        const thumbnail = this.width === 1728 && this.height === 1728 && type === 'image/png'
        encode.call(this, blob => {
          if (thumbnail) state.releases.push(() => callback(blob))
          else callback(blob)
        }, type, quality)
      }
      const createUrl = URL.createObjectURL.bind(URL)
      URL.createObjectURL = object => {
        const url = createUrl(object)
        if (object instanceof Blob && object.type === 'image/png') state.committed.push(url)
        return url
      }
    })
    await page.goto('/')
    await page.getByRole('radio', { name: 'Island City', exact: true }).check()
    const buffer = Buffer.from(await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 900
      canvas.height = 600
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#168091'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      return canvas.toDataURL().split(',')[1]
    }), 'base64')
    await page.getByLabel('Photo file').setInputFiles({ name: 'first.png', mimeType: 'image/png', buffer })
    await expect.poll(() => page.evaluate(() => (window as any).thumbnailRace.releases.length)).toBe(1)
    await expect(page.getByRole('status')).toContainText('Photo ready')
    const download = page.getByRole('link', { name: 'Download PNG' })
    await expect(download).toHaveCount(0)
    const size = page.getByRole('slider', { name: 'Crop size' })
    const reset = page.getByRole('button', { name: 'Reset crop' })
    const station = page.getByRole('radio', { name: 'CHIR FM', exact: true })
    await expect(size).toBeEnabled()
    await expect(reset).toBeEnabled()
    await expect(station).toBeEnabled()
    await size.press('Home')
    await expect(page.getByRole('slider', { name: 'Horizontal position' })).toBeEnabled()
    await expect(page.getByRole('slider', { name: 'Vertical position' })).toBeEnabled()
    await reset.click()
    await expect(size).toHaveAttribute('aria-valuenow', '100')
    await size.press('Home')
    await size.press('ArrowRight')
    await station.check()
    await page.getByRole('radio', { name: 'Copper', exact: true }).check()
    await page.getByRole('radio', { name: 'Duotone', exact: true }).check()
    if (replacePhoto) {
      await page.getByLabel('Photo file').setInputFiles({ name: 'latest.png', mimeType: 'image/png', buffer })
      await expect(page.getByText('latest.png · 900 × 600')).toBeVisible()
    }
    await expect(page.getByRole('status')).toContainText('Photo ready')
    await expect(download).toHaveCount(0)

    await page.evaluate(() => (window as any).thumbnailRace.releases[0]())
    await expect.poll(() => page.evaluate(() => (window as any).thumbnailRace.releases.length)).toBe(2)
    // Even while the current render is blocked, the obsolete result must never
    // acquire a URL or appear in the workspace/download action.
    expect(await page.evaluate(() => (window as any).thumbnailRace.committed)).toEqual([])
    await expect(page.locator('.result-image')).toHaveCount(0)
    await expect(download).toHaveCount(0)
    await page.evaluate(() => (window as any).thumbnailRace.releases[1]())
    await expect(download).toBeVisible()
    await expect(download).toHaveAttribute('download', `${replacePhoto ? 'latest' : 'first'}_thumb.png`)
    const url = (await download.getAttribute('href'))!
    await expect(page.locator('.crop-selection .result-image')).toHaveAttribute('src', url)
    await expect(page.locator('.result-image')).toHaveAttribute('alt', 'Processed thumbnail with CHIR FM show details and AFW logo')
    await expect(station).toBeChecked()
    await expect(page.getByRole('radio', { name: 'Copper', exact: true })).toBeChecked()
    await expect(page.getByRole('radio', { name: 'Duotone', exact: true })).toBeChecked()
    expect(await page.evaluate(() => (window as any).thumbnailRace.committed)).toEqual([url])

    // Updating an already-completed result must also hide its stale download.
    await size.press('Home')
    await expect.poll(() => page.evaluate(() => (window as any).thumbnailRace.releases.length)).toBe(3)
    await expect(download).toHaveCount(0)
    await expect(page.getByRole('status')).toContainText('Photo ready')
    await expect(size).toBeEnabled()
    await expect(reset).toBeEnabled()
    await page.evaluate(() => (window as any).thumbnailRace.releases[2]())
    await expect(download).toBeVisible()
    await expect(download).not.toHaveAttribute('href', url)
    const updatedUrl = (await download.getAttribute('href'))!
    await expect(page.locator('.result-image')).toHaveAttribute('src', updatedUrl)
    expect(await page.evaluate(() => (window as any).thumbnailRace.committed)).toEqual([url, updatedUrl])
    expect(errors).toEqual([])
  })
}

test('stale processed previews stay hidden during settings updates and failed renders', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { releases: [] as ((fail?: boolean) => void)[] }
    ;(window as any).previewRace = state
    const encode = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      const thumbnail = this.width === 1728 && this.height === 1728 && type === 'image/png'
      encode.call(this, blob => {
        if (thumbnail) state.releases.push((fail = false) => callback(fail ? null : blob))
        else callback(blob)
      }, type, quality)
    }
  })
  await page.goto('/')
  const buffer = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 80
    return canvas.toDataURL().split(',')[1]
  }), 'base64')
  await page.getByLabel('Photo file').setInputFiles({ name: 'preview.png', mimeType: 'image/png', buffer })
  const preview = page.locator('.result-image')
  const download = page.getByRole('link', { name: 'Download PNG' })
  const waitForRender = (count: number) => expect.poll(() => page.evaluate(() => (window as any).previewRace.releases.length)).toBe(count)
  const release = (index: number, fail = false) => page.evaluate(({ index, fail }) => (window as any).previewRace.releases[index](fail), { index, fail })
  await waitForRender(1)
  await release(0)
  await expect(download).toBeVisible()
  let url = (await download.getAttribute('href'))!
  await expect(preview).toHaveAttribute('src', url)

  const changes = [
    () => page.getByRole('radio', { name: 'Copper', exact: true }).check(),
    () => page.getByRole('radio', { name: 'Duotone', exact: true }).check(),
    () => page.getByRole('checkbox', { name: 'Corner gradient', exact: true }).check(),
    () => page.getByRole('radio', { name: 'Island City', exact: true }).check(),
    () => page.getByRole('radio', { name: 'CHIR FM', exact: true }).check(),
  ]
  for (const [index, change] of changes.entries()) {
    await change()
    await waitForRender(index + 2)
    await expect(preview).toHaveCount(0)
    await expect(download).toHaveCount(0)
    // The source image remains available for cropping while processing.
    await expect(page.locator('.crop-image')).toBeVisible()
    await release(index + 1)
    await expect(download).toBeVisible()
    await expect(download).not.toHaveAttribute('href', url)
    url = (await download.getAttribute('href'))!
    await expect(preview).toHaveAttribute('src', url)
  }

  await page.getByRole('radio', { name: 'Berry', exact: true }).check()
  await waitForRender(7)
  await release(6, true)
  await expect(page.getByRole('alert')).toContainText('could not export')
  await expect(preview).toHaveCount(0)
  await expect(download).toHaveCount(0)
  await page.getByRole('button', { name: 'Retry preview' }).click()
  await waitForRender(8)
  await expect(preview).toHaveCount(0)
  await release(7)
  await expect(download).toBeVisible()
  await expect(download).not.toHaveAttribute('href', url)
  await expect(preview).toHaveAttribute('src', (await download.getAttribute('href'))!)
  await expect(page.getByRole('alert')).toHaveCount(0)
})
