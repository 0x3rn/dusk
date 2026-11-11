// tests/e2e/kdf-worker.spec.ts
// Key derivation runs in a Web Worker: it must be allowed by the nonce Content-Security-Policy
// (run against a production build: `npm run build` then `next start -p 3201`), must not freeze
// the page, and must fall back to the main thread when no worker can be used.
//
// "Before" numbers come from a page with no Worker at all, which makes the client fall back to the
// main thread: exactly how derivation behaved before the worker existed.
import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  expectItemSecretReadable,
  lockVault,
  openDigitalVault,
  registerThrowawayAccount,
  watchPage,
} from "./helpers/vault";

const PASSPHRASE = "twelve chars+ passphrase";

interface PerfRead {
  maxGap: number;
  longTasks: number[];
  /** Long tasks (ms) that started after a derivation request was sent and before its answer came back. */
  longTasksDuringDerivation: number[];
  busyLabels: string[];
}

interface PerfProbe {
  maxGap: number;
  last: number;
  longTasks: Array<{ start: number; duration: number }>;
  windows: Array<{ start: number; end: number | null }>;
  busy: Set<string>;
}

async function installPerfProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const perf: PerfProbe = { maxGap: 0, last: performance.now(), longTasks: [], windows: [], busy: new Set() };
    (window as unknown as { __perf: PerfProbe }).__perf = perf;
    setInterval(() => {
      const now = performance.now();
      perf.maxGap = Math.max(perf.maxGap, now - perf.last - 16);
      perf.last = now;
    }, 16);
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) perf.longTasks.push({ start: entry.startTime, duration: Math.round(entry.duration) });
    }).observe({ type: "longtask", buffered: true });

    // Remember when a derivation request is sent to the worker and when its answer arrives.
    const NativeWorker = window.Worker;
    if (typeof NativeWorker === "function") window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (event: MessageEvent) => {
          const data = event.data as { type?: string } | null;
          if (data?.type === "result" || data?.type === "error") {
            const open = perf.windows.find((w) => w.end === null);
            if (open) open.end = performance.now();
          }
        });
      }
      postMessage(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions): void {
        perf.windows.push({ start: performance.now(), end: null });
        super.postMessage(message, transfer as Transferable[]);
      }
    };

    // Did the visible busy label ever show?
    const seeBusy = () => {
      for (const button of Array.from(document.querySelectorAll("button"))) {
        const label = button.textContent ?? "";
        if (label === "Unlocking..." || label === "Creating your vault...") perf.busy.add(label);
      }
    };
    new MutationObserver(seeBusy).observe(document, { subtree: true, childList: true, characterData: true });
  });
}

async function perfReset(page: Page): Promise<void> {
  await page.evaluate(() => {
    const perf = (window as unknown as { __perf: PerfProbe }).__perf;
    perf.maxGap = 0;
    perf.longTasks = [];
    perf.windows = [];
    perf.busy = new Set();
    perf.last = performance.now();
  });
}

async function perfRead(page: Page): Promise<PerfRead> {
  // Let the observer deliver its last entries before reading.
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    const perf = (window as unknown as { __perf: PerfProbe }).__perf;
    const during = perf.longTasks.filter((task) =>
      perf.windows.some((w) => task.start > w.start && task.start < (w.end ?? Infinity))
    );
    return {
      maxGap: Math.round(perf.maxGap),
      longTasks: perf.longTasks.map((t) => t.duration),
      longTasksDuringDerivation: during.map((t) => t.duration),
      busyLabels: Array.from(perf.busy),
    };
  });
}

const longest = (read: PerfRead): number => Math.max(0, ...read.longTasks);

async function setThrottle(page: Page, rate: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
}

interface Run {
  create: PerfRead;
  unlock: PerfRead;
  unlockThrottled: PerfRead;
  workersSeen: string[];
  violations: string[];
  consoleErrors: string[];
  pageErrors: string[];
}

async function measure(browser: Browser, blockWorker: boolean): Promise<Run> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const watchers = await watchPage(page, { allow4xx: true });
  if (blockWorker) {
    // No Web Worker in this page: the client must fall back to the main thread (how derivation
    // behaved before the worker existed). Works the same for Turbopack and webpack builds.
    await page.addInitScript(() => {
      Object.defineProperty(window, "Worker", { value: undefined, configurable: true });
    });
  }
  await installPerfProbe(page);

  const workersSeen: string[] = [];
  page.on("worker", (worker) => workersSeen.push(worker.url()));

  await registerThrowawayAccount(page, blockWorker ? "inline" : "worker");
  await openDigitalVault(page);
  await expect(page.getByText("Create your master passphrase")).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Master passphrase").fill(PASSPHRASE);
  await page.getByLabel("Type it again").fill(PASSPHRASE);

  await perfReset(page);
  await page.getByRole("button", { name: "Create vault" }).click();
  const codeBox = page.locator("div.font-mono").filter({ hasText: /^DUSK(-[0-9A-Z]{4}){8}$/ });
  await expect(codeBox).toBeVisible({ timeout: 90_000 });
  const create = await perfRead(page);

  await openDigitalVault(page);
  await page.locator("#item-title").fill("Bank login");
  await page.locator("#item-content").fill("account 12345, pin 6789");
  await page.getByRole("button", { name: "Save to vault" }).click();
  await expect(page.getByText("Bank login").first()).toBeVisible({ timeout: 30_000 });

  // Unlock at full speed.
  await lockVault(page);
  await page.getByLabel("Master passphrase").fill(PASSPHRASE);
  await perfReset(page);
  await page.getByRole("button", { name: "Unlock vault" }).click();
  await expect(page.getByText("Vault unlocked on this device.")).toBeVisible({ timeout: 90_000 });
  const unlock = await perfRead(page);

  // Unlock with the CPU slowed down 6x (a low-end phone).
  await openDigitalVault(page);
  await lockVault(page);
  await setThrottle(page, 6);
  await page.getByLabel("Master passphrase").fill(PASSPHRASE);
  await perfReset(page);
  await page.getByRole("button", { name: "Unlock vault" }).click();
  await expect(page.getByText("Vault unlocked on this device.")).toBeVisible({ timeout: 120_000 });
  const unlockThrottled = await perfRead(page);
  await setThrottle(page, 1);

  await openDigitalVault(page);
  await expectItemSecretReadable(page, "account 12345, pin 6789");

  const run: Run = {
    create,
    unlock,
    unlockThrottled,
    workersSeen,
    violations: watchers.violations,
    consoleErrors: watchers.consoleErrors,
    pageErrors: watchers.pageErrors,
  };
  await context.close();
  return run;
}

test("key derivation in a Web Worker: allowed by the CSP, vault works, and the page stays responsive", async ({ browser }) => {
  test.setTimeout(420_000);

  const withWorker = await measure(browser, false);
  const mainThread = await measure(browser, true);

  const summary = {
    withWorker: {
      create: { longestTaskMs: longest(withWorker.create), maxTimerGapMs: withWorker.create.maxGap, longTasksDuringDerivation: withWorker.create.longTasksDuringDerivation },
      unlock: { longestTaskMs: longest(withWorker.unlock), maxTimerGapMs: withWorker.unlock.maxGap, longTasksDuringDerivation: withWorker.unlock.longTasksDuringDerivation },
      unlock6xThrottle: { longestTaskMs: longest(withWorker.unlockThrottled), maxTimerGapMs: withWorker.unlockThrottled.maxGap, longTasksDuringDerivation: withWorker.unlockThrottled.longTasksDuringDerivation },
    },
    mainThread: {
      create: { longestTaskMs: longest(mainThread.create), maxTimerGapMs: mainThread.create.maxGap },
      unlock: { longestTaskMs: longest(mainThread.unlock), maxTimerGapMs: mainThread.unlock.maxGap },
      unlock6xThrottle: { longestTaskMs: longest(mainThread.unlockThrottled), maxTimerGapMs: mainThread.unlockThrottled.maxGap },
    },
  };
  console.log(`RESPONSIVENESS ${JSON.stringify(summary)}`);
  test.info().annotations.push({ type: "responsiveness", description: JSON.stringify(summary) });

  // The worker really ran (a same-origin script from the build output), with zero policy
  // violations and no errors of any kind.
  expect(withWorker.workersSeen.length).toBeGreaterThan(0);
  for (const url of withWorker.workersSeen) expect(new URL(url).pathname).toMatch(/^\/_next\/static\//);
  expect(withWorker.violations).toEqual([]);
  expect(withWorker.consoleErrors).toEqual([]);
  expect(withWorker.pageErrors).toEqual([]);
  // The visible busy labels are kept while the worker runs.
  expect(withWorker.create.busyLabels).toContain("Creating your vault...");
  expect(withWorker.unlock.busyLabels).toContain("Unlocking...");
  // Nothing long ran on the main thread while a derivation was in flight.
  expect(longest({ ...withWorker.create, longTasks: withWorker.create.longTasksDuringDerivation })).toBeLessThan(50);
  expect(withWorker.unlock.longTasksDuringDerivation).toEqual([]);
  expect(withWorker.unlockThrottled.longTasksDuringDerivation).toEqual([]);

  // Blocking the worker proves the fallback: no worker, the vault still works.
  expect(mainThread.workersSeen).toEqual([]);
  expect(mainThread.pageErrors).toEqual([]);
  expect(mainThread.violations).toEqual([]);

  // No derivation-sized freeze with the worker. Under 6x CPU throttling, compare with the main thread.
  expect(longest(withWorker.create)).toBeLessThan(100);
  expect(longest(withWorker.unlock)).toBeLessThan(100);
  expect(withWorker.unlock.maxGap).toBeLessThan(100);
  expect(withWorker.unlockThrottled.maxGap).toBeLessThan(mainThread.unlockThrottled.maxGap / 2);
  expect(longest(withWorker.unlockThrottled)).toBeLessThan(Math.max(1, longest(mainThread.unlockThrottled)) / 2);
});
