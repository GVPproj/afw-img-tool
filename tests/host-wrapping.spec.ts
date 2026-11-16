import { expect, test } from '@playwright/test'

for (const station of ['CHIR FM', 'Sunday']) {
  for (const format of ['Square', '4:5']) {
    for (const kind of ['multiword', 'unbroken', 'exceptional']) {
      test(`${station} ${format} wraps ${kind} hosts without overflow`, async ({ page }) => {
        await page.addInitScript(() => {
          const originalDrawImage = CanvasRenderingContext2D.prototype.drawImage
          ;(window as any).logoCalls = []
          CanvasRenderingContext2D.prototype.drawImage = function (...args: any[]) {
            // Trimmed artwork is drawn with the five-argument overload in design units.
            if (args.length === 5) {
              const [, x, y, width, height] = args
              ;(window as any).logoCalls.push({ x, y, width, height, scale: this.getTransform().a })
            }
            originalDrawImage.apply(this, args as any)
          }
          const original = CanvasRenderingContext2D.prototype.fillText
          ;(window as any).textCalls = []
          CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
            const metrics = this.measureText(text)
            ;(window as any).textCalls.push({ text, x, y, maxWidth, width: metrics.width,
              top: y - metrics.actualBoundingBoxAscent, bottom: y + metrics.actualBoundingBoxDescent,
              fontSize: parseFloat(this.font), scale: this.getTransform().a })
            if (maxWidth === undefined) original.call(this, text, x, y)
            else original.call(this, text, x, y, maxWidth)
          }
        })
        await page.goto('/')
        await page.getByRole('radio', { name: station, exact: true }).check()
        await page.getByRole('radio', { name: format, exact: true }).check()
        const host = kind === 'multiword' ? 'The Friendly Jazz Caravan Orchestra featuring Many Special Guests'
          : 'W'.repeat(kind === 'exceptional' ? 4000 : 160)
        // Exercise the renderer beyond the UI's normal 120-character guard as well.
        await page.getByLabel('Host name').evaluate(input => input.removeAttribute('maxlength'))
        await page.getByLabel('Host name').fill(host)
        await page.getByLabel('Show date').fill('2026-11-15')
        const base64 = await page.evaluate(() => {
          const canvas = document.createElement('canvas')
          canvas.width = 1080
          canvas.height = 1350
          return canvas.toDataURL().split(',')[1]
        })
        await page.getByLabel('Photo file').setInputFiles({ name: 'host.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') })
        await expect(page.getByRole('link', { name: 'Download PNG' })).toBeVisible()
        const calls = await page.evaluate(() => {
          const calls = (window as any).textCalls as any[]
          const start = calls.map(call => call.text.startsWith('A Friendly Wave')).lastIndexOf(true)
          return calls.slice(start)
        })
        const sunday = station === 'Sunday'
        // Text metrics are in design units, with the export transform applied later.
        expect(calls[0].scale).toBeCloseTo(1.6)
        const height = format === 'Square' ? 1080 : 1350
        const hosts = sunday ? calls.slice(2, -3) : calls.slice(4, -1)
        expect(hosts.length).toBeGreaterThan(1)
        expect(hosts.map((call: any) => call.text).join('').replace(/\s/g, '')).toBe((sunday ? 'with' : '') + host.replace(/\s/g, ''))
        for (const call of hosts) {
          expect(call.maxWidth).toBeUndefined()
          expect(call.x).toBe(sunday ? 28 : 16)
          expect(call.width).toBeLessThanOrEqual(sunday ? 510 : 500)
          expect(call.top).toBeGreaterThanOrEqual(0)
          expect(call.bottom).toBeLessThan(height - 20)
          expect(call.fontSize).toBe(kind === 'exceptional' ? hosts[0].fontSize : 44)
        }
        if (kind === 'exceptional') expect(hosts[0].fontSize).toBeLessThan(44)
        for (let index = 1; index < hosts.length; index++) {
          expect(hosts[index].top).toBeGreaterThanOrEqual(hosts[index - 1].bottom)
        }
        if (sunday) {
          expect(calls[0].y).toBeLessThan(height - 184)
          expect(calls.at(-3).y).toBe(height - 184)
          expect(calls.at(-2).y).toBe(height - 130)
          expect(calls.at(-1).y).toBe(height - 76)
          expect(hosts.at(-1).y + 54 * hosts.at(-1).fontSize / 44).toBeCloseTo(height - 22, 2)
        } else {
          expect(calls.at(-1).top).toBeGreaterThanOrEqual(hosts.at(-1).bottom)
          const logo = await page.evaluate(() => (window as any).logoCalls.findLast((call: any) => call.x === 24 && call.width === 198))
          expect(logo).toBeDefined()
          expect(logo.scale).toBeCloseTo(1.6)
          expect(logo.y + logo.height).toBe(height - 20)
          // Use the trimmed logo's actual top, not its width as an assumed height.
          expect(calls.at(-1).bottom + 20).toBeLessThanOrEqual(logo.y)
        }
      })
    }
  }
}
