import { chromium } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const base = process.env.DIAGNOSTICS_PREVIEW_ORIGIN ?? "http://127.0.0.1:5173";
assert.equal(new URL(base).hostname, "127.0.0.1");
const { email, password } = JSON.parse(
  await readFile(".local/diagnostics-preview/credentials.json", "utf8"),
);
await mkdir(".local/screenshots", { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/app/device-diagnostics");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page
    .getByRole("link", { name: "Kiểm tra thiết bị", exact: true })
    .click();
  const list = page.locator(".dd-fleet");
  await list.waitFor();
  await page.screenshot({ path: ".local/screenshots/diagnostics-desktop.png" });
  await list.locator(".dd-station:visible").first().click();
  await page.locator(".dd-detail .dd-snapshot").waitFor();
  for (const name of [
    "Số đo có dùng được không?",
    "Trạm có gửi đều không?",
    "Giờ máy và khởi động",
  ])
    await page.getByRole("button", { name, exact: true }).click();
  const help = page.getByRole("button", {
    name: "Hướng dẫn kiểm tra thiết bị",
  });
  await help.focus();
  await page.getByRole("tooltip").waitFor();
  await help.press("Enter");
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(
    await help.evaluate((el) => document.activeElement === el),
    true,
  );
  await page
    .getByRole("button", { name: "Bản đồ phân bố trong phòng", exact: true })
    .click();
  const catalog = (
    await (await page.request.get(base + "/api/v1/spaces")).json()
  ).data;
  const active = catalog.rooms.filter(
    (r) =>
      !r.archived_at &&
      catalog.areas.some((a) => a.id === r.area_id && !a.archived_at),
  );
  if (active.length) {
    const picker = page.getByRole("combobox", { name: "Phòng", exact: true });
    await picker.waitFor();
    assert.equal(await picker.locator("option").count(), active.length);
    const origin = await picker.inputValue();
    for (const r of active) await picker.selectOption(r.id);
    await picker.selectOption(origin);
    await page.getByLabel("Chỉ số").selectOption("mq7");
    await page.getByLabel("Chỉ số").selectOption("mq2");
    if (await page.locator(".dd-pin").count()) {
      await page.locator(".dd-pin").first().click();
      await page.locator(".dd-point-detail").waitFor();
      if (
        await page.getByText("Màu giữa các điểm là tín hiệu ước tính.").count()
      )
        await page.waitForFunction(() =>
          document
            .querySelector(".dd-floor canvas")
            ?.getContext("2d")
            .getImageData(0, 0, 64, 64)
            .data.some((v) => v > 0),
        );
      await page.screenshot({
        path: ".local/screenshots/diagnostics-room.png",
      });
      await page.getByRole("button", { name: "Xem chẩn đoán" }).click();
    } else
      await page
        .getByRole("button", { name: "Thiết bị cần chú ý", exact: true })
        .click();
  } else {
    await page
      .getByText("Chưa có phòng đang hoạt động.", { exact: false })
      .waitFor();
    await page
      .getByRole("button", { name: "Thiết bị cần chú ý", exact: true })
      .click();
  }
  await page.getByRole("button", { name: "Đổi giao diện" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  if (!(await page.locator(".dd-detail").count()))
    await list.locator(".dd-station:visible").first().click();
  await page.locator(".dd-detail .dd-snapshot").waitFor();
  assert.equal(await list.isVisible(), false);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page.getByRole("button", { name: "← Danh sách thiết bị" }).click();
  await list.waitFor();
  await page.screenshot({ path: ".local/screenshots/diagnostics-mobile.png" });
  assert.deepEqual(errors, []);
  console.log(
    "Desktop, room registry, help, keyboard and mobile checks passed.",
  );
} finally {
  await browser.close();
}
