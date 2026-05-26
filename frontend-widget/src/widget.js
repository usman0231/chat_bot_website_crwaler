/*
 * SiteBot embeddable widget — entry point.
 *
 * Loaded on a customer's site as:
 *   <script src=".../widget.js" data-bot-id="..." data-api-key="..." async></script>
 *
 * Injects two floating launcher buttons (chat and call), and on click slides
 * in an iframe pointing at /widget/chat.html or /widget/call.html. The
 * iframes carry the actual UIs; this file only handles mounting + open/close
 * so we don't pollute the host page.
 */
(function () {
  if (window.__sitebotWidgetLoaded) return;
  window.__sitebotWidgetLoaded = true;

  var script =
    document.currentScript ||
    (function () {
      var list = document.querySelectorAll("script[data-bot-id]");
      return list.length ? list[list.length - 1] : null;
    })();
  if (!script) {
    console.warn("[SiteBot] could not locate script tag — widget not mounted");
    return;
  }

  var botId = script.getAttribute("data-bot-id");
  var apiKey = script.getAttribute("data-api-key") || "";
  if (!botId) {
    console.warn("[SiteBot] data-bot-id is required");
    return;
  }

  var baseUrl;
  try {
    baseUrl = new URL(script.src).origin;
  } catch (e) {
    console.warn("[SiteBot] could not parse script src", e);
    return;
  }

  var Z = 2147483646;
  var CHAT_GRADIENT =
    "linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%)";
  var CALL_GRADIENT =
    "linear-gradient(135deg, #10b981 0%, #059669 60%, #047857 100%)";

  function makeButton(opts) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("aria-label", opts.label);
    btn.setAttribute("data-sitebot", opts.dataset);
    btn.style.cssText = [
      "all: initial",
      "position: fixed",
      "right: 20px",
      "bottom: " + opts.bottom + "px",
      "width: " + opts.size + "px",
      "height: " + opts.size + "px",
      "border-radius: 9999px",
      "background: " + opts.gradient,
      "box-shadow: 0 6px 20px rgba(0,0,0,0.25), 0 2px 6px rgba(0,0,0,0.15)",
      "cursor: pointer",
      "display: flex",
      "align-items: center",
      "justify-content: center",
      "z-index: " + (Z + 1),
      "transition: transform 180ms ease, box-shadow 180ms ease",
    ]
      .map(function (s) {
        return s + " !important";
      })
      .join(";");
    btn.innerHTML = opts.svg;
    btn.addEventListener("mouseenter", function () {
      btn.style.setProperty(
        "transform",
        "translateY(-2px) scale(1.04)",
        "important"
      );
    });
    btn.addEventListener("mouseleave", function () {
      btn.style.setProperty("transform", "none", "important");
    });
    return btn;
  }

  // Brand lamp icon — see frontend/components/logo.tsx for the React version.
  var LAMP_SVG =
    '<svg width="32" height="32" viewBox="0 0 80 80" aria-hidden="true">' +
    '<g fill="white">' +
    '<path d="M18 61 Q16 46 25 37 Q32 29 40 32 Q48 29 55 37 Q64 46 62 61 Q55 66 40 68 Q25 66 18 61Z"/>' +
    '<path d="M60 54 Q73 50 75 56 Q73 62 60 60Z"/>' +
    "</g>" +
    '<path d="M18 54 Q10 54 10 60 Q10 65 18 63" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round"/>' +
    '<path d="M40 32 Q37 22 41 14 Q44 7 39 2" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" opacity="0.9"/>' +
    '<path d="M40 32 Q33 20 36 11 Q38 5 34 0" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" opacity="0.7"/>' +
    '<path d="M40 32 Q47 20 44 11 Q42 5 46 0" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" opacity="0.7"/>' +
    "</svg>";

  var chatBtn = makeButton({
    label: "Open chat",
    dataset: "launcher-chat",
    bottom: 20,
    size: 60,
    gradient: CHAT_GRADIENT,
    svg: LAMP_SVG,
  });

  var callBtn = makeButton({
    label: "Start voice call",
    dataset: "launcher-call",
    bottom: 92,
    size: 50,
    gradient: CALL_GRADIENT,
    svg:
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>' +
      "</svg>",
  });

  var chatIframe = null;
  var callIframe = null;
  var chatOpen = false;
  var callOpen = false;

  function isMobile() {
    return window.matchMedia("(max-width: 480px)").matches;
  }

  function applyIframeStyles(iframe, open, opts) {
    if (!iframe) return;
    var mobile = isMobile();
    var base = [
      "all: initial",
      "position: fixed",
      "border: 0",
      "background: " + (opts.bg || "white"),
      "z-index: " + Z,
      "box-shadow: 0 20px 60px rgba(0,0,0,0.18), 0 8px 24px rgba(0,0,0,0.08)",
      "transition: opacity 220ms ease, transform 240ms cubic-bezier(0.16,1,0.3,1)",
      "color-scheme: " + (opts.scheme || "light"),
    ];
    if (mobile) {
      base.push(
        "inset: 0",
        "width: 100%",
        "height: 100%",
        "border-radius: 0"
      );
    } else {
      base.push(
        "bottom: 96px",
        "right: 20px",
        "width: " + opts.width + "px",
        "height: min(" + opts.height + "px, calc(100vh - 116px))",
        "border-radius: 16px",
        "overflow: hidden"
      );
    }
    iframe.style.cssText = base
      .map(function (s) {
        return s + " !important";
      })
      .join(";");
    iframe.style.setProperty(
      "transform",
      open ? "translateY(0)" : "translateY(12px)",
      "important"
    );
    iframe.style.setProperty("opacity", open ? "1" : "0", "important");
    iframe.style.setProperty(
      "pointer-events",
      open ? "auto" : "none",
      "important"
    );
  }

  function ensureChatIframe() {
    if (chatIframe) return;
    chatIframe = document.createElement("iframe");
    chatIframe.setAttribute("title", "SiteGenie chat");
    chatIframe.setAttribute("data-sitebot", "panel-chat");
    chatIframe.setAttribute("loading", "lazy");
    chatIframe.setAttribute("allow", "clipboard-write");
    chatIframe.src =
      baseUrl +
      "/widget/chat.html?bot_id=" +
      encodeURIComponent(botId) +
      "&api_key=" +
      encodeURIComponent(apiKey) +
      "&base=" +
      encodeURIComponent(baseUrl);
    document.body.appendChild(chatIframe);
    applyIframeStyles(chatIframe, false, {
      width: 380,
      height: 600,
      bg: "white",
      scheme: "light",
    });
  }

  function ensureCallIframe() {
    if (callIframe) return;
    callIframe = document.createElement("iframe");
    callIframe.setAttribute("title", "SiteGenie call");
    callIframe.setAttribute("data-sitebot", "panel-call");
    callIframe.setAttribute("loading", "lazy");
    callIframe.setAttribute("allow", "microphone; autoplay");
    callIframe.src =
      baseUrl +
      "/widget/call.html?bot_id=" +
      encodeURIComponent(botId) +
      "&api_key=" +
      encodeURIComponent(apiKey) +
      "&base=" +
      encodeURIComponent(baseUrl);
    document.body.appendChild(callIframe);
    applyIframeStyles(callIframe, false, {
      width: 400,
      height: 650,
      bg: "#09090b",
      scheme: "dark",
    });
  }

  function openChat() {
    if (callOpen) closeCall();
    ensureChatIframe();
    chatOpen = true;
    applyIframeStyles(chatIframe, true, {
      width: 380,
      height: 600,
      bg: "white",
      scheme: "light",
    });
    chatBtn.setAttribute("aria-label", "Close chat");
  }

  function closeChat() {
    chatOpen = false;
    applyIframeStyles(chatIframe, false, {
      width: 380,
      height: 600,
      bg: "white",
      scheme: "light",
    });
    chatBtn.setAttribute("aria-label", "Open chat");
  }

  function openCall() {
    if (chatOpen) closeChat();
    ensureCallIframe();
    callOpen = true;
    applyIframeStyles(callIframe, true, {
      width: 400,
      height: 650,
      bg: "#09090b",
      scheme: "dark",
    });
    callBtn.setAttribute("aria-label", "End call");
  }

  function closeCall() {
    callOpen = false;
    applyIframeStyles(callIframe, false, {
      width: 400,
      height: 650,
      bg: "#09090b",
      scheme: "dark",
    });
    callBtn.setAttribute("aria-label", "Start voice call");
  }

  chatBtn.addEventListener("click", function () {
    chatOpen ? closeChat() : openChat();
  });
  callBtn.addEventListener("click", function () {
    callOpen ? closeCall() : openCall();
  });

  window.addEventListener("message", function (e) {
    if (!e.data) return;
    if (chatIframe && e.source === chatIframe.contentWindow) {
      if (e.data.type === "sitebot:close") closeChat();
    }
    if (callIframe && e.source === callIframe.contentWindow) {
      if (e.data.type === "sitebot:close") closeCall();
    }
  });
  window.addEventListener("resize", function () {
    if (chatIframe)
      applyIframeStyles(chatIframe, chatOpen, {
        width: 380,
        height: 600,
        bg: "white",
        scheme: "light",
      });
    if (callIframe)
      applyIframeStyles(callIframe, callOpen, {
        width: 400,
        height: 650,
        bg: "#09090b",
        scheme: "dark",
      });
  });

  function mount() {
    document.body.appendChild(chatBtn);
    document.body.appendChild(callBtn);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();
