import { chromium } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const credentials = JSON.parse(
  await readFile(".local/diagnostics-preview/credentials.json", "utf8"),
);
await mkdir(".local/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173/app/device-diagnostics");
  await page.getByLabel("Email", { exact: true }).fill(credentials.email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page
    .getByRole("link", { name: "Kiểm tra thiết bị", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Số đo có dùng được không?" })
    .waitFor();
  await page.screenshot({
    path: ".local/screenshots/diagnostics-desktop.png",
    fullPage: true,
  });
  await page
    .getByLabel("Thiết bị", { exact: true })
    .selectOption({ label: "Cảm biến phòng bếp · Mô phỏng" });
  await page
    .getByRole("heading", { name: "Cần kiểm tra cảm biến nhiệt độ và độ ẩm" })
    .waitFor();
  await page
    .getByRole("button", { name: "Gián đoạn & bất thường", exact: true })
    .click();
  await page.getByRole("table").waitFor();
  await page.getByRole("button", { name: "Kết nối", exact: true }).click();
  await page
    .getByRole("heading", { name: "Kết nối có ổn định không?" })
    .waitFor();
  await page
    .getByRole("button", { name: "Thời gian thiết bị", exact: true })
    .click();
  await page
    .getByLabel("Thiết bị", { exact: true })
    .selectOption({ label: "Cảm biến phòng ngủ · Mô phỏng" });
  await page
    .getByRole("heading", { name: "Thiết bị chưa đồng bộ giờ" })
    .waitFor();
  await page
    .getByRole("button", { name: "Khởi động & phiên bản", exact: true })
    .click();
  await page.getByRole("table", { name: "Các phiên hoạt động" }).waitFor();
  assert.equal(
    await page
      .getByRole("table", { name: "Các phiên hoạt động" })
      .locator("tbody tr")
      .count(),
    4,
  );
  await page
    .getByRole("button", { name: "Mô phỏng phân bố", exact: true })
    .click();
  const initialStep = Number(
    (await page.locator(".dd-figure figcaption").innerText()).match(
      /(\d+) bước tính/,
    )[1],
  );
  await page.getByRole("button", { name: "Bắt đầu", exact: true }).click();
  await page.waitForFunction(
    (initial) =>
      Number(
        document
          .querySelector(".dd-figure figcaption")
          ?.textContent?.match(/(\d+) bước tính/)?.[1] ?? 0,
      ) >=
      initial + 8,
    initialStep,
  );
  await page.getByRole("button", { name: "Tạm dừng", exact: true }).click();
  assert.ok(
    await page.locator("canvas").evaluate((el) => {
      const pixels = el
        .getContext("2d")
        .getImageData(0, 0, el.width, el.height).data;
      return pixels.some((v) => v !== 0);
    }),
  );
  await page.screenshot({
    path: ".local/screenshots/simulation-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Từ tín hiệu cảm biến", exact: true })
    .click();
  await page
    .getByLabel("Nguồn dữ liệu", { exact: true })
    .selectOption("example");
  await page.getByRole("button", { name: "Xem bộ số đo mẫu" }).click();
  const samples = page.getByRole("table", { name: "Số đo dùng tạo bề mặt minh họa" });
  assert.equal(await samples.locator("tbody tr").count(), 6);
  assert.match(await samples.locator("tbody tr").first().innerText(), /10\.3/);
  await page.getByLabel("Cảm biến", { exact: true }).selectOption("mq7");
  await page.getByRole("button", { name: "Xem bộ số đo mẫu" }).click();
  assert.match(await samples.locator("tbody tr").first().innerText(), /8\.8/);
  const map = page.getByRole("button", { name: /Chọn điểm trên bản đồ/ });
  await map.focus();
  await map.press("ArrowRight");
  assert.match(await page.locator(".dd-probe-readout").innerText(), /X 51%/);
  const contours = page.getByLabel("Viền các vùng");
  await contours.uncheck();
  await contours.check();
  await page.locator(".dd-distribution").evaluate(el => window.scrollBy(0, el.getBoundingClientRect().top - 74));
  await page
    .locator(".dd-distribution")
    .screenshot({ path: ".local/screenshots/distribution-example.png" });
  await page
    .getByLabel("Nguồn dữ liệu", { exact: true })
    .selectOption("simulator");
  for (const name of [
    "Cảm biến phòng khách",
    "Cảm biến phòng bếp",
    "Cảm biến phòng ngủ",
  ])
    await page.getByLabel(name, { exact: true }).check();
  await page
    .getByRole("button", { name: "Lấy số đo mới", exact: true })
    .click();
  await page
    .getByRole("table", { name: "Số đo dùng tạo bề mặt minh họa" })
    .waitFor();
  await page.screenshot({
    path: ".local/screenshots/interpolation-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Đổi giao diện" }).click();
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() =>
    Promise.all(
      document.getAnimations().map((animation) => animation.finished),
    ),
  );
  await page.screenshot({
    path: ".local/screenshots/diagnostics-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "No horizontal page overflow on mobile",
  );
  await page
    .getByRole("button", { name: "Chất lượng dữ liệu", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Số đo có dùng được không?" })
    .waitFor();
  await page.screenshot({
    path: ".local/screenshots/quality-mobile.png",
    fullPage: true,
  });
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log(
    "Browser checks passed: login, six modules, household reminders, Worker simulation, IDW, light theme and 390px mobile.",
  );
} finally {
  await browser.close();
}
