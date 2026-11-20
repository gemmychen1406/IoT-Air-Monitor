import EmbeddedPostgres from "embedded-postgres";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer as netServer } from "node:net";

// Intentionally ignores DATABASE_URL and .env. This tool can only open its own loopback database.
const root = resolve(import.meta.dirname, "../..");
process.chdir(root);
const testing = process.argv.includes("--test");
async function availablePort(preferred = 0): Promise<number> {
  return new Promise<number>((yes, no) => {
    const server = netServer();
    server.once("error", (error) => {
      if (preferred) void availablePort().then(yes, no);
      else no(error);
    });
    server.listen(preferred, "127.0.0.1", () => {
      const address = server.address();
      const free =
        typeof address === "object" && address ? address.port : 55433;
      server.close(() => yes(free));
    });
  });
}
const port = await availablePort(testing ? 0 : 55432);
const folder = resolve(
  root,
  ".local",
  testing ? `diagnostics-tests/run-${Date.now()}` : "diagnostics-preview",
);
if (process.platform === "win32")
  process.env.PATH = `${resolve(root, "node_modules/@embedded-postgres/windows-x64/native/bin")};${process.env.SystemRoot ?? "C:\\Windows"}\\System32;${process.env.PATH ?? ""}`;
await mkdir(folder, { recursive: true });
for (const p of testing ? [port] : [port, 4000, 5173]) {
  await new Promise<void>((yes, no) => {
    const server = netServer();
    server.once("error", () =>
      no(
        new Error(
          `Cổng ${p} đang được dùng. Dừng bản local cũ hoặc ứng dụng dùng cổng này rồi thử lại.`,
        ),
      ),
    );
    server.listen(p, "127.0.0.1", () => server.close(() => yes()));
  });
}
let credentials: { email: string; password: string; dbPassword: string };
try {
  credentials = JSON.parse(
    await readFile(resolve(folder, "credentials.json"), "utf8"),
  );
} catch {
  credentials = {
    email: "ha@airguard.local",
    password: `Ha-${randomBytes(9).toString("base64url")}`,
    dbPassword: randomBytes(18).toString("base64url"),
  };
  await writeFile(
    resolve(folder, "credentials.json"),
    JSON.stringify(credentials, null, 2),
  );
}
const databaseDir = resolve(folder, `postgres-active-${Date.now()}`);
const postgres = new EmbeddedPostgres({
  databaseDir,
  user: "airguard_local",
  password: credentials.dbPassword,
  port,
  persistent: true,
  initdbFlags: ["--encoding=UTF8"],
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: () => {},
});
// Use the package's platform binaries, but own the process: its Windows stop() uses taskkill /F.
// pg_ctl fast shutdown closes clients and shared memory cleanly instead.
const platformPackage = `@embedded-postgres/${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
const binaries: { postgres: string; pg_ctl: string } = await import(
  platformPackage
);
let postgresProcess: ChildProcess | undefined;
async function startPostgres() {
  await new Promise<void>((yes, no) => {
    let log = "";
    let ready = false;
    postgresProcess = spawn(
      binaries.postgres,
      ["-D", databaseDir, "-p", String(port), "-h", "127.0.0.1"],
      {
        windowsHide: true,
        env: { ...process.env, LC_MESSAGES: "C" },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    const timer = setTimeout(
      () => no(new Error("PostgreSQL local chưa sẵn sàng sau 45 giây.")),
      45000,
    );
    postgresProcess.once("error", (error) => {
      clearTimeout(timer);
      no(error);
    });
    postgresProcess.once("exit", () => {
      clearTimeout(timer);
      if (!ready)
        no(
          new Error(
            `PostgreSQL local không khởi động được: ${log.slice(-1500)}`,
          ),
        );
    });
    postgresProcess.stderr!.on("data", (chunk) => {
      log = (log + String(chunk)).slice(-4000);
      if (
        !ready &&
        log.includes("database system is ready to accept connections")
      ) {
        ready = true;
        clearTimeout(timer);
        yes();
      }
    });
  });
}
const dbName = testing
  ? `airguard_diagnostics_test_${Date.now()}`
  : "airguard_diagnostics_preview_utf8";
const url = `postgresql://airguard_local:${credentials.dbPassword}@127.0.0.1:${port}/${dbName}`;
const env = {
  ...process.env,
  DATABASE_URL: url,
  TEST_DATABASE_URL: url,
  WEB_ORIGIN: "http://127.0.0.1:5173",
  TELEGRAM_ENABLED: "false",
  WEB_PUSH_ENABLED: "false",
};
function run(file: string, args: string[]) {
  return new Promise<void>((yes, no) => {
    const child = spawn(process.execPath, [file, ...args], {
      env,
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", no);
    child.once("exit", (code) =>
      code === 0
        ? yes()
        : no(new Error(`Lệnh kiểm tra/khởi tạo kết thúc với mã ${code}.`)),
    );
  });
}
let closeApp: (() => Promise<void>) | undefined;
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await closeApp?.();
  if (postgresProcess && postgresProcess.exitCode === null) {
    await new Promise<void>((yes, no) => {
      const ctl = spawn(
        binaries.pg_ctl,
        ["-D", databaseDir, "stop", "-m", "fast", "-w", "-t", "15"],
        { windowsHide: true, stdio: "ignore" },
      );
      ctl.once("error", no);
      ctl.once("exit", (code) =>
        code === 0 ? yes() : no(new Error("Chưa dừng được PostgreSQL local.")),
      );
    });
  }
}
process.on("SIGINT", () => {
  void shutdown().then(() => process.exit());
});
process.on("SIGTERM", () => {
  void shutdown().then(() => process.exit());
});
try {
  console.log("Đang chuẩn bị database riêng cho lần chạy này…");
  await postgres.initialise();
  await startPostgres();
  const client = postgres.getPgClient("postgres", "127.0.0.1");
  await client.connect();
  try {
    const exists = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName],
    );
    if (!exists.rowCount)
      await client.query(
        `CREATE DATABASE "${dbName}" ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`,
      );
  } finally {
    await client.end();
  }
  await run("node_modules/prisma/build/index.js", ["migrate", "deploy"]);
  if (testing) {
    // A new database per run: no reset, drop or mutation of previous test/preview databases.
    console.log(
      "Chạy bộ kiểm thử với PostgreSQL thật. Loại trừ backup.test.ts vì kiểm thử cũ này bắt buộc Docker.",
    );
    await run("node_modules/vitest/vitest.mjs", [
      "run",
      "--maxWorkers=2",
      "--exclude=apps/api/tests/backup.test.ts",
    ]);
    await shutdown();
  } else {
    const { createDatabase } = await import("@iot/database");
    const { createRuntime } = await import("../../apps/api/src/runtime.js");
    const { seedDemo, tickDemo } = await import("./seed.js");
    const { createServer } = await import("vite");
    const db = createDatabase(url);
    closeApp = () => db.$disconnect();
    await seedDemo(db, credentials.email, credentials.password);
    const runtime = createRuntime(db, env.WEB_ORIGIN, { secureCookies: false });
    await new Promise<void>((yes) =>
      runtime.http.listen(4000, "127.0.0.1", yes),
    );
    const vite = await createServer({
      configFile: resolve(root, "apps/web/vite.config.ts"),
      root: resolve(root, "apps/web"),
      server: { host: "127.0.0.1" },
    });
    await vite.listen();
    let ticking = false;
    const timer = setInterval(() => {
      if (ticking || closing) return;
      ticking = true;
      void tickDemo(db)
        .catch((e) =>
          console.error(
            "Chưa cập nhật được dữ liệu demo:",
            e instanceof Error ? e.message : "Lỗi database",
          ),
        )
        .finally(() => {
          ticking = false;
        });
    }, 5000);
    closeApp = async () => {
      clearInterval(timer);
      while (ticking) await new Promise((r) => setTimeout(r, 50));
      await vite.close();
      await runtime.stopNotifications();
      await new Promise<void>((yes) => runtime.io.close(() => yes()));
      await db.$disconnect();
    };
    console.log(
      `\nAirGuard local đã sẵn sàng: http://127.0.0.1:5173/app/device-diagnostics\nEmail: ${credentials.email}\nMật khẩu local: ${credentials.password}\n6 thiết bị mô phỏng, có dữ liệu trong 1 giờ gần nhất.\nDatabase riêng trong .local; không dùng .env hoặc gửi thông báo.\nCtrl+C để dừng. Khởi chạy lại sẽ làm mới dữ liệu demo.\n`,
    );
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  await shutdown();
  process.exitCode = 1;
}
