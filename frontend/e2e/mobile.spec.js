// Phone-viewport audit: every page at every project must fit the viewport
// (no horizontal scroll) and its primary tap targets must be big enough.
// Each test also drops a screenshot in e2e/shots/<project>/ for eyeballing.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const SHOTS = path.join(process.cwd(), 'e2e', 'shots');
const MIN_TAP = 40; // px; Apple HIG says 44, Material says 48 — 40 leaves room for borders

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(400);
}

async function shot(page, project, name) {
  const dir = path.join(SHOTS, project);
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: false });
}

async function overflow(page) {
  return page.evaluate(() => {
    const el = document.documentElement;
    return Math.max(0, el.scrollWidth - el.clientWidth);
  });
}

// Elements that poke outside the viewport horizontally, for the failure message.
async function offenders(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.right > vw + 1 || r.left < -1) {
        const cls = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '';
        out.push(`${el.tagName.toLowerCase()}${cls} [${Math.round(r.left)}..${Math.round(r.right)}]`);
      }
      if (out.length >= 8) break;
    }
    return out;
  });
}

async function expectFits(page, label) {
  const ov = await overflow(page);
  if (ov > 0) {
    const who = await offenders(page);
    expect(ov, `${label}: ${ov}px horizontal overflow; offenders:\n  ${who.join('\n  ')}`).toBe(0);
  }
}

// Every visible <button> / <a> that carries a role-ish class must be tappable.
async function expectTappable(page, selector, label) {
  const small = await page.evaluate(({ selector, min }) => {
    const bad = [];
    for (const el of document.querySelectorAll(selector)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < min || r.width < min) bad.push(`${el.textContent.trim().slice(0, 20) || el.title || el.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return bad;
  }, { selector, min: MIN_TAP });
  expect(small, `${label}: tap targets under ${MIN_TAP}px:\n  ${small.join('\n  ')}`).toEqual([]);
}

const isMobile = (project) => project !== 'desktop';

const PAGES = [
  { path: '/',           name: 'dashboard' },
  { path: '/routes',     name: 'routes' },
  { path: '/analytics',  name: 'analytics' },
  { path: '/containers', name: 'containers' },
  { path: '/events',     name: 'events' },
  { path: '/images',     name: 'images' },
  { path: '/volumes',    name: 'volumes' },
  { path: '/networks',   name: 'networks' },
  { path: '/settings',   name: 'settings' },
];

for (const p of PAGES) {
  test(`${p.name} fits the viewport`, async ({ page }, info) => {
    await page.goto(p.path);
    await settle(page);
    await shot(page, info.project.name, p.name);
    await expectFits(page, p.name);
  });
}

test('dashboard: expanded row fits and its actions are tappable', async ({ page }, info) => {
  await page.goto('/');
  await settle(page);
  // Click the name, not the row centre: on phones the centre is the URL link.
  await page.locator('.row .name').first().click();
  await expect(page.locator('.row-wrap.expanded .detail').first()).toBeVisible();
  await page.waitForTimeout(300);
  await shot(page, info.project.name, 'dashboard-expanded');
  await expectFits(page, 'dashboard-expanded');
  if (isMobile(info.project.name)) await expectTappable(page, '.row .icon-btn', 'dashboard row actions');
});

test('dashboard: add-route modal fits', async ({ page }, info) => {
  await page.goto('/');
  await settle(page);
  await page.getByRole('button', { name: /add manual route/i }).click();
  const modal = page.locator('.modal');
  await expect(modal).toBeVisible();
  await shot(page, info.project.name, 'dashboard-modal');
  await expectFits(page, 'dashboard-modal');
  const box = await modal.boundingBox();
  const vp = page.viewportSize();
  expect(box.x, 'modal left edge inside viewport').toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, 'modal right edge inside viewport').toBeLessThanOrEqual(vp.width);
  expect(box.y + box.height, 'modal bottom edge inside viewport').toBeLessThanOrEqual(vp.height + 1);
});

test('nav: phones get a drawer, desktop keeps the sidebar', async ({ page }, info) => {
  await page.goto('/');
  await settle(page);
  const mainBox = await page.locator('main').boundingBox();
  const vp = page.viewportSize();
  await shot(page, info.project.name, 'nav');
  if (isMobile(info.project.name)) {
    expect(mainBox.width, 'main should get (almost) the full viewport width on phones').toBeGreaterThanOrEqual(vp.width * 0.9);
    const menu = page.getByRole('button', { name: /open menu/i });
    await expect(menu).toBeVisible();
    await expectTappable(page, '.menu-btn', 'menu button');
    await menu.click();
    await page.waitForTimeout(350);
    await expect(page.locator('aside')).toBeInViewport();
    await shot(page, info.project.name, 'nav-drawer');
    await expectFits(page, 'nav-drawer');
    await expectTappable(page, 'nav a', 'nav links');
    // Navigating closes the drawer again.
    await page.locator('nav a', { hasText: 'Routes' }).click();
    await page.waitForTimeout(400);
    await expect(page.locator('aside')).not.toBeInViewport();
    expect(page.url()).toMatch(/\/routes$/);
  } else {
    expect(mainBox.x, 'desktop keeps the sidebar').toBeGreaterThanOrEqual(150);
    await expect(page.getByRole('button', { name: /open menu/i })).toBeHidden();
  }
});

test.describe('container detail', () => {
  let id;
  test.beforeAll(async ({ request, baseURL }) => {
    const res = await request.get(new URL('/api/containers', baseURL).toString());
    const list = await res.json();
    id = (list.find((c) => c.running && c.port) ?? list.find((c) => c.running) ?? list[0])?.id;
    test.skip(!id, 'no containers to look at');
  });

  for (const tab of ['overview', 'history', 'logs', 'inspect', 'terminal']) {
    test(`${tab} tab fits`, async ({ page }, info) => {
      await page.goto(`/containers/${id}`);
      await settle(page);
      if (tab !== 'overview') {
        const btn = page.getByRole('button', { name: new RegExp(`^${tab}$`, 'i') });
        // A tab that cannot be reached is a bug in its own right (pushed out of the
        // viewport by a non-wrapping tab bar); say so instead of timing out. The
        // strip may scroll sideways, so scroll first, then require it in view.
        await btn.scrollIntoViewIfNeeded();
        const box = await btn.boundingBox();
        const vp = page.viewportSize();
        expect(box && box.x >= 0 && box.x + box.width <= vp.width, `${tab} tab is outside the viewport (x=${box?.x}, w=${box?.width}, vw=${vp.width})`).toBe(true);
        await btn.click({ timeout: 5000 });
        await page.waitForTimeout(tab === 'terminal' ? 1200 : 600);
      }
      await shot(page, info.project.name, `container-${tab}`);
      await expectFits(page, `container-${tab}`);
      if (isMobile(info.project.name)) await expectTappable(page, '.tabs .tab', 'detail tabs');
    });
  }
});
