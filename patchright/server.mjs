import http from "node:http";
import { chromium } from "patchright";

const EVOMI = {
  user: process.env.EVOMI_USERNAME,
  pass: process.env.EVOMI_PASSWORD,
  gateway: process.env.EVOMI_GATEWAY,
};
const CAPSOLVER_KEY = process.env.CAPSOLVER_API_KEY;
const hasEvomi = EVOMI.user && EVOMI.pass && EVOMI.gateway;

const CHALLENGE = /just a moment|checking your browser|cf-browser-verification|verifying you are human|enable javascript|captcha/i;
const TURNSTILE_SITEKEY = /(?:data-sitekey|sitekey["'\s:=]+)["']?(0x[0-9A-Za-z_-]{20,})/;

function turnstileSolved(html) {
  return /cf-turnstile-response["'\s:=]+[^"'\s>]{20,}|name=["']cf-turnstile-response["'][^>]*value=["'][^"'\s>]{20,}/i.test(html);
}

async function launchWithRetry(attempts = 6) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const b = await chromium.launch({ headless: false });
      console.log(`browser launched (attempt ${i})`);
      return b;
    } catch (e) {
      console.log(`launch attempt ${i} failed: ${String(e?.message ?? e).split("\n")[0]}`);
      if (i === attempts) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}
const browser = await launchWithRetry();

function stickySession() {
  const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  return {
    proxy: {
      server: `http://${EVOMI.gateway}`,
      username: EVOMI.user,
      password: `${EVOMI.pass}_session-${id}`,
    },
    // CapSolver proxy string: host:port:user:pass
    capStr: `${EVOMI.gateway}:${EVOMI.user}:${EVOMI.pass}_session-${id}`,
  };
}

async function capsolve(url, capStr) {
  const create = await fetch("https://api.capsolver.com/createTask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientKey: CAPSOLVER_KEY,
      task: { type: "AntiCloudflareTask", websiteURL: url, proxy: capStr },
    }),
  }).then((r) => r.json());
  if (create.errorId) throw new Error(`createTask: ${create.errorDescription}`);
  const taskId = create.taskId;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch("https://api.capsolver.com/getTaskResult", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientKey: CAPSOLVER_KEY, taskId }),
    }).then((r) => r.json());
    if (res.errorId) throw new Error(`getTaskResult: ${res.errorDescription}`);
    if (res.status === "ready") return res.solution; // { cookies, userAgent, token, ... }
  }
  throw new Error("capsolver timeout");
}

async function capsolveTurnstile(url, sitekey) {
  const create = await fetch("https://api.capsolver.com/createTask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientKey: CAPSOLVER_KEY,
      task: { type: "AntiTurnstileTaskProxyless", websiteURL: url, websiteKey: sitekey },
    }),
  }).then((r) => r.json());
  if (create.errorId) throw new Error(`turnstile createTask: ${create.errorDescription}`);
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch("https://api.capsolver.com/getTaskResult", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientKey: CAPSOLVER_KEY, taskId: create.taskId }),
    }).then((r) => r.json());
    if (res.errorId) throw new Error(`turnstile getTaskResult: ${res.errorDescription}`);
    if (res.status === "ready") return res.solution;
  }
  throw new Error("turnstile timeout");
}

async function clickTurnstile(page) {
  const el = await page.$(".cf-turnstile, [data-sitekey]");
  if (!el) return false;
  const box = await el.boundingBox();
  if (!box) return false;
  const x = box.x + 28;
  const y = box.y + box.height / 2;
  await page.mouse.move(x - 60, y - 25, { steps: 8 });
  await page.mouse.move(x, y, { steps: 14 });
  await page.waitForTimeout(250 + Math.random() * 400);
  await page.mouse.click(x, y);
  return true;
}

async function injectTurnstileToken(page, token) {
  await page.evaluate((t) => {
    for (const el of document.querySelectorAll(
      'input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"], input[name="g-recaptcha-response"]',
    )) {
      el.value = t;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const cb = window.__turnstileCb || window.turnstileCallback || window.onTurnstileSuccess;
    if (typeof cb === "function") {
      try {
        cb(t);
      } catch {}
    }
    for (const f of document.querySelectorAll("form")) {
      if (f.querySelector('[name="cf-turnstile-response"]')) {
        try {
          f.requestSubmit ? f.requestSubmit() : f.submit();
        } catch {}
      }
    }
  }, token);
}

async function solveTurnstile(page, target, html) {
  let sitekey = (html.match(TURNSTILE_SITEKEY) || [])[1];
  if (!sitekey) return html;

  await clickTurnstile(page).catch(() => {});
  await page.waitForTimeout(4000);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  html = await page.content();
  if (turnstileSolved(html) || !TURNSTILE_SITEKEY.test(html)) return html;

  if (CAPSOLVER_KEY) {
    const sol = await capsolveTurnstile(target, sitekey).catch((e) => {
      console.log(`turnstile solve failed: ${String(e?.message ?? e).split("\n")[0]}`);
      return null;
    });
    if (sol?.token) {
      await injectTurnstileToken(page, sol.token);
      await page.waitForTimeout(2500);
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      html = await page.content();
    }
  }
  return html;
}

async function render(target, { useProxy, solve }) {
  const sess = useProxy && hasEvomi ? stickySession() : null;
  const ctxOpts = { viewport: null, ...(sess ? { proxy: sess.proxy } : {}) };
  let context = await browser.newContext(ctxOpts);
  try {
    let page = await context.newPage();
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    // Passive interstitials auto-resolve — wait them out first.
    for (let i = 0; i < 4 && CHALLENGE.test(await page.title().catch(() => "")); i++) {
      await page.waitForTimeout(2500);
    }
    let html = await page.content();

    // Embedded Turnstile widget (not a full interstitial) → click it, then CapSolver token.
    if (solve && TURNSTILE_SITEKEY.test(html) && !CHALLENGE.test(html)) {
      html = await solveTurnstile(page, target, html);
    }

    // Still challenged and solving is enabled → hand the page to CapSolver.
    if (solve && sess && CAPSOLVER_KEY && CHALLENGE.test(html)) {
      const sol = await capsolve(target, sess.capStr);
      const cookies = sol.cookies || {};
      const cookieArr = Object.entries(cookies).map(([name, value]) => ({
        name,
        value: String(value),
        url: target,
      }));
      await context.close().catch(() => {});
      context = await browser.newContext({
        ...ctxOpts,
        ...(sol.userAgent ? { userAgent: sol.userAgent } : {}),
      });
      if (cookieArr.length) await context.addCookies(cookieArr);
      page = await context.newPage();
      await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      html = await page.content();
    }
    return html;
  } finally {
    await context.close().catch(() => {});
  }
}

http
  .createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/healthz") {
      res.writeHead(200).end(JSON.stringify({ ok: true, proxy: hasEvomi, solver: Boolean(CAPSOLVER_KEY) }));
      return;
    }
    const target = u.searchParams.get("url");
    if (u.pathname !== "/fetch" || !target) {
      res.writeHead(404).end();
      return;
    }
    try {
      const html = await render(target, {
        useProxy: u.searchParams.get("proxy") === "1",
        solve: u.searchParams.get("solve") === "1",
      });
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
    } catch (e) {
      res.writeHead(502).end(String(e?.message ?? e));
    }
  })
  .listen(9223, "0.0.0.0", () =>
    console.log(`patchright http on :9223 (proxy ${hasEvomi ? "on" : "off"}, solver ${CAPSOLVER_KEY ? "on" : "off"})`),
  );
