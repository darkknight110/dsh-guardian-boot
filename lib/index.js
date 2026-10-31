/**
 * dsh-guardian-boot — DSH 启动界面（Host 半侧）
 *
 * 做法：webServer 挂一条 /guardian 静态路由，再用 tapIndex 往首页注入一层
 * 全屏 iframe。用 iframe 而不是把脚本塞进首页，是为了三件事：
 *   1. 不污染宿主 DOM / 全局作用域（这片 1900 行脚本有自己的 document 假设）
 *   2. 播放时可以把整层直接 remove，宿主零残留
 *   3. 音频自动播放策略按 iframe 自己的 allow 属性走，宿主不用改主进程
 *
 * 没有 webServer 的形态（例如将来桌面端改成 file:// + IPC 下发前端）不会报错，
 * 只是不注入——插件仍然 APPLIED。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const name = "dsh-guardian-boot";
export const inject = ["webServer", "connection"];

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, "public");
const ROUTE = "/guardian";

/* 自检计数器：桌面端到底有没有走 tapIndex、注入脚本有没有在窗口里跑起来。 */
const STATS = { version: "1.0.2", taps: 0, boots: 0, shown: 0, done: [], errors: [], lastTapAt: 0 };

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wav": "audio/wav",
  ".png": "image/png",
  ".webp": "image/webp"
};

function getService(ctx, key) {
  try {
    if (typeof ctx.get === "function") return ctx.get(key);
  } catch (err) {
    /* 上下文未就绪时 ctx.get 会抛，按不可达处理 */
  }
  return ctx[key];
}

function send(res, code, type, body, cache) {
  res.writeHead(code, {
    "Content-Type": type,
    "Cache-Control": cache || "no-store",
    "Content-Length": String(body.length)
  });
  res.end(body);
}

function servePublic(res, rel) {
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    send(res, 404, "text/plain", Buffer.from("not found"));
    return;
  }
  let bytes;
  try {
    bytes = fs.readFileSync(file);
  } catch (err) {
    send(res, 404, "text/plain", Buffer.from("not found"));
    return;
  }
  send(res, 200, MIME[path.extname(file).toLowerCase()] || "application/octet-stream", bytes);
}

/* 注入的关键样式：必须先生效，否则首页会先闪一下再被盖住 */
const CRITICAL_CSS = `
html.guardian-lock, html.guardian-lock body { overflow: hidden !important; }
#guardian-root {
  position: fixed; inset: 0; z-index: 2147483000; background: #010304;
  opacity: 1; transition: opacity .45s ease;
}
#guardian-root.is-leaving { opacity: 0; pointer-events: none; }
#guardian-root iframe { width: 100%; height: 100%; border: 0; display: block; background: #010304; }
`;

/* 首页里的接管脚本：频次门、卸载、焦点交还、兜底超时 */
const BOOTSTRAP_JS = String.raw`
(function () {
  var KEY = 'guardian-boot:shown';

  function beacon(type, data) {
    try {
      var body = JSON.stringify({
        type: type,
        data: data || null,
        href: String(location.href).slice(0, 140),
        at: Date.now()
      });
      if (navigator.sendBeacon) navigator.sendBeacon('/guardian/beacon', body);
      else fetch('/guardian/beacon', { method: 'POST', body: body, keepalive: true }).catch(function () {});
    } catch (e) {}
  }

  beacon('boot', {
    hasRoot: !!document.getElementById('guardian-root'),
    hasFrame: !!document.getElementById('guardian-frame'),
    protocol: location.protocol
  });

  window.addEventListener('error', function (e) {
    beacon('error', { m: String(e.message).slice(0, 140), src: String(e.filename).slice(0, 140) });
  });

  try {
    if (sessionStorage.getItem(KEY)) { beacon('gate'); return; }
  } catch (e) {}

  var root = document.getElementById('guardian-root');
  if (!root) { beacon('no-root'); return; }

  /* 关键：src 延迟到"过门"之后才赋值。
     否则浏览器会在 display:none 的 iframe 里照样下载 540KB、启动动画和音频。 */
  var frame = document.getElementById('guardian-frame');
  if (frame && frame.dataset.src) {
    frame.src = frame.dataset.src;
    delete frame.dataset.src;
  }

  root.hidden = false;
  document.documentElement.classList.add('guardian-lock');
  beacon('shown');

  var finished = false;
  function done(reason) {
    if (finished) return;
    finished = true;
    beacon('done', { reason: reason });
    try { sessionStorage.setItem(KEY, '1'); } catch (e) {}
    document.documentElement.classList.remove('guardian-lock');
    document.documentElement.style.overflow = '';
    if (document.body) document.body.style.overflow = '';
    root.classList.add('is-leaving');
    setTimeout(function () {
      if (root.parentNode) root.parentNode.removeChild(root);
      try { window.dispatchEvent(new CustomEvent('dsh-startup:done', { detail: { reason: reason } })); } catch (e) {}
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          var composer = document.querySelector('textarea, [contenteditable="true"], [role="textbox"]');
          if (composer && composer.focus) composer.focus();
        });
      });
    }, 480);
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'guardian:enter' || data.type === 'guardian:skip') done(data.type);
  });

  /* 兜底：iframe 没起来 / 用户不点 / 脚本挂了，也绝不会卡住主界面 */
  setTimeout(function () { done('timeout'); }, 32000);
})();
`;

function injectOverlay(html) {
  if (!html || html.includes("id=\"guardian-root\"")) return html;

  const head =
    '<style id="guardian-critical">' + CRITICAL_CSS + "</style>";

  /*
   * The client bundle owns the iframe. New desktop renderers use dsh-app://
   * rather than the HTTP origin, so injecting <script src="/guardian/...">
   * here would resolve to dsh-app://app/guardian/... and never execute.
   * The empty root stays hidden until dsh.client mounts the self-contained
   * srcdoc iframe.
   */
  const body = '<div id="guardian-root" hidden></div>';

  let out = html;
  if (out.includes("</head>")) out = out.replace("</head>", head + "</head>");
  else out = head + out;

  if (out.includes("<body>")) out = out.replace("<body>", "<body>" + body);
  else if (out.includes("</body>")) out = out.replace("</body>", body + "</body>");
  else out += body;

  return out;
}

export function apply(ctx) {
  const server = getService(ctx, "webServer");
  const canRegister = !!server && typeof server.register === "function";
  const canTap = !!server && typeof server.tapIndex === "function";

  if (!canRegister && !canTap) {
    try {
      ctx.logger?.warn?.(
        "[dsh-guardian-boot] 当前 profile 没有可用的 webServer，启动界面不注入。"
      );
    } catch (err) {
      /* 日志失败不影响加载 */
    }
    return;
  }

  const disposers = [];

  if (canRegister) {
    disposers.push(
      server.register({
        kind: "prefix",
        path: ROUTE,
        handler: (req, res) => {
          const raw = (req.url || "").split("?")[0];
          let rel = raw.slice(ROUTE.length).replace(/^\/+/, "");
          try {
            rel = decodeURIComponent(rel);
          } catch (err) {
            send(res, 400, "text/plain", Buffer.from("bad path"));
            return;
          }
          if (!rel) rel = "boot.html";

          /* —— 自检通道（只读、无鉴权、不写盘）—— */
          if (rel === "boot.js") {
            send(res, 200, "application/javascript; charset=utf-8", Buffer.from(BOOTSTRAP_JS, "utf8"));
            return;
          }
          if (rel === "stats.json") {
            const body = Buffer.from(JSON.stringify(STATS, null, 2), "utf8");
            send(res, 200, "application/json; charset=utf-8", body);
            return;
          }
          if (rel === "beacon") {
            let size = 0;
            let chunks = [];
            req.on("data", (c) => {
              size += c.length;
              if (size > 4096) { req.destroy(); return; }
              chunks.push(c);
            });
            req.on("end", () => {
              let payload = null;
              try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch (err) {}
              if (payload && typeof payload === "object") {
                if (payload.type === "boot") STATS.boots += 1;
                else if (payload.type === "shown") STATS.shown += 1;
                else if (payload.type === "done") STATS.done.push(String(payload.data && payload.data.reason || "?"));
                else STATS.errors.push({ type: payload.type, data: payload.data, href: payload.href });
                while (STATS.errors.length > 20) STATS.errors.shift();
                while (STATS.done.length > 20) STATS.done.shift();
              }
              res.writeHead(204);
              res.end();
            });
            return;
          }

          if (!/^[a-z0-9._/-]+$/i.test(rel) || rel.includes("..")) {
            send(res, 404, "text/plain", Buffer.from("not found"));
            return;
          }
          servePublic(res, rel);
        }
      })
    );
  }

  if (canTap) {
    disposers.push(
      server.tapIndex((html) => {
        STATS.taps += 1;
        STATS.lastTapAt = Date.now();
        return injectOverlay(html);
      })
    );
  }

  try {
    ctx.effect?.(() => () => {
      for (const dispose of disposers) {
        try {
          dispose();
        } catch (err) {
          /* noop */
        }
      }
    });
  } catch (err) {
    /* 老版本没有 effect：路由随进程回收，可接受 */
  }
}
