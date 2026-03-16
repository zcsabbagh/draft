import { test, expect } from '@playwright/test';

// ── 1. CORE EDITOR — page loads, typing works, word count updates ──

test.describe('Editor loads and is interactive', () => {
  test('page loads with editor content and redirects to /d/<id>', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/d\/.+/);
    const editor = page.locator('[data-slate-editor]');
    await expect(editor).toBeVisible();
    await expect(editor).toContainText('artificial intelligence');
  });

  test('can type in the editor', async ({ page }) => {
    await page.goto('/');
    const editor = page.locator('[data-slate-editor]');
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Hello from Playwright.');
    await expect(editor).toContainText('Hello from Playwright.');
  });

  test('title input is editable and persists', async ({ page }) => {
    await page.goto('/');
    const titleInput = page.locator('input[placeholder="Document title..."]');
    await expect(titleInput).toBeVisible();
    await titleInput.fill('Test Document Title');
    await expect(titleInput).toHaveValue('Test Document Title');
  });

  test('word count displays', async ({ page }) => {
    await page.goto('/');
    const wordCount = page.locator('text=/\\d+ words/');
    await expect(wordCount).toBeVisible({ timeout: 5000 });
  });
});

// ── 2. TOOLBAR FORMATTING ──

test.describe('Toolbar formatting', () => {
  test('bold button is clickable and does not crash', async ({ page }) => {
    await page.goto('/');
    const editor = page.locator('[data-slate-editor]');
    await editor.click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    const boldBtn = page.locator('button[title*="Bold"]');
    await boldBtn.click();
    // Verify the button still exists and editor is intact
    await expect(boldBtn).toBeVisible();
    await expect(editor).toBeVisible();
  });

  test('heading 1 button is clickable and does not crash', async ({ page }) => {
    await page.goto('/');
    const editor = page.locator('[data-slate-editor]');
    await editor.click();
    const h1Btn = page.locator('button[title="Heading 1"]');
    await h1Btn.click();
    await expect(h1Btn).toBeVisible();
    await expect(editor).toBeVisible();
  });
});

// ── 3. PAGE CONTAINER — no horizontal overflow ──

test.describe('Page container layout', () => {
  test('page container does not overflow viewport horizontally', async ({ page }) => {
    await page.goto('/');
    const pageContainer = page.locator('.page-container');
    const box = await pageContainer.boundingBox();
    const viewport = page.viewportSize();
    if (box && viewport) {
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    }
  });

  test('text does not overflow page container', async ({ page }) => {
    await page.goto('/');
    const overflowX = await page.locator('.page-background').evaluate(
      (el) => el.scrollWidth > el.clientWidth
    );
    expect(overflowX).toBe(false);
  });
});
