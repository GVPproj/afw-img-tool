import { expect, test } from '@playwright/test'

type RenderWindow = Window & { finishThumbnail?: (fail?: boolean) => void }

test('empty editor preserves its AFW controls on desktop and mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Visual references use desktop Chromium at explicit viewport sizes.')
  await page.goto('/')
  await page.evaluate(() => document.fonts.ready)

  for (const [name, width, height] of [['desktop', 1280, 900], ['mobile', 390, 844]] as const) {
    await page.setViewportSize({ width, height })
    await expect(page).toHaveScreenshot(`editor-${name}.png`, { fullPage: true })
  }
})

test('native controls keep keyboard selection, visible focus, and editable dates and times', async ({ page }) => {
  await page.goto('/')
  const colors = page.getByRole('group', { name: 'Color', exact: true })
  await colors.getByRole('radio', { name: 'Lime', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  const copper = colors.getByRole('radio', { name: 'Copper', exact: true })
  await expect(copper).toBeChecked()
  await expect(copper).toBeFocused()
  await expect(copper).toHaveCSS('outline-style', 'solid')
  await expect(copper).toHaveCSS('outline-color', 'rgb(226, 255, 120)')

  const duotone = page.getByRole('checkbox', { name: 'Duotone', exact: true })
  await duotone.focus()
  await page.keyboard.press('Space')
  await expect(duotone).toBeChecked()
  await expect(duotone).toHaveCSS('outline-width', '2px')
  await page.keyboard.press('Space')
  await expect(duotone).not.toBeChecked()

  const gradient = page.getByRole('checkbox', { name: 'Corner gradient', exact: true })
  await expect(gradient).toBeVisible()
  await expect(gradient).toHaveAccessibleDescription(/\S/)

  await page.getByRole('radio', { name: 'CC', exact: true }).check()
  await page.getByLabel('Show date', { exact: true }).fill('2026-11-10')
  await page.getByLabel('Host name', { exact: true }).fill('A Friendly Host')
  await page.getByLabel('Start time', { exact: true }).fill('16:00')
  await page.getByLabel('Finish time', { exact: true }).fill('17:00')
  await expect(page.getByLabel('Show date', { exact: true })).toHaveValue('2026-11-10')
  await expect(page.getByLabel('Host name', { exact: true })).toHaveValue('A Friendly Host')
  await expect(page.getByLabel('Start time', { exact: true })).toHaveValue('16:00')
  await expect(page.getByLabel('Finish time', { exact: true })).toHaveValue('17:00')
})

test('loading and retry controls remain readable and respect reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => {
    // Gate the browser encoder so loading and export failure are deterministic.
    const encode = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      encode.call(this, blob => {
        if (this.width === 1080 && this.height === 1080 && type === 'image/png') {
          const target = window as RenderWindow
          target.finishThumbnail = (fail = false) => {
            delete target.finishThumbnail
            callback(fail ? null : blob)
          }
        } else callback(blob)
      }, type, quality)
    }
  })
  await page.goto('/')
  const buffer = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 32
    return canvas.toDataURL().split(',')[1]
  }), 'base64')
  await page.getByLabel('Photo file').setInputFiles({ name: 'controls.png', mimeType: 'image/png', buffer })
  const pending = () => expect.poll(() => page.evaluate(() => Boolean((window as RenderWindow).finishThumbnail))).toBe(true)
  await pending()
  const busy = page.getByRole('button', { name: 'Download PNG' })
  await expect(busy).toBeDisabled()
  await expect(busy).toHaveAttribute('aria-busy', 'true')
  await expect(busy).toHaveCSS('opacity', '1')
  await expect(busy.locator('[aria-hidden="true"]')).toHaveCSS('animation-name', 'none')

  await page.evaluate(() => (window as RenderWindow).finishThumbnail!(true))
  const alert = page.getByRole('alert')
  await expect(alert).toBeVisible()
  await expect(alert).toHaveCSS('background-color', 'rgb(179, 68, 121)')
  const retry = alert.getByRole('button', { name: 'Retry preview' })
  await retry.focus()
  await expect(retry).toHaveCSS('outline-style', 'solid')
  await expect(retry).toHaveCSS('color', 'rgb(240, 240, 235)')
  await page.keyboard.press('Enter')
  await expect(alert).toHaveCount(0)
  await pending()
  await page.evaluate(() => (window as RenderWindow).finishThumbnail!())
  await expect(page.getByRole('link', { name: 'Download PNG' })).toHaveAttribute('download', 'controls_thumb.png')
})

test('forced colors keep checked controls and keyboard focus visible', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'Forced-colors visual checks use Chromium emulation.')
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  const duotone = page.getByRole('checkbox', { name: 'Duotone', exact: true })
  await duotone.focus()
  await page.keyboard.press('Space')
  await expect(duotone).toBeChecked()
  await expect(duotone).toHaveCSS('outline-style', 'solid')
  await expect(page.getByRole('button', { name: 'Download PNG' })).toBeDisabled()
  if (testInfo.project.name === 'chromium') {
    await expect(page.getByRole('complementary', { name: 'Settings' })).toHaveScreenshot('settings-forced-colors.png')
  }
})
