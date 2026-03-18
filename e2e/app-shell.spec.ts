import { expect, test, type Page } from 'playwright/test';

const tinyPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+iK0QAAAAASUVORK5CYII=';

const createPuzzleImportFile = () => ({
  name: 'puzzle-batch.json',
  mimeType: 'application/json',
  buffer: Buffer.from(
    JSON.stringify({
      title: 'Playwright Puzzle Batch',
      version: 1,
      puzzles: [
        {
          title: 'Playwright Puzzle',
          imageA: tinyPng,
          imageB: tinyPng,
          regions: [{ id: 'r1', x: 0, y: 0, width: 1, height: 1 }]
        }
      ]
    })
  )
});

const importPuzzleBatch = async (page: Page) => {
  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles(createPuzzleImportFile());
  await expect(page.getByRole('heading', { name: /review detection and choose the next move/i })).toBeVisible();
};

test('dashboard workflow cards launch the routed create flow', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /create, review, and export spot-the-difference content/i })).toBeVisible();
  await page.getByRole('link', { name: /create puzzle/i }).click();
  await expect(page.getByRole('heading', { name: /upload pairs/i })).toBeVisible();
});

test('imported puzzle batch survives into the routed video setup flow', async ({ page }) => {
  await importPuzzleBatch(page);
  await expect(page.getByText(/1 diff/i)).toBeVisible();
  await page.getByRole('link', { name: /build video/i }).click();
  await expect(page.getByText(/production setup/i)).toBeVisible();
});

test('browser back and forward keep routed workflow pages valid', async ({ page }) => {
  await importPuzzleBatch(page);
  await page.getByRole('link', { name: /manual edit/i }).click();
  await expect(page.getByRole('heading', { name: /manual edit and cleanup/i })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: /review detection and choose the next move/i })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: /manual edit and cleanup/i })).toBeVisible();
});
