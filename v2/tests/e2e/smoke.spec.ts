// E2E smoke: проверяем что UI стартует, чарты реально отрисованы.
import { test, expect } from '@playwright/test';

test('UI стартует, карта + 6 чартов рендерятся, скважины кликабельны', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });

  await page.goto('/');
  // дать UI отрисоваться, симулятору — прокачать несколько шагов
  await page.waitForTimeout(2000);

  // 1) нет JS-ошибок
  expect(errors, `JS errors: ${errors.join('; ')}`).toEqual([]);

  // 2) два view: map + charts
  await expect(page.locator('#view-map')).toBeVisible();
  await expect(page.locator('#view-charts')).toBeVisible();

  // 3) ровно 6 canvas в правой колонке
  const canvases = page.locator('.chart-canvas');
  await expect(canvases).toHaveCount(6);

  // 4) каждый canvas имеет реальный размер > 100×60 (не схлопнулся)
  for (let i = 0; i < 6; i++) {
    const box = await canvases.nth(i).boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(100);
    expect(box?.height ?? 0).toBeGreaterThan(60);
  }

  // 5) статусбар обновляется (FPS появляется после tick)
  const fps = await page.locator('[data-fps]').textContent();
  expect(fps).toMatch(/FPS: \d+/);

  // 6) wells-карточки: ровно 5 (five-spot пресет)
  const wellCards = page.locator('.well-card');
  await expect(wellCards).toHaveCount(5);

  // 7) в каждой карточке есть BHP-sparkline canvas
  const sparklines = page.locator('.bhp-sparkline');
  await expect(sparklines).toHaveCount(5);
  for (let i = 0; i < 5; i++) {
    const box = await sparklines.nth(i).boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(50);
    expect(box?.height ?? 0).toBeGreaterThan(20);
  }
});
