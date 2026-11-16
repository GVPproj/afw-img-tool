import { expect, test } from '@playwright/test'

for (const format of ['Square', '4:5']) {
  for (const duotone of [false, true]) {
    test(`Sunday gradient shades only the footer in ${format}, duotone ${duotone}`, async ({ page }) => {
      await page.goto('/')
      await page.getByRole('radio', { name: 'Sunday', exact: true }).check()
      await page.getByRole('radio', { name: format, exact: true }).check()
      await page.getByRole('checkbox', { name: 'Duotone', exact: true }).setChecked(duotone)
      const gradient = page.getByRole('checkbox', { name: 'Corner gradient', exact: true })
      await expect(gradient).not.toBeChecked()
      await gradient.check()
      const base64 = await page.evaluate(() => {
        const canvas = document.createElement('canvas')
        canvas.width = 1080
        canvas.height = 1350
        const context = canvas.getContext('2d')!
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        return canvas.toDataURL().split(',')[1]
      })
      await page.getByLabel('Photo file').setInputFiles({ name: 'white.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') })
      const download = page.getByRole('link', { name: 'Download PNG' })
      await expect(download).toBeVisible()
      const sample = () => page.evaluate(async () => {
        const image = new Image()
        image.src = document.querySelector<HTMLAnchorElement>('a[download]')!.href
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const context = canvas.getContext('2d')!
        context.drawImage(image, 0, 0)
        return {
          top: context.getImageData(0, 0, image.width, Math.floor(image.height * 0.7)).data.reduce((sum, value) => sum + value, 0),
          bottom: Array.from(context.getImageData(0, image.height - 1, 1, 1).data),
        }
      })
      const shaded = await sample()
      await page.getByRole('checkbox', { name: 'Corner gradient', exact: true }).uncheck()
      await expect(download).toBeVisible()
      const unshaded = await sample()
      expect(shaded.top).toEqual(unshaded.top)
      expect(shaded.bottom[0]).toBeLessThan(unshaded.bottom[0])
    })
  }
  test(`Sunday footer renders in ${format}`, async ({ page }) => {
    await page.addInitScript(() => {
      const original = CanvasRenderingContext2D.prototype.fillText
      ;(window as any).textCalls = []
      CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
        ;(window as any).textCalls.push({ text, x, y })
        if (maxWidth === undefined) original.call(this, text, x, y)
        else original.call(this, text, x, y, maxWidth)
      }
    })
    await page.goto('/')
    await page.getByRole('radio', { name: 'Sunday', exact: true }).check()
    await page.getByRole('radio', { name: format, exact: true }).check()
    await page.getByLabel('Host name').fill('The Jazz Caravan')
    await page.getByLabel('Show date').fill('2026-11-15')
    const base64 = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 1080
      canvas.height = 1350
      return canvas.toDataURL().split(',')[1]
    })
    await page.getByLabel('Photo file').setInputFiles({ name: 'sunday.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') })
    await expect(page.getByRole('link', { name: 'Download PNG' })).toBeVisible()
    const lines = await page.evaluate(() => (window as any).textCalls.slice(-6))
    expect(lines.map((line: any) => line.text)).toEqual([
      'A Friendly Wave', 'Sunday Sessions', 'with The Jazz Caravan',
      'Sunday November 15', '10:15am–1:15pm', 'Cassette Café',
    ])
    expect(lines[0].y).toBe((format === 'Square' ? 1080 : 1350) - 184)
    expect(lines[3].y).toBe(lines[0].y)
  })
}
