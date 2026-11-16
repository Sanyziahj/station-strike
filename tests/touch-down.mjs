// Phone D-pad DOWN: pressed while held, released on touchend/touchcancel,
// no double fire from a following synthetic mouse event. Both phone viewports.
import { createRequire } from "node:module";
import fs from "fs";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright-core")); }
catch { ({ chromium } = require("/tmp/pw/node_modules/playwright-core")); }

const URL = process.env.SSURL || "file:///workspace/index.html?ssdbg";
const CHROME = process.env.CHROME || "/usr/bin/google-chrome";
const OUT = "/opt/cursor/artifacts";
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const failures = [];
const ok = (c, m) => {
  if (c) pass++;
  else { fail++; failures.push(m); }
  console.log((c ? "PASS " : "FAIL ") + m);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function covers(b, c) {
  return b.x < c.x + c.w - 0.5 && b.x + b.w > c.x + 0.5 && b.y < c.y + c.h - 0.5 && b.y + b.h > c.y + 0.5;
}

async function readLayout(page) {
  return page.evaluate(() => {
    const canvas = document.getElementById("game").getBoundingClientRect();
    const c = { x: canvas.x, y: canvas.y, w: canvas.width, h: canvas.height };
    const nodes = [...document.querySelectorAll("#srml-dir [data-b], #srml-menu .srml-b, #srml-act [data-b]")];
    const bs = nodes.filter((e) => e.offsetParent).map((e) => {
      const r = e.getBoundingClientRect();
      return {
        t: e.dataset.b || e.dataset.srml || e.textContent.trim().toLowerCase(),
        x: r.x, y: r.y, w: r.width, h: r.height,
        on: e.classList.contains("on"),
      };
    });
    const down = document.querySelector("#srml-dir [data-b=down]");
    return {
      c,
      bs,
      coarse: matchMedia("(pointer:coarse)").matches,
      srml: document.documentElement.classList.contains("srml"),
      cross: !!document.querySelector("#srml-dir.cross"),
      menu: window.__SS && window.__SS.menu ? { i: window.__SS.menu.i, sel: window.__SS.menu.sel } : null,
      state: window.__SS && window.__SS.G ? window.__SS.G.state : null,
      downOn: !!(down && down.classList.contains("on")),
    };
  });
}

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"],
  });

  for (const [w, h] of [[390, 844], [844, 390]]) {
    const O = w < h ? "upright" : "sideways";
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    await ctx.addInitScript(() => {
      window.__SS_DEBUG = true;
      try {
        localStorage.clear();
        localStorage.setItem("sr-ss-progress", JSON.stringify({ u: 6, c: [true, true, true, true, true, true], done: true }));
      } catch (e) {}
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
    page.on("console", (m) => {
      if (m.type() === "error" && !/favicon|404/.test(m.text())) errs.push("console: " + m.text());
    });
    await page.goto(URL);
    await page.waitForFunction(() => window.__SS && window.__SS.G && window.__SS.G.state === "menu" && document.querySelector("#srml-dir [data-b=down]"));
    await sleep(250);

    const cdp = await ctx.newCDPSession(page);
    const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" || type === "touchCancel" ? [] : [{ x, y, id: 1 }],
    });

    const center = (layout, name) => {
      const b = layout.bs.find((q) => q.t === name);
      return b && { ...b, cx: b.x + b.w / 2, cy: b.y + b.h / 2 };
    };

    let L = await readLayout(page);
    ok(L.srml && L.coarse, O + ": phone layer active");
    ok(L.cross, O + ": D-pad is a 4-way cross");
    ok(L.state === "menu", O + ": menu is up for up/down nav (" + L.state + ")");
    for (const name of ["up", "down", "left", "right", "ok", "back"]) {
      ok(!!center(L, name), O + ": " + name + " is on the panel");
    }

    const gutter = (layout, label) => {
      const dirs = layout.bs.filter((b) => ["up", "down", "left", "right"].includes(b.t));
      ok(dirs.length === 4, O + " " + label + ": four directions");
      for (const b of dirs) {
        const inside = b.x >= -0.5 && b.y >= -0.5 && b.x + b.w <= w + 0.5 && b.y + b.h <= h + 0.5;
        ok(inside, O + " " + label + ": " + b.t + " fully on screen (" + Math.round(b.x) + "," + Math.round(b.y) + " " + Math.round(b.w) + "x" + Math.round(b.h) + ")");
        ok(!covers(b, layout.c), O + " " + label + ": " + b.t + " does not cover the canvas");
        if (w < h) ok(b.y >= layout.c.y + layout.c.h - 1, O + " " + label + ": " + b.t + " sits under the screen");
        else ok(b.x + b.w <= layout.c.x + 0.5 || b.x >= layout.c.x + layout.c.w - 0.5, O + " " + label + ": " + b.t + " stays in the side gutter");
      }
    };
    gutter(L, "idle");

    const down0 = center(L, "down");
    await page.mouse.move(down0.cx, down0.cy);
    await sleep(80);
    gutter(await readLayout(page), "focused");

    const menuI = () => page.evaluate(() => window.__SS.menu.i);
    const nItems = 3;
    const before = await menuI();
    await touch("touchStart", down0.cx, down0.cy);
    await sleep(80);
    const pressed = await menuI();
    let heldLayout = await readLayout(page);
    ok(pressed === (before + 1) % nItems, O + ": DOWN pressed moves the menu once (" + before + " -> " + pressed + ")");
    ok(heldLayout.downOn, O + ": DOWN stays held after the press");
    gutter(heldLayout, "held");
    await sleep(280);
    const still = await menuI();
    heldLayout = await readLayout(page);
    ok(still === pressed, O + ": holding DOWN does not repeat or double-fire (" + still + ")");
    ok(heldLayout.downOn, O + ": DOWN is still held");
    await page.screenshot({ path: `${OUT}/phone-panel-${O}-held.png` });

    await touch("touchEnd");
    await sleep(80);
    heldLayout = await readLayout(page);
    ok(!heldLayout.downOn, O + ": touchend releases DOWN");
    ok((await menuI()) === pressed, O + ": touchend does not move the menu again");

    // Synthetic mouse after the touch must not press DOWN a second time.
    const mouseAt = await page.evaluate(({ x, y }) => {
      const el = document.querySelector("#srml-dir [data-b=down]");
      const fire = (type, Ctor, extra) => el.dispatchEvent(new Ctor(type, Object.assign({ bubbles: true, cancelable: true, clientX: x, clientY: y, view: window }, extra)));
      fire("pointerdown", PointerEvent, { pointerId: 1, pointerType: "mouse" });
      fire("mousedown", MouseEvent, {});
      fire("pointerup", PointerEvent, { pointerId: 1, pointerType: "mouse" });
      fire("mouseup", MouseEvent, {});
      fire("click", MouseEvent, {});
      return true;
    }, { x: down0.cx, y: down0.cy });
    ok(mouseAt, O + ": synthetic mouse events dispatched");
    await sleep(200);
    ok((await menuI()) === pressed, O + ": synthetic mouse after touch does not double-fire (" + (await menuI()) + ")");
    ok(!(await readLayout(page)).downOn, O + ": synthetic mouse does not leave DOWN held");

    // touchcancel releases a held press.
    const b2 = await menuI();
    await touch("touchStart", down0.cx, down0.cy);
    await sleep(80);
    const mid = await menuI();
    ok(mid === (b2 + 1) % nItems, O + ": second DOWN press moves once (" + b2 + " -> " + mid + ")");
    ok((await readLayout(page)).downOn, O + ": DOWN held before cancel");
    await touch("touchCancel");
    await sleep(80);
    ok(!(await readLayout(page)).downOn, O + ": touchcancel releases DOWN");
    await sleep(180);
    ok((await menuI()) === mid, O + ": touchcancel does not fire an extra menu step");

    // UP uses the same menu-up action as ArrowUp.
    const up = center(await readLayout(page), "up");
    const bu = await menuI();
    await touch("touchStart", up.cx, up.cy);
    await sleep(90);
    const au = await menuI();
    await touch("touchEnd");
    await sleep(60);
    ok(au === (bu + nItems - 1) % nItems, O + ": UP moves the menu the other way (" + bu + " -> " + au + ")");

    // Keyboard ArrowDown still steps the same menu, once.
    const bk = await menuI();
    await page.keyboard.down("ArrowDown");
    await sleep(80);
    const ak = await menuI();
    await page.keyboard.up("ArrowDown");
    await sleep(120);
    ok(ak === (bk + 1) % nItems, O + ": ArrowDown still steps the menu once (" + bk + " -> " + ak + ")");
    ok((await menuI()) === ak, O + ": holding ArrowDown does not repeat");

    await page.mouse.move(0, 0);
    await sleep(40);
    await page.screenshot({ path: `${OUT}/phone-panel-${O}.png` });

    ok(!errs.length, O + ": no console errors " + errs.join(" | "));
    await ctx.close();
  }

  await browser.close();
  console.log("RESULT touch-down " + pass + "/" + (pass + fail));
  if (fail) {
    console.log(failures.map((m) => " - " + m).join("\n"));
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
