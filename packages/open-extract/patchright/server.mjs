import http from "node:http";
import { chromium } from "patchright";

const EVOMI = {
  user: process.env.EVOMI_USERNAME,
  pass: process.env.EVOMI_PASSWORD,
  gateway: process.env.EVOMI_GATEWAY,
};
const CAPSOLVER_KEY = process.env.CAPSOLVER_API_KEY;
const TWOCAPTCHA_KEY = process.env.TWOCAPTCHA_API_KEY;
const hasEvomi = EVOMI.user && EVOMI.pass && EVOMI.gateway;

const CHALLENGE = /just a moment|checking your browser|cf-browser-verification|verifying you are human|enable javascript|captcha/i;
const TURNSTILE_SITEKEY = /(?:data-sitekey|sitekey["'\s:=]+)["']?(0x[0-9A-Za-z_-]{20,})/;

function turnstileSolved(html) {
  return /cf-turnstile-response["'\s:=]+[^"'\s>]{20,}|name=["']cf-turnstile-response["'][^>]*value=["'][^"'\s>]{20,}/i.test(html);
}

function widgetSitekey(html) {
  const attr = html.match(/data-sitekey=["']([0-9A-Za-z_-]+)["']/i);
  if (attr) return attr[1];
  const frame = html.match(/<iframe[^>]+src=["'][^"']*[?&](?:sitekey|k)=([^&"'#]+)/i);
  return frame ? decodeURIComponent(frame[1]) : null;
}

function detect(html, cookies = "") {
  const s = html || "";
  const h = s.toLowerCase();
  const c = (cookies || "").toLowerCase();

  if (/just a moment|cf-browser-verification|cdn-cgi\/challenge-platform/.test(h)) return { vendor: "cf-interstitial", sitekey: null };
  if (/captcha-delivery\.com|geo\.captcha-delivery/.test(h) || /\bdatadome\b/.test(c)) return { vendor: "datadome", sitekey: null };
  if (/\b_abck\b|\bak_bmsc\b/.test(c)) return { vendor: "akamai", sitekey: null };
  if (/px-captcha|captcha\.px-cdn/.test(h) || /\b_px\w*\b/.test(c)) return { vendor: "perimeterx", sitekey: null };

  const turnstile =
    /<iframe[^>]+src=["'][^"']*challenges\.cloudflare\.com/i.test(s) ||
    /class=["'][^"']*\bcf-turnstile\b/i.test(s) ||
    /name=["']cf-turnstile-response["']/i.test(s);
  const hcaptcha =
    /<iframe[^>]+src=["'][^"']*hcaptcha\.com/i.test(s) ||
    /class=["'][^"']*\bh-captcha\b/i.test(s) ||
    /name=["']h-captcha-response["']/i.test(s);
  const recaptcha =
    /<iframe[^>]+src=["'][^"']*(?:google\.com|recaptcha\.net)\/recaptcha/i.test(s) ||
    /class=["'][^"']*\bg-recaptcha\b/i.test(s) ||
    /id=["']g-recaptcha-response["']/i.test(s);

  if (turnstile) return { vendor: "turnstile", sitekey: widgetSitekey(s) };
  if (hcaptcha) return { vendor: "hcaptcha", sitekey: widgetSitekey(s) };
  if (recaptcha) return { vendor: "recaptcha", sitekey: widgetSitekey(s) };
  return null;
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
    capStr: `${EVOMI.gateway}:${EVOMI.user}:${EVOMI.pass}_session-${id}`,
  };
}

const SOLVERS = {
  capsolver: {
    key: CAPSOLVER_KEY,
    base: "https://api.capsolver.com",
    task: {
      turnstile: (url, sitekey) => ({ type: "AntiTurnstileTaskProxyLess", websiteURL: url, websiteKey: sitekey }),
      hcaptcha: (url, sitekey) => ({ type: "HCaptchaTaskProxyLess", websiteURL: url, websiteKey: sitekey }),
      recaptcha: (url, sitekey) => ({ type: "ReCaptchaV2TaskProxyLess", websiteURL: url, websiteKey: sitekey }),
    },
  },
  twocaptcha: {
    key: TWOCAPTCHA_KEY,
    base: "https://api.2captcha.com",
    task: {
      turnstile: (url, sitekey) => ({ type: "TurnstileTaskProxyless", websiteURL: url, websiteKey: sitekey }),
      hcaptcha: (url, sitekey) => ({ type: "HCaptchaTaskProxyless", websiteURL: url, websiteKey: sitekey }),
      recaptcha: (url, sitekey) => ({ type: "RecaptchaV2TaskProxyless", websiteURL: url, websiteKey: sitekey }),
    },
  },
};

async function antiCaptchaSolve(base, clientKey, task) {
  const create = await fetch(`${base}/createTask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientKey, task }),
  }).then((r) => r.json());
  if (create.errorId) throw new Error(`createTask: ${create.errorDescription || create.errorCode}`);
  const taskId = create.taskId;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(`${base}/getTaskResult`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientKey, taskId }),
    }).then((r) => r.json());
    if (res.errorId) throw new Error(`getTaskResult: ${res.errorDescription || res.errorCode}`);
    if (res.status === "ready") return res.solution;
  }
  throw new Error("solver timeout");
}

function solverOrder(pref) {
  const live = ["capsolver", "twocaptcha"].filter((p) => SOLVERS[p].key);
  if (pref && SOLVERS[pref]?.key) return [pref, ...live.filter((p) => p !== pref)];
  return live;
}

async function solveToken(vendor, url, sitekey, pref) {
  if (!sitekey) throw new Error(`no sitekey for ${vendor}`);
  let lastErr;
  for (const name of solverOrder(pref)) {
    const make = SOLVERS[name].task[vendor];
    if (!make) continue;
    try {
      const sol = await antiCaptchaSolve(SOLVERS[name].base, SOLVERS[name].key, make(url, sitekey));
      const token = sol.token || sol.gRecaptchaResponse;
      if (token) return { token, provider: name };
      lastErr = new Error("empty solution");
    } catch (e) {
      lastErr = e;
      console.log(`${name} ${vendor} failed: ${String(e?.message ?? e).split("\n")[0]}`);
    }
  }
  throw new Error(`no token for ${vendor}: ${lastErr ? lastErr.message : "no solver configured"}`);
}

async function capsolve(url, capStr) {
  return antiCaptchaSolve(SOLVERS.capsolver.base, CAPSOLVER_KEY, {
    type: "AntiCloudflareTask",
    websiteURL: url,
    proxy: capStr,
  });
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

async function solveTurnstile(page, target, html, pref) {
  let sitekey = (html.match(TURNSTILE_SITEKEY) || [])[1];
  if (!sitekey) return html;

  await clickTurnstile(page).catch(() => {});
  await page.waitForTimeout(4000);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  html = await page.content();
  if (turnstileSolved(html) || !TURNSTILE_SITEKEY.test(html)) return html;

  if (solverOrder(pref).length) {
    const sol = await solveToken("turnstile", target, sitekey, pref).catch((e) => {
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

async function probe(target, useProxy) {
  const sess = useProxy && hasEvomi ? stickySession() : null;
  const ctxOpts = { viewport: null, ...(sess ? { proxy: sess.proxy } : {}) };
  const context = await browser.newContext(ctxOpts);
  try {
    const page = await context.newPage();
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    const html = await page.content();
    const cookies = (await context.cookies()).map((c) => c.name).join(" ");
    const title = await page.title().catch(() => "");
    return { html, cookies, title };
  } finally {
    await context.close().catch(() => {});
  }
}

async function render(target, { useProxy, solve, solver }) {
  const sess = useProxy && hasEvomi ? stickySession() : null;
  const ctxOpts = { viewport: null, ...(sess ? { proxy: sess.proxy } : {}) };
  let context = await browser.newContext(ctxOpts);
  try {
    let page = await context.newPage();
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    for (let i = 0; i < 4 && CHALLENGE.test(await page.title().catch(() => "")); i++) {
      await page.waitForTimeout(2500);
    }
    let html = await page.content();

    if (solve && TURNSTILE_SITEKEY.test(html) && !CHALLENGE.test(html)) {
      html = await solveTurnstile(page, target, html, solver);
    }

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
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ ok: true, proxy: hasEvomi, solvers: solverOrder() }));
      return;
    }
    const target = u.searchParams.get("url");
    if (u.pathname === "/detect" && target) {
      try {
        const { html, cookies, title } = await probe(target, u.searchParams.get("proxy") === "1");
        const captcha = detect(html, cookies);
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ url: target, title, captcha, cookies: cookies.split(" ").filter(Boolean) }));
      } catch (e) {
        res.writeHead(502, { "content-type": "application/json" }).end(JSON.stringify({ error: String(e?.message ?? e) }));
      }
      return;
    }
    if (u.pathname === "/solve" && target) {
      const tokenVendors = new Set(["turnstile", "hcaptcha", "recaptcha"]);
      try {
        const { html, cookies, title } = await probe(target, u.searchParams.get("proxy") === "1");
        const captcha = detect(html, cookies);
        if (!captcha || !tokenVendors.has(captcha.vendor)) {
          res
            .writeHead(200, { "content-type": "application/json" })
            .end(
              JSON.stringify({
                url: target,
                title,
                captcha,
                solved: false,
                reason: captcha ? "vendor is not token-solvable here" : "no captcha detected",
              }),
            );
          return;
        }
        const r = await solveToken(captcha.vendor, target, captcha.sitekey, u.searchParams.get("solver") || undefined);
        res.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({
            url: target,
            vendor: captcha.vendor,
            sitekey: captcha.sitekey,
            provider: r.provider,
            solved: true,
            tokenLength: r.token.length,
            tokenPreview: r.token.slice(0, 48),
          }),
        );
      } catch (e) {
        res.writeHead(502, { "content-type": "application/json" }).end(JSON.stringify({ error: String(e?.message ?? e) }));
      }
      return;
    }
    if (u.pathname !== "/fetch" || !target) {
      res.writeHead(404).end();
      return;
    }
    try {
      const html = await render(target, {
        useProxy: u.searchParams.get("proxy") === "1",
        solve: u.searchParams.get("solve") === "1",
        solver: u.searchParams.get("solver") || undefined,
      });
      const hit = detect(html);
      res
        .writeHead(200, { "content-type": "text/html; charset=utf-8", "x-captcha": hit ? hit.vendor : "none" })
        .end(html);
    } catch (e) {
      res.writeHead(502).end(String(e?.message ?? e));
    }
  })
  .listen(9223, "0.0.0.0", () =>
    console.log(`patchright http on :9223 (proxy ${hasEvomi ? "on" : "off"}, solvers [${solverOrder().join(", ") || "none"}])`),
  );
