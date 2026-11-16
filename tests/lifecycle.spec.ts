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
  await page.getByLabel('Photo file').setInputFiles({ name: 'middle.png', mimeType: 'image/png', buffer })
  await page.getByLabel('Photo file').setInputFiles({ name: 'latest.png', mimeType: 'image/png', buffer })
  await expect(page.getByText('latest.png · 80 × 80')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).staleClosed)).toBe(true)
  expect(await page.evaluate(() => (window as any).decodeStats)).toEqual({ calls: 2, maxActive: 1 })
  await expect(page.getByText('latest.png · 80 × 80')).toBeVisible()
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
  const size = page.getByRole('slider', { name: 'Crop size' })
  await size.focus()
  await size.press('Home')
  await expect(size).toHaveValue('0')
  await size.press('End')
  await expect(size).toHaveValue('100')
  const geometry = await page.locator('.crop-selection').evaluate(element => {
    const rect = element.getBoundingClientRect()
    return { width: (element as HTMLElement).style.width, squareError: Math.abs(rect.width - rect.height) }
  })
  expect(geometry.width).toBe('100%')
  expect(geometry.squareError).toBeLessThan(1)
})
