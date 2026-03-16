import { test, expect } from '@playwright/test';

// ── MOBILE LAYOUT TESTS ──

test.describe('Mobile layout', () => {
  test('shows icon feedback button and overflow menu', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 9999) >= 768, 'Mobile-only test (viewport < 768px)');
    await page.goto('/');

    // Feedback icon button should be visible (round dark button)
    await expect(page.locator('button[title="Request Feedback"]')).toBeVisible();

    // Desktop text buttons should NOT be visible
    await expect(page.locator('button:has-text("Import")')).not.toBeVisible();
    await expect(page.locator('button:has-text("Export")')).not.toBeVisible();
    await expect(page.locator('button:has-text("New")')).not.toBeVisible();
  });

  test('overflow menu has all actions', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 9999) >= 768, 'Mobile-only test (viewport < 768px)');
    await page.goto('/');

    // Click 3-dot menu (last button in header)
    const buttons = page.locator('header button');
    await buttons.last().click();

    await expect(page.locator('text=New Document')).toBeVisible();
    await expect(page.locator('text=Share')).toBeVisible();
    await expect(page.locator('text=Import from Google Docs')).toBeVisible();
    await expect(page.locator('text=Export PDF')).toBeVisible();
  });

  test('sidebar opens as fullscreen overlay', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 9999) >= 768, 'Mobile-only test (viewport < 768px)');
    await page.goto('/');

    // Sidebar should be closed by default
    await expect(page.locator('text=Your review team is ready')).not.toBeVisible();

    // Open sidebar via hamburger (second-to-last header button)
    const buttons = page.locator('header button');
    const count = await buttons.count();
    await buttons.nth(count - 2).click();

    // Sidebar overlay should be visible
    await expect(page.locator('text=Sidebar')).toBeVisible();
    await expect(page.locator('text=Your review team is ready')).toBeVisible();
  });

  test('sidebar close button works', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 9999) >= 768, 'Mobile-only test (viewport < 768px)');
    await page.goto('/');

    // Open sidebar
    const buttons = page.locator('header button');
    const count = await buttons.count();
    await buttons.nth(count - 2).click();
    await expect(page.locator('text=Sidebar')).toBeVisible();

    // Close it
    await page.locator('text=Sidebar').locator('..').locator('button').click();
    await expect(page.locator('text=Sidebar')).not.toBeVisible();
  });

  test('editor is full width', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 9999) >= 768, 'Mobile-only test (viewport < 768px)');
    await page.goto('/');

    const editor = page.locator('[data-slate-editor]');
    const editorBox = await editor.boundingBox();
    const viewport = page.viewportSize();
    if (editorBox && viewport) {
      expect(editorBox.width).toBeGreaterThan(viewport.width * 0.85);
    }
  });

  test('compact toolbar shows essential buttons only', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 9999) >= 768, 'Mobile-only test (viewport < 768px)');
    await page.goto('/');

    await expect(page.locator('button[title="Heading 1"]')).toBeVisible();
    await expect(page.locator('button[title="Bold"]')).toBeVisible();
    // Font selector and zoom should NOT be visible
    await expect(page.locator('button[title="Zoom in"]')).not.toBeVisible();
  });

  test('timeline scrubber is hidden', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 9999) >= 768, 'Mobile-only test (viewport < 768px)');
    await page.goto('/');
    await expect(page.locator('text=/Edit [Hh]istory/')).not.toBeVisible();
  });

  test('no horizontal scroll on any mobile size', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 9999) >= 768, 'Mobile-only test (viewport < 768px)');
    await page.goto('/');
    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasHorizontalScroll).toBe(false);
  });
});

// ── DESKTOP LAYOUT UNCHANGED ──

test.describe('Desktop layout preserved', () => {
  test('full header with all buttons', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 9999) < 768, 'Desktop-only test (viewport >= 768px)');
    await page.goto('/');

    await expect(page.locator('button:has-text("Import")')).toBeVisible();
    await expect(page.locator('button:has-text("Export")')).toBeVisible();
    await expect(page.locator('button:has-text("New")')).toBeVisible();
    await expect(page.locator('button:has-text("Share")')).toBeVisible();
    await expect(page.locator('button:has-text("Request Feedback")')).toBeVisible();
  });

  test('sidebar open by default', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 9999) < 768, 'Desktop-only test (viewport >= 768px)');
    await page.goto('/');
    await expect(page.locator('text=Your review team is ready')).toBeVisible();
  });

  test('full toolbar with font selector and zoom', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 9999) < 768, 'Desktop-only test (viewport >= 768px)');
    await page.goto('/');

    await expect(page.locator('button[title="Heading 3"]')).toBeVisible();
    await expect(page.locator('button[title="Insert Image"]')).toBeVisible();
    await expect(page.locator('button[title="Zoom in"]')).toBeVisible();
  });

  test('timeline scrubber visible', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 9999) < 768, 'Desktop-only test (viewport >= 768px)');
    await page.goto('/');
    await expect(page.locator('text=/Edit [Hh]istory/')).toBeVisible();
  });

  test('page container has expected width', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 9999) < 768, 'Desktop-only test (viewport >= 768px)');
    await page.goto('/');

    const pageContainer = page.locator('.page-container');
    const box = await pageContainer.boundingBox();
    if (box) {
      // Should be <= 816px and reasonably sized (may be constrained on narrow viewports like iPad Mini)
      expect(box.width).toBeLessThanOrEqual(816 + 1);
      expect(box.width).toBeGreaterThan(300);
    }
  });
});
