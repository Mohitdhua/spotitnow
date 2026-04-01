import { expect, test, type Page } from 'playwright/test';

const tinyPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+iK0QAAAAASUVORK5CYII=';

const createPuzzleImportFile = (puzzleCount = 1) => ({
  name: 'puzzle-batch.json',
  mimeType: 'application/json',
  buffer: Buffer.from(
    JSON.stringify({
      title: 'Playwright Puzzle Batch',
      version: 1,
      puzzles: Array.from({ length: puzzleCount }, (_, index) => ({
        title: `Playwright Puzzle ${index + 1}`,
        imageA: tinyPng,
        imageB: tinyPng,
        regions: [{ id: `r${index + 1}`, x: 0, y: 0, width: 1, height: 1 }]
      }))
    })
  )
});

const importPuzzleBatch = async (page: Page, puzzleCount = 1) => {
  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles(createPuzzleImportFile(puzzleCount));
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

test.describe('mobile video routing', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true
  });

  test('create upload keeps workflow cards inside the mobile viewport', async ({ page }) => {
    await page.goto('/create/upload');
    await expect(page).toHaveURL(/\/create\/upload$/);
    await expect(page.getByRole('heading', { name: /upload pairs/i })).toBeVisible();
    await expect(page.getByText(/^manual first$/i)).toBeVisible();
    await expect(page.getByText(/^ultra fast$/i)).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    );

    expect(hasHorizontalOverflow).toBe(false);
  });

  test('video setup stacks 16:9 live and export previews vertically on mobile', async ({ page }) => {
    await importPuzzleBatch(page, 2);

    await page.getByRole('link', { name: /build video/i }).click();
    await expect(page).toHaveURL(/\/video\/setup$/);

    const liveFrame = page.locator('[data-preview-frame="live"]:visible').first();
    const exportFrame = page.locator('[data-preview-frame="export"]:visible').first();
    const liveStage = liveFrame.locator('[data-video-stage-shell="embedded"]').first();
    const exportImage = exportFrame.locator('img[alt="Export frame preview"]').first();

    await expect(liveFrame).toBeVisible();
    await expect(exportFrame).toBeVisible();
    await expect(liveStage).toBeVisible();
    await expect(exportImage).toBeVisible();

    const liveBox = await liveFrame.boundingBox();
    const exportBox = await exportFrame.boundingBox();
    const liveStageBox = await liveStage.boundingBox();
    const exportImageBox = await exportImage.boundingBox();

    expect(liveBox).not.toBeNull();
    expect(exportBox).not.toBeNull();
    expect(liveStageBox).not.toBeNull();
    expect(exportImageBox).not.toBeNull();

    if (!liveBox || !exportBox || !liveStageBox || !exportImageBox) {
      throw new Error('Expected mobile preview frames to be visible.');
    }

    const viewportWidth = page.viewportSize()?.width ?? 390;
    const viewportHeight = page.viewportSize()?.height ?? 844;

    expect(liveBox.width).toBeLessThan(viewportWidth - 40);
    expect(exportBox.width).toBeLessThan(viewportWidth - 40);
    expect(liveBox.height).toBeLessThan(viewportHeight * 0.2);
    expect(exportBox.height).toBeLessThan(viewportHeight * 0.2);
    expect(liveStageBox.width).toBeLessThanOrEqual(liveBox.width + 1);
    expect(liveStageBox.height).toBeLessThanOrEqual(liveBox.height + 1);
    expect(exportImageBox.width).toBeLessThanOrEqual(exportBox.width + 1);
    expect(exportImageBox.height).toBeLessThanOrEqual(exportBox.height + 1);
    expect(Math.abs(exportBox.x - liveBox.x)).toBeLessThan(4);
    expect(exportBox.y).toBeGreaterThan(liveBox.y + liveBox.height - 4);
  });

  test('video setup mobile header can jump to upload for adding puzzles', async ({ page }) => {
    await importPuzzleBatch(page, 2);

    await page.getByRole('link', { name: /build video/i }).click();
    await expect(page).toHaveURL(/\/video\/setup$/);

    await page.getByRole('button', { name: /add more puzzles/i }).click();

    await expect(page).toHaveURL(/\/create\/upload$/);
    await expect(page.getByRole('heading', { name: /upload pairs/i })).toBeVisible();
  });

  test('video setup mobile header can clear the loaded batch', async ({ page }) => {
    await importPuzzleBatch(page, 2);

    await page.getByRole('link', { name: /build video/i }).click();
    await expect(page).toHaveURL(/\/video\/setup$/);

    await page.getByRole('button', { name: /clear batch/i }).click();

    const confirmDialog = page.getByRole('alertdialog');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: /^clear$/i }).click();

    await expect(page.locator('[data-mobile-puzzle-count]')).toHaveText(/^0 puzzles$/i);
    await expect(page.getByText(/add puzzles for live preview/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^start$/i })).toBeDisabled();
  });

  test('video setup shows rendering while aspect ratio previews rebuild on mobile', async ({ page }) => {
    await importPuzzleBatch(page, 3);

    await page.getByRole('link', { name: /build video/i }).click();
    await expect(page).toHaveURL(/\/video\/setup$/);

    const liveFrame = page.locator('[data-preview-frame="live"]:visible').first();
    const liveStage = liveFrame.locator('[data-video-stage-shell="embedded"]').first();
    const liveRendering = liveFrame.getByText(/^Rendering\.\.\.$/i);

    await page.getByRole('button', { name: /9:16/i }).first().click();
    await expect(liveRendering).not.toHaveCount(0);
    await page.waitForTimeout(1000);

    let liveBox = await liveFrame.boundingBox();
    let liveStageBox = await liveStage.boundingBox();

    expect(liveBox).not.toBeNull();
    expect(liveStageBox).not.toBeNull();

    if (!liveBox || !liveStageBox) {
      throw new Error('Expected live preview frame and stage after switching to 9:16.');
    }

    expect(liveStageBox.width).toBeLessThanOrEqual(liveBox.width + 1);
    expect(liveStageBox.height).toBeLessThanOrEqual(liveBox.height + 1);

    await page.getByRole('button', { name: /16:9/i }).first().click();
    await expect(liveRendering).not.toHaveCount(0);
    await page.waitForTimeout(1000);

    liveBox = await liveFrame.boundingBox();
    liveStageBox = await liveStage.boundingBox();

    expect(liveBox).not.toBeNull();
    expect(liveStageBox).not.toBeNull();

    if (!liveBox || !liveStageBox) {
      throw new Error('Expected live preview frame and stage after switching back to 16:9.');
    }

    expect(liveStageBox.width).toBeLessThanOrEqual(liveBox.width + 1);
    expect(liveStageBox.height).toBeLessThanOrEqual(liveBox.height + 1);
  });

  test('video setup keeps live preview instant for non-ratio style changes on mobile', async ({ page }) => {
    await importPuzzleBatch(page, 2);

    await page.getByRole('link', { name: /build video/i }).click();
    await expect(page).toHaveURL(/\/video\/setup$/);

    const liveFrame = page.locator('[data-preview-frame="live"]:visible').first();
    const liveRendering = liveFrame.getByText(/^Rendering\.\.\.$/i);

    await page.getByRole('button', { name: /^theme$/i }).click();
    await expect(page.getByRole('button', { name: /generate style/i })).toBeVisible();

    await page.getByRole('button', { name: /generate style/i }).click();
    await page.waitForTimeout(400);

    await expect(liveRendering).toHaveCount(0);
  });

  test('video flow can still switch to other modes with multiple puzzles loaded', async ({ page }) => {
    const bottomNav = page.getByRole('navigation');

    await importPuzzleBatch(page, 3);

    await page.getByRole('link', { name: /build video/i }).click();
    await expect(page).toHaveURL(/\/video\/setup$/);
    await expect(page.getByRole('button', { name: /^start$/i })).toBeVisible();

    await bottomNav.getByRole('link', { name: /^editor$/i }).click();
    await expect(page.getByRole('heading', { name: /manual edit and cleanup/i })).toBeVisible({
      timeout: 5000
    });

    await bottomNav.getByRole('link', { name: /^video$/i }).click();
    await expect(page).toHaveURL(/\/video\/setup$/);

    await bottomNav.getByRole('link', { name: /^settings$/i }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await page.getByRole('button', { name: /^cancel$/i }).click();

    await bottomNav.getByRole('link', { name: /^video$/i }).click();
    await expect(page).toHaveURL(/\/video\/setup$/);

    await page.getByRole('button', { name: /^start$/i }).click();
    await expect(page).toHaveURL(/\/video\/preview$/);

    await bottomNav.getByRole('link', { name: /^studio$/i }).click();
    await expect(page).toHaveURL(/\/$/);

    await bottomNav.getByRole('link', { name: /^video$/i }).click();
    await expect(page).toHaveURL(/\/video\/setup$/);

    await page.getByRole('button', { name: /^start$/i }).click();
    await expect(page).toHaveURL(/\/video\/preview$/);

    await page.getByRole('button', { name: /send to editor/i }).click();
    await expect(page).toHaveURL(/\/editor$/);
    await expect(page.getByRole('heading', { name: /editor mode/i })).toBeVisible();

    await bottomNav.getByRole('link', { name: /^studio$/i }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
