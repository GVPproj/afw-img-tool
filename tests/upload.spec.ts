import { expect, test } from '@playwright/test'

test('empty preview is compact and opens the file picker', async ({ page }) => {
  await page.goto('/')
  const area = page.locator('.empty-preview')
  const height = await area.evaluate(element => element.getBoundingClientRect().height)
  const viewportHeight = await page.evaluate(() => innerHeight)
  expect(height).toBeLessThanOrEqual(Math.min(viewportHeight * 0.275, 288) + 1)
  const picker = page.waitForEvent('filechooser')
  await area.click()
  expect((await picker).isMultiple()).toBe(false)
})

test('empty preview accepts dropped files and recovers from invalid files', async ({ page }) => {
  await page.goto('/')
  const area = page.locator('.empty-preview')
  const drop = async (valid: boolean) => {
    const dataTransfer = await page.evaluateHandle(async valid => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 32
      const blob = valid ? await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!))) : new Blob(['invalid'])
      const transfer = new DataTransfer()
      transfer.items.add(new File([blob], valid ? 'dropped.png' : 'broken.png', { type: 'image/png' }))
      return transfer
    }, valid)
    await area.dispatchEvent('dragover', { dataTransfer })
    await expect(area).toHaveClass(/is-dragging/)
    await area.dispatchEvent('drop', { dataTransfer })
    await dataTransfer.dispose()
  }
  await drop(false)
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(area).not.toHaveClass(/is-dragging/)
  await drop(true)
  await expect(page.getByText('dropped.png · 32 × 32')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Download PNG' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})
