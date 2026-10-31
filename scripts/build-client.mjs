import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const bootPath = path.join(ROOT, "lib", "public", "boot.html");
const voicesPath = path.join(ROOT, "lib", "public", "audio", "voices.js");
const outPath = path.join(ROOT, "lib", "client.js");

let boot = fs.readFileSync(bootPath, "utf8");
const voices = fs.readFileSync(voicesPath, "utf8");
const marker = '<script src="audio/voices.js"></script>';
if (!boot.includes(marker)) {
  throw new Error("boot.html does not contain the expected voice-script marker");
}
boot = boot.replace(marker, `<script>${voices}</script>`);

const bootB64 = Buffer.from(boot, "utf8").toString("base64");
const source = `window.__ModuleLoader__.load({
  id: "dsh-guardian-boot",
  factory: function () {
    "use strict";

    var module = { exports: {} };
    var BOOT_B64 = ${JSON.stringify(bootB64)};
    var KEY = "guardian-boot:shown:1.0.2";
    var mounted = false;
    var root = null;
    var frame = null;
    var timer = null;
    var state = "idle";

    function decode(base64) {
      var binary = atob(base64);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    }

    function ensureCss() {
      if (document.getElementById("guardian-client-css")) return;
      var style = document.createElement("style");
      style.id = "guardian-client-css";
      style.textContent = [
        "html.guardian-lock,html.guardian-lock body{overflow:hidden!important}",
        "#guardian-root{position:fixed;inset:0;z-index:2147483000;background:#010304;opacity:1;transition:opacity .45s ease}",
        "#guardian-root.is-leaving{opacity:0;pointer-events:none}",
        "#guardian-root iframe{width:100%;height:100%;border:0;display:block;background:#010304}"
      ].join("");
      document.head.appendChild(style);
    }

    function focusComposer() {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          var composer = document.querySelector(
            "textarea, [contenteditable='true'], [role='textbox']"
          );
          if (composer && typeof composer.focus === "function") composer.focus();
        });
      });
    }

    function setState(next) {
      state = next;
      if (root) root.dataset.state = next;
      window.__GUARDIAN_BOOT_STATE__ = next;
    }

    function cleanup() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      document.documentElement.classList.remove("guardian-lock");
      document.documentElement.style.overflow = "";
      if (document.body) document.body.style.overflow = "";
      if (root && root.parentNode) root.parentNode.removeChild(root);
      root = null;
      frame = null;
      mounted = false;
    }

    function done(reason, detail) {
      if (!mounted) return;
      setState("done");
      try { sessionStorage.setItem(KEY, "1"); } catch (_) {}
      if (frame && frame.contentWindow) {
        try { frame.contentWindow.postMessage({ type: "guardian:host-skip" }, "*"); } catch (_) {}
      }
      if (root) root.classList.add("is-leaving");
      document.documentElement.classList.remove("guardian-lock");
      document.documentElement.style.overflow = "";
      if (document.body) document.body.style.overflow = "";
      var payload = {
        reason: reason || "enter",
        detail: detail || null
      };
      try {
        window.dispatchEvent(new CustomEvent("guardian-boot:enter", { detail: payload }));
      } catch (_) {}
      setTimeout(function () {
        cleanup();
        try { window.dispatchEvent(new CustomEvent("dsh-startup:done", { detail: payload })); } catch (_) {}
        focusComposer();
      }, 480);
    }

    function mount(force) {
      if (mounted) return true;
      try {
        if (!force && sessionStorage.getItem(KEY) === "1") {
          var stale = document.getElementById("guardian-root");
          if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
          setState("gated");
          return false;
        }
      } catch (_) {}

      ensureCss();
      root = document.getElementById("guardian-root");
      if (!root) {
        root = document.createElement("div");
        root.id = "guardian-root";
        document.body.appendChild(root);
      }
      root.hidden = false;
      root.removeAttribute("hidden");
      root.className = "";
      root.dataset.state = "loading";

      frame = document.createElement("iframe");
      frame.id = "guardian-frame";
      frame.title = "DeepSeek Harness 启动界面";
      frame.setAttribute("allow", "autoplay; fullscreen");
      frame.setAttribute("scrolling", "no");
      frame.srcdoc = decode(BOOT_B64);
      root.replaceChildren(frame);
      document.documentElement.classList.add("guardian-lock");
      document.documentElement.style.overflow = "hidden";
      if (document.body) document.body.style.overflow = "hidden";
      mounted = true;
      setState("loading");

      window.addEventListener("message", function (event) {
        if (!frame || event.source !== frame.contentWindow) return;
        var data = event.data;
        if (!data || typeof data !== "object") return;
        if (data.type === "guardian:ready") setState("ready");
        else if (data.type === "guardian:enter") done("enter", data.detail);
        else if (data.type === "guardian:skip") done("skip", data.detail);
      });

      timer = setTimeout(function () {
        if (mounted) done("timeout");
      }, 32000);
      return true;
    }

    function apply(ctx) {
      try {
        mount(
          new URLSearchParams(location.search).has("guardian-replay") ||
          new URLSearchParams(location.search).has("guardian")
        );
      } catch (error) {
        setState("error");
        try { console.warn("[dsh-guardian-boot] client mount failed", error); } catch (_) {}
      }
    }

    window.__GUARDIAN_BOOT_API__ = {
      replay: function () {
        try { sessionStorage.removeItem(KEY); } catch (_) {}
        cleanup();
        return mount(true);
      },
      skip: function () { done("api-skip"); },
      get state() { return state; }
    };

    module.exports = {
      name: "dsh-guardian-boot",
      inject: [],
      apply: apply
    };
    return module.exports;
  }
});
`;

fs.writeFileSync(outPath, source, "utf8");
console.log(
  "wrote",
  outPath,
  Math.round(source.length / 1024),
  "KB",
  "from",
  Math.round(boot.length / 1024),
  "KB boot html"
);
