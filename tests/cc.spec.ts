import { expect, test } from '@playwright/test'

for (const format of ['Square', '4:5']) {
  test(`CC footer and editable times in ${format}`, async ({ page }) => {
    await page.addInitScript(() => {
      const original = CanvasRenderingContext2D.prototype.fillText
      ;(window as any).textCalls = []
      CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
        ;(window as any).textCalls.push({ text, x, y, scale: this.getTransform().a })
        if (maxWidth === undefined) original.call(this, text, x, y)
        else original.call(this, text, x, y, maxWidth)
      }
    })
    await page.goto('/')
    await expect(page.getByLabel('Start time', { exact: true })).toHaveCount(0)
    await page.getByRole('radio', { name: 'CC', exact: true }).check()
    await page.getByRole('radio', { name: format, exact: true }).check()
    await page.getByLabel('Host name').fill('Michelle Footz')
    await page.getByLabel('Show date').fill('2026-10-24')
    await page.getByLabel('Start time', { exact: true }).fill('16:00')
    await page.getByLabel('Finish time', { exact: true }).fill('17:00')
    const base64 = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 1080
      canvas.height = 1350
      return canvas.toDataURL().split(',')[1]
    })
    await page.getByLabel('Photo file').setInputFiles({ name: 'cc.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') })
    const download = page.getByRole('link', { name: 'Download PNG' })
    await expect(download).toBeVisible()
    const lines = await page.evaluate(() => (window as any).textCalls.slice(-6))
    expect(lines.map((line: any) => line.text)).toEqual([
      'A Friendly Wave', 'Community Curation', 'with Michelle Footz',
      'Saturday, October 24', '4:00pm–5:00pm', 'Cassette Café',
    ])
    // Layout stays in design coordinates; the canvas scales it to export pixels.
    expect(lines[0].scale).toBeCloseTo(1.6)
    await expect(page.locator('.result-image')).toHaveJSProperty('naturalWidth', 1728)
    await expect(page.locator('.result-image')).toHaveJSProperty('naturalHeight', format === 'Square' ? 1728 : 2160)
    expect(lines[0].y).toBe((format === 'Square' ? 1080 : 1350) - 184)
    expect(lines[3].y).toBe(lines[0].y)
    await expect(page.getByAltText('Processed thumbnail with Community Curation show details')).toBeVisible()

    await page.getByLabel('Start time', { exact: true }).fill('00:05')
    await page.getByLabel('Finish time', { exact: true }).fill('12:30')
    await expect(download).toBeVisible()
    expect(await page.evaluate(() => (window as any).textCalls.slice(-2)[0].text)).toBe('12:05am–12:30pm')

    await page.getByRole('radio', { name: 'Sunday', exact: true }).check()
    await expect(page.getByLabel('Start time', { exact: true })).toHaveValue('00:05')
    await expect(page.getByLabel('Finish time', { exact: true })).toHaveValue('12:30')
    await expect(download).toBeVisible()
    expect(await page.evaluate(() => (window as any).textCalls.slice(-2)[0].text)).toBe('12:05am–12:30pm')
    await page.getByRole('radio', { name: 'CC', exact: true }).check()
    await expect(page.getByLabel('Start time', { exact: true })).toHaveValue('00:05')
    await expect(page.getByLabel('Finish time', { exact: true })).toHaveValue('12:30')
    await expect(download).toBeVisible()
    expect(await page.evaluate(() => (window as any).textCalls.slice(-2)[0].text)).toBe('12:05am–12:30pm')
  })
}
