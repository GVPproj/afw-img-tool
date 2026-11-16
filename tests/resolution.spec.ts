import { expect, test } from '@playwright/test'

test('artwork uses full-density masks and scaled design coordinates in both output formats', async ({ page }) => {
  await page.addInitScript(() => {
    const drawImage = CanvasRenderingContext2D.prototype.drawImage
    ;(window as any).logoDraws = []
    CanvasRenderingContext2D.prototype.drawImage = function (...args: any[]) {
      const [source, x, y, width, height] = args
      if (this.canvas.width === 1728 && args.length === 5 && source instanceof HTMLCanvasElement) {
        const transform = this.getTransform()
        ;(window as any).logoDraws.push({
          x, y, width, height, sourceWidth: source.width, sourceHeight: source.height,
          scaleX: transform.a, scaleY: transform.d,
        })
      }
      return (drawImage as Function).apply(this, args)
    }
  })
  await page.goto('/')
  await page.getByRole('checkbox', { name: 'Diffusion dither', exact: true }).check()
  const buffer = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 32
    return canvas.toDataURL().split(',')[1]
  }), 'base64')
  await page.getByLabel('Photo file').setInputFiles({ name: 'density.png', mimeType: 'image/png', buffer })
  const download = page.getByRole('link', { name: 'Download PNG' })
  for (const [station, format, height, markWidth] of [
    ['CHIR FM', 'Square', 1728, 198],
    ['Island City', '4:5', 2160, 324],
  ] as const) {
    await page.getByRole('radio', { name: station, exact: true }).check()
    await page.getByRole('radio', { name: format, exact: true }).check()
    await expect(download).toBeVisible()
    const preview = page.locator('.result-image')
    await expect(preview).toHaveAttribute('width', '1728')
    await expect(preview).toHaveAttribute('height', String(height))
    await expect(preview).toHaveJSProperty('naturalWidth', 1728)
    await expect(preview).toHaveJSProperty('naturalHeight', height)
    const logos = await page.evaluate(() => (window as any).logoDraws.slice(-2))
    expect(logos.map((logo: any) => logo.width)).toEqual([markWidth, 454])
    for (const logo of logos) {
      expect(logo.scaleX).toBeCloseTo(1.6)
      expect(logo.scaleY).toBeCloseTo(1.6)
      expect(logo.sourceWidth).toBeGreaterThanOrEqual(logo.width * 1.6)
      expect(logo.sourceHeight).toBeGreaterThanOrEqual(logo.height * 1.6)
      expect((logo.x + logo.width) * logo.scaleX).toBeLessThanOrEqual(1728.001)
      expect((logo.y + logo.height) * logo.scaleY).toBeLessThanOrEqual(height + 0.001)
    }
  }
})
