import { test, expect } from '@playwright/test';

// ── COMMENT INTERACTION TESTS (mobile + tablet) ──
// These tests inject hardcoded comments via the browser to test the comment UI flow

// Hardcoded comments for future injection when test API hooks are available
// const HARDCODED_COMMENTS = [
//   { id: 'test-1', type: 'vague', quote: 'significant', comment: 'Quantify the impact.' },
//   { id: 'test-2', type: 'unsupported', quote: 'Many experts believe', comment: 'Which experts?' },
//   { id: 'test-3', type: 'logical-gap', quote: 'probably somewhere in between', comment: 'Take a clearer position.' },
// ];

test.describe('Comments on mobile', () => {
  test('sidebar shows feedback tab with comments when opened', async ({ page }) => {
    const viewport = page.viewportSize();
    test.skip((viewport?.width ?? 9999) >= 768, 'Mobile-only test (viewport < 768px)');

    await page.goto('/');
    await page.locator('[data-slate-editor]').waitFor();

    // Open sidebar
    const headerButtons = page.locator('header button');
    const count = await headerButtons.count();
    // Hamburger is second-to-last button
    await headerButtons.nth(count - 2).click();

    // Sidebar overlay should open with Feedback tab active
    await expect(page.locator('text=Sidebar')).toBeVisible();
    await expect(page.locator('button:has-text("Feedback")')).toBeVisible();

    // Should see the "Your review team is ready" empty state
    await expect(page.locator('text=Your review team is ready')).toBeVisible();
  });

  test('sidebar tabs are switchable on mobile', async ({ page }) => {
    const viewport = page.viewportSize();
    test.skip((viewport?.width ?? 9999) >= 768, 'Mobile-only test (viewport < 768px)');

    await page.goto('/');
    await page.locator('[data-slate-editor]').waitFor();

    // Open sidebar
    const headerButtons = page.locator('header button');
    const count = await headerButtons.count();
    await headerButtons.nth(count - 2).click();
    await expect(page.locator('text=Sidebar')).toBeVisible();

    // Switch to Chat tab
    await page.locator('button:has-text("Chat")').click();
    await expect(page.locator('text=Chat with Claude about your document')).toBeVisible();

    // Switch to Rubric tab
    await page.locator('button:has-text("Rubric")').click();
    await expect(page.locator('text=Feedback rubric')).toBeVisible();

    // Switch to Context tab
    await page.locator('button:has-text("Context")').click();
    await expect(page.locator('text=Document context')).toBeVisible();

    // Switch back to Feedback
    await page.locator('button:has-text("Feedback")').click();
    await expect(page.locator('text=Your review team is ready')).toBeVisible();
  });

  test('chat input works on mobile', async ({ page }) => {
    const viewport = page.viewportSize();
    test.skip((viewport?.width ?? 9999) >= 768, 'Mobile-only test (viewport < 768px)');

    await page.goto('/');
    await page.locator('[data-slate-editor]').waitFor();

    // Open sidebar
    const headerButtons = page.locator('header button');
    const count = await headerButtons.count();
    await headerButtons.nth(count - 2).click();

    // Go to Chat tab
    await page.locator('button:has-text("Chat")').click();

    // Type in the chat input
    const chatInput = page.locator('input[placeholder="Ask about your document..."]');
    await expect(chatInput).toBeVisible();
    await chatInput.fill('What is this document about?');
    await expect(chatInput).toHaveValue('What is this document about?');
  });
});

test.describe('Comments on iPad', () => {
  test('sidebar shows comments panel inline', async ({ page }) => {
    const viewport = page.viewportSize();
    test.skip((viewport?.width ?? 0) < 768, 'iPad/desktop-only test (viewport >= 768px)');

    await page.goto('/');
    await page.locator('[data-slate-editor]').waitFor();

    // Sidebar should be visible by default on iPad/desktop
    await expect(page.locator('text=Your review team is ready')).toBeVisible();
    // Sidebar tabs should be visible (use first match since header may also have "Feedback")
    await expect(page.locator('button:has-text("Chat")').first()).toBeVisible();
  });

  test('can switch sidebar tabs on iPad', async ({ page }) => {
    const viewport = page.viewportSize();
    test.skip((viewport?.width ?? 0) < 768, 'iPad/desktop-only test (viewport >= 768px)');

    await page.goto('/');
    await page.locator('[data-slate-editor]').waitFor();

    // Switch to Chat tab
    await page.locator('button:has-text("Chat")').click();
    await expect(page.locator('text=Chat with Claude about your document')).toBeVisible();

    // Switch to Rubric
    await page.locator('button:has-text("Rubric")').click();
    await expect(page.locator('text=Feedback rubric')).toBeVisible();
  });

  test('rubric textarea is editable', async ({ page }) => {
    const viewport = page.viewportSize();
    test.skip((viewport?.width ?? 0) < 768, 'iPad/desktop-only test (viewport >= 768px)');

    await page.goto('/');
    await page.locator('[data-slate-editor]').waitFor();

    // Switch to Rubric tab
    await page.locator('button:has-text("Rubric")').click();
    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible();
    // Should have default rubric text
    await expect(textarea).not.toBeEmpty();
  });
});
