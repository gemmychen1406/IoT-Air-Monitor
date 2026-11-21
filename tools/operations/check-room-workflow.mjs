// Run from the repository root against a dedicated, migrated PostgreSQL database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { createDatabase } from '@iot/database';
import { hashSecret, newSecret } from '../../apps/api/src/modules/auth.ts';
import { createRuntime } from '../../apps/api/src/runtime.ts';
import { featureFixture } from '../../apps/api/tests/helpers.ts';

const url = process.env.TEST_ROOM_BROWSER_DATABASE_URL;
if (!url || url === process.env.DATABASE_URL)
  throw new Error('Set a separate TEST_ROOM_BROWSER_DATABASE_URL.');
const db = createDatabase(url);
const origin = 'http://127.0.0.1:5276';
const backend = 'http://127.0.0.1:4406';
const originalFetch = globalThis.fetch;
globalThis.fetch = (url, options) =>
  String(url).startsWith('https://api.telegram.org/')
    ? Promise.resolve(Response.json({ ok: true, result: { message_id: 1 } }))
    : originalFetch(url, options);
const runtime = createRuntime(db, origin, {
  telegram: { token: 'mock', chatId: '-1', includeSimulators: true },
});
let browser, web;
try {
  await new Promise((resolve, reject) =>
    runtime.http.once('error', reject).listen(4406, '127.0.0.1', resolve),
  );
  web = await createServer({
    root: 'apps/web',
    configFile: 'apps/web/vite.config.ts',
    server: {
      host: '127.0.0.1',
      port: 5276,
      strictPort: true,
      proxy: { '/api': backend, '/socket.io': { target: backend, ws: true } },
    },
  });
  await web.listen();
  browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE || undefined,
    headless: true,
  });
  for (const width of [1440, 390]) {
    const prefix = 'map-' + width + '-' + randomUUID().slice(0, 8);
    const f = await featureFixture(db, runtime.app, prefix);
    const ctx = await browser.newContext({
      viewport: { width, height: 850 },
      hasTouch: width < 500,
    });
    async function login(role) {
      const token = f.headers[role].Cookie.split('=')[1];
      await ctx.addCookies([{ name: 'iot_session', value: token, url: origin, httpOnly: true }]);
    }
    await login('admin');
    const page = await ctx.newPage();
    const roomName = 'Phòng demo';
    await page.goto(origin + '/app/spaces');
    await page.getByRole('button', { name: 'Thêm khu vực', exact: true }).click();
    await page.getByLabel('Tên khu vực').fill(prefix);
    await page.getByRole('button', { name: 'Lưu khu vực' }).click();
    const areaLink = page.locator('.ag-space-list a').filter({ hasText: prefix });
    await areaLink.click();
    const areaUrl = page.url();
    await page.getByRole('button', { name: 'Thêm phòng', exact: true }).click();
    await expect(page.getByRole('heading', {name: 'Thêm phòng vào ' + prefix})).toBeVisible();
    await page.getByLabel('Tên phòng').fill(roomName);
    await page.route('**/api/v1/spaces/rooms', route => route.fulfill({
      status: 409, json: {error:{message:'Tên phòng đã tồn tại.'}},
    }), {times:1});
    await page.getByRole('button', { name: 'Lưu phòng' }).click();
    await expect(page.getByLabel('Tên phòng')).toHaveValue(roomName);
    await expect(page.getByRole('alert')).toContainText('Tên phòng đã tồn tại');
    await page.route('**/api/v1/spaces/areas/*/map', route => route.fulfill({
      status: 503, json: {error:{message:'Lỗi đọc sơ đồ'}},
    }));
    await page.getByRole('button', { name: 'Lưu phòng' }).click();
    const room = page.getByRole('article', { name: roomName });
    await expect(room).toContainText('0 thiết bị');
    const areaId = areaUrl.split('/').at(-1);
    await expect(page.getByLabel('Tên phòng')).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText('Lỗi đọc sơ đồ', {timeout:15000});
    await page.unroute('**/api/v1/spaces/areas/*/map');
    await page.getByRole('button', {name:'Thử lại'}).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    const roomId = (
      await (await ctx.request.get(backend + '/api/v1/spaces')).json()
    ).data.rooms.find((r) => r.area_id === areaId).id;
    const headers = { 'X-Requested-With': 'AirGuard' };
    const checkGrid = async (count) => {
      const cards = page.locator('.ag-map-room');
      await expect(cards).toHaveCount(count);
      const rects = await cards.evaluateAll((nodes) =>
        nodes.map((n) => {
          const r = n.getBoundingClientRect();
          const grid = n.querySelector('.ag-map-canvas').getBoundingClientRect();
          return {
            x: r.x,
            y: r.y,
            b: r.bottom,
            contains: grid.left >= r.left && grid.right <= r.right && grid.bottom <= r.bottom,
          };
        }),
      );
      assert(rects.every((r) => r.contains));
      const cols = width === 1440 ? 2 : 1;
      for (let n = 0; n < count; n++) {
        if (n % cols === 1) assert.equal(rects[n].y, rects[n - 1].y);
        if (n >= cols) assert(rects[n].y >= rects[n - cols].b);
      }
      return rects;
    };
    await checkGrid(1);
    for (let n = 2; n <= 5; n++) {
      assert(
        (
          await ctx.request.post(backend + '/api/v1/spaces/rooms', {
            headers,
            data: { area_id: areaId, name: 'Z ' + n },
          })
        ).ok(),
      );
      if (n === 3 || n === 5) {
        await page.reload();
        await checkGrid(n);
      }
    }
    const before = await checkGrid(5);
    for (let n = 0; n < 4; n++) {
      const created = await ctx.request.post(backend + '/api/v1/devices', {
        headers,
        data: { name: prefix + ' unplaced long name ' + n, source_kind: 'simulator' },
      });
      const id = (await created.json()).data.id;
      assert(
        (
          await ctx.request.put(backend + '/api/v1/spaces/devices/' + id + '/room', {
            headers,
            data: { room_id: roomId },
          })
        ).ok(),
      );
    }
    await page.reload();
    await expect(room.locator('.ag-map-unplaced li')).toHaveCount(4);
    const after = await checkGrid(5);
    assert(after[width === 1440 ? 2 : 1].y > before[width === 1440 ? 2 : 1].y);
    await room.getByRole('button', { name: 'Gán thiết bị' }).click();
    await room.getByLabel('Thiết bị chưa gán').selectOption(f.deviceId);
    await room.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(room).toContainText('5 chưa từng gửi');
    await expect(room).toContainText('Chưa đặt vị trí');
    await page.getByRole('button', { name: 'Đặt lên sơ đồ' }).click();
    await room
      .getByRole('button', { name: 'Chọn vị trí trong ' + roomName })
      .click({ position: { x: 48, y: 48 } });
    await page.getByRole('button', { name: 'Lưu vị trí' }).click();
    await expect(room.locator('.ag-map-pin')).toHaveCount(1);
    await page.reload();
    await expect(room.locator('.ag-map-pin')).toHaveCount(1);
    await room.locator('.ag-map-pin').click();
    const confirmed = page.waitForEvent('dialog').then(async (d) => {
      assert(d.message().includes(roomName));
      await d.accept();
    });
    await page.getByRole('button', { name: 'Gỡ khỏi phòng' }).click();
    await confirmed;
    await expect(room.locator('.ag-map-pin')).toHaveCount(0);
    await page.reload();
    await room.getByRole('button', { name: 'Gán thiết bị' }).click();
    await room.getByLabel('Thiết bị chưa gán').selectOption(f.deviceId);
    await room.getByRole('button', { name: 'Lưu', exact: true }).click();
    await page.getByRole('button', { name: 'Đặt lên sơ đồ' }).click();
    await room
      .getByRole('button', { name: 'Chọn vị trí trong ' + roomName })
      .click({ position: { x: 35, y: 35 } });
    await page.getByRole('button', { name: 'Lưu vị trí' }).click();
    await expect(room.locator('.ag-map-pin')).toHaveCount(1);
    if (width === 1440) {
      const secondAdmin = await db.user.create({
        data: {
          email: prefix + '-layout@test.local',
          passwordHash: 'disabled-login',
          role: 'admin',
        },
      });
      const token = newSecret();
      await db.session.create({
        data: {
          tokenHash: hashSecret(token),
          userId: secondAdmin.id,
          expiresAt: new Date(Date.now() + 60000),
        },
      });
      const other = await browser.newContext();
      await other.addCookies([{ name: 'iot_session', value: token, url: origin, httpOnly: true }]);
      const secondPage = await other.newPage();
      await secondPage.goto(areaUrl);
      await secondPage.locator('.ag-map-pin').click();
      await secondPage.getByRole('button', { name: 'Đổi vị trí' }).click();
      await secondPage
        .getByRole('button', { name: 'Chọn vị trí trong ' + roomName })
        .click({ position: { x: 20, y: 20 } });
      await room
        .locator('.ag-map-pin')
        .dragTo(room.locator('.ag-map-canvas'), { targetPosition: { x: 90, y: 70 } });
      await page.getByRole('button', { name: 'Lưu vị trí' }).click();
      await expect(page.getByText('Đã lưu sơ đồ.')).toBeVisible();
      await secondPage.getByRole('button', { name: 'Lưu vị trí' }).click();
      await expect(secondPage.getByRole('alert')).toContainText('Bố trí phòng đã thay đổi');
      await secondPage.getByRole('button', { name: 'Tải bố trí mới' }).click();
      await expect(secondPage.getByRole('alert')).toHaveCount(0);
      await other.close();
    }
    await page.getByRole('link', { name: '← Danh sách khu vực' }).click();
    async function sample(seq, active, flame = false) {
      const payload = f.payload(seq, Date.now());
      payload.readings[0].alert_snapshot.gas = active ? 'active' : 'normal';
      payload.readings[0].alert_snapshot.flame = flame ? 'active' : 'normal';
      const response = await ctx.request.post(backend + '/api/v1/device/telemetry', {
        headers: f.deviceHeaders,
        data: payload,
      });
      assert.equal(response.status(), 200, JSON.stringify(await response.json()));
    }
    await expect(areaLink).toContainText('0 sự cố');
    await sample(1, true);
    await expect(areaLink).toContainText('1 sự cố', { timeout: 15000 });
    const banner = page.locator('.ag-incident-notice[data-severity=warning]');
    await expect(banner).toHaveCount(1);
    const gasHref = await banner.getByRole('link').getAttribute('href');
    for (const theme of ['light','dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      assert.equal(await banner.locator('strong').evaluate(el => getComputedStyle(el).fontSize), '17px');
      assert(await banner.evaluate(el => el.scrollWidth <= el.clientWidth));
    }
    await banner.getByRole('link').focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(origin + gasHref);
    await page.goBack();
    await areaLink.click();
    assert.equal(page.url(), areaUrl);
    await expect(room).toContainText('1 thiết bị có sự cố');
    await room.locator('.ag-map-pin').click();
    await page.locator('.ag-incident-action[href*="/alerts/"]').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cảnh báo khí ga');
    await expect(page.locator('.page-title')).toContainText(roomName);
    await expect(page.locator('.ag-incident-notice')).toHaveCount(0);
    await page.getByRole('button', { name: 'Tôi đã nhận cảnh báo' }).click();
    await expect(page.locator('.page-title')).toContainText('Bạn đã xác nhận tiếp nhận');
    await expect(page.locator('.page-title')).toContainText('Chưa kết thúc');
    await page.getByLabel('Ghi chú xác nhận').fill('Đã kiểm tra phòng demo');
    await page.getByRole('button', { name: 'Xác nhận đã xem' }).click();
    await expect(page.getByText('Đã kiểm tra phòng demo', { exact: true })).toBeVisible();
    await expect(page.locator('.page-title')).toContainText('Chưa kết thúc');
    await sample(2, false);
    await expect(page.locator('.page-title')).toContainText('Đã kết thúc', { timeout: 15000 });
    await page.goBack();
    await expect(room).toContainText('0 thiết bị có sự cố');
    await sample(3, true, true);
    await room.locator('.ag-map-pin').click();
    await page.getByText(/Xem 2 sự cố/).click();
    const flameLink = page.getByRole('link', { name: /Xem sự cố lửa · CRITICAL/ });
    const gasLink = page.getByRole('link', { name: /Xem sự cố Gas · WARNING/ });
    const live = await db.alertIncident.findMany({
      where: { deviceId: f.deviceId, status: 'active' },
    });
    await expect(flameLink).toHaveAttribute(
      'href',
      '/app/alerts/' + live.find((i) => i.condition === 'flame').id,
    );
    await expect(gasLink).toHaveAttribute(
      'href',
      '/app/alerts/' + live.find((i) => i.condition === 'gas').id,
    );
    await flameLink.click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Phát hiện lửa');
    await expect(page.locator('.page-title')).toContainText(roomName);
    await sample(4, false, false);
    await page.goBack();
    await expect(room).toContainText('0 thiết bị có sự cố');
    await page.getByRole('link', { name: 'Kiểm tra thiết bị', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kiểm tra thiết bị');
    await page.goto(origin + '/app/devices/' + f.deviceId);
    await expect(page.getByText('Thông tin, khóa kết nối và cấu hình của thiết bị.')).toBeVisible();
    await page.getByRole('link', { name: 'Xem sự cố của thiết bị' }).click();
    await expect(page).toHaveURL(origin + '/app/alerts?device_id=' + f.deviceId);
    await page.goto(origin + '/app/settings');
    const panels = await page.locator('.settings-column > section').evaluateAll((ns) =>
      ns.map((n) => {
        const r = n.getBoundingClientRect();
        return { x: r.left, right: r.right, y: r.top, b: r.bottom };
      }),
    );
    assert.equal(panels[0].x, panels[1].x);
    assert.equal(panels[0].right, panels[1].right);
    assert.equal(Math.round(panels[1].y - panels[0].b), 16);
    await page.goto(areaUrl);
    await login('viewer');
    await page.reload();
    await expect(room).toBeVisible();
    await expect(page.getByRole('button', { name: 'Thêm phòng' })).toHaveCount(0);
    await expect(room.getByRole('button', { name: 'Gán thiết bị' })).toHaveCount(0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await ctx.close();
    console.log(width + 'px passed');
  }
} finally {
  await browser?.close();
  await web?.close();
  await runtime.stopNotifications();
  await runtime.io.close();
  await db.$disconnect();
  globalThis.fetch = originalFetch;
}
