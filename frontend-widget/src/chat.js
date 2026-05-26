/*
 * Chat panel running inside the widget iframe.
 *
 * Reads bot_id, api_key, base from URL query (set by widget.js when it
 * mounts the iframe). Talks to /bot/{id}/status for the header name and
 * /bot/{id}/chat/stream for the SSE conversation. History lives in memory
 * — each page load is a fresh conversation, since the widget is embedded
 * on the customer's site rather than a logged-in dashboard.
 */
(function () {
  var params = new URLSearchParams(location.search);
  var botId = params.get("bot_id") || "";
  var apiKey = params.get("api_key") || "";
  var base = params.get("base") || "";

  var titleEl = document.getElementById("title");
  var closeBtn = document.getElementById("close");
  var messagesEl = document.getElementById("messages");
  var composer = document.getElementById("composer");
  var inputEl = document.getElementById("input");
  var sendBtn = document.getElementById("send");

  var SUGGESTIONS = [
    "What services do you offer?",
    "How can I contact you?",
    "What are your hours?",
    "Tell me about your products",
  ];
  var HISTORY_LIMIT = 6;

  var botName = "Assistant";
  var history = [];
  var streaming = false;

  function authHeaders(extra) {
    var h = extra || {};
    if (apiKey) h["X-API-Key"] = apiKey;
    return h;
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function labelize(url) {
    try {
      var u = new URL(url);
      var p = u.pathname.length > 1 ? u.pathname : "";
      var s = u.hostname + p;
      return s.length > 40 ? s.slice(0, 39) + "…" : s;
    } catch (e) {
      return url.length > 40 ? url.slice(0, 39) + "…" : url;
    }
  }

  function renderEmpty() {
    messagesEl.innerHTML = "";
    var empty = document.createElement("div");
    empty.id = "empty";

    var icon = document.createElement("div");
    icon.className = "emoji";
    icon.innerHTML =
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l1.7 4.5 4.8.4-3.6 3.2 1 4.7L12 12.5 8.1 14.8l1-4.7L5.5 6.9l4.8-.4L12 2z"/></svg>';
    empty.appendChild(icon);

    var title = document.createElement("div");
    title.className = "title";
    title.textContent = "Hi! Ask me anything";
    empty.appendChild(title);

    var sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent =
      "I only answer from " +
      (botName || "this site") +
      "'s content, so I'll politely decline off-topic questions.";
    empty.appendChild(sub);

    var sugs = document.createElement("div");
    sugs.className = "suggestions";
    SUGGESTIONS.forEach(function (q) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "suggestion";
      chip.textContent = q;
      chip.addEventListener("click", function () {
        send(q);
      });
      sugs.appendChild(chip);
    });
    empty.appendChild(sugs);

    messagesEl.appendChild(empty);
  }

  function clearEmpty() {
    var e = document.getElementById("empty");
    if (e) e.remove();
  }

  function addMessage(role, content) {
    clearEmpty();
    var msg = document.createElement("div");
    msg.className = "msg " + role;
    var meta = document.createElement("div");
    meta.className = "meta";
    var bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = content || "";
    meta.appendChild(bubble);
    msg.appendChild(meta);
    messagesEl.appendChild(msg);
    scrollToBottom();
    return { msg: msg, meta: meta, bubble: bubble };
  }

  function appendSources(metaEl, sources) {
    if (!sources || !sources.length) return;
    var wrap = document.createElement("div");
    wrap.className = "sources";
    sources.forEach(function (url) {
      var a = document.createElement("a");
      a.className = "source";
      a.href = url;
      a.target = "_blank";
      a.rel = "noreferrer noopener";
      a.title = url;
      a.textContent = labelize(url);
      wrap.appendChild(a);
    });
    metaEl.appendChild(wrap);
  }

  function appendBadge(metaEl, label) {
    var b = document.createElement("span");
    b.className = "badge";
    b.textContent = label;
    metaEl.appendChild(b);
  }

  // Initial bot info — best-effort, widget still works if it fails.
  fetch(base + "/bot/" + encodeURIComponent(botId) + "/status", {
    headers: authHeaders(),
  })
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (data) {
      if (data && data.website_name) {
        botName = data.website_name;
        titleEl.textContent = botName;
      } else {
        titleEl.textContent = "Assistant";
      }
      renderEmpty();
    })
    .catch(function () {
      titleEl.textContent = "Assistant";
      renderEmpty();
    });

  closeBtn.addEventListener("click", function () {
    try {
      parent.postMessage({ type: "sitebot:close" }, "*");
    } catch (e) {
      /* ignore */
    }
  });

  function send(text) {
    var trimmed = (text || "").trim();
    if (!trimmed || streaming) return;

    var historyToSend = history.slice(-HISTORY_LIMIT);
    addMessage("user", trimmed);
    history.push({ role: "user", content: trimmed });

    inputEl.value = "";
    inputEl.style.height = "auto";
    streaming = true;
    sendBtn.disabled = true;

    var entry = addMessage("bot", "");
    var bubble = entry.bubble;
    var metaEl = entry.meta;
    var cursor = document.createElement("span");
    cursor.className = "cursor";
    bubble.appendChild(cursor);

    var answerText = "";
    var receivedSources = [];
    var inScope = true;

    function fail(content) {
      cursor.remove();
      bubble.textContent =
        content || answerText || "Sorry, something went wrong.";
      entry.msg.className = "msg error";
    }

    fetch(base + "/bot/" + encodeURIComponent(botId) + "/chat/stream", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ message: trimmed, history: historyToSend }),
    })
      .then(function (res) {
        if (!res.ok) throw new Error("http " + res.status);
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var buffer = "";

        function pump() {
          return reader.read().then(function (step) {
            if (step.done) return;
            buffer += decoder.decode(step.value, { stream: true });
            var nl;
            while ((nl = buffer.indexOf("\n\n")) !== -1) {
              var frame = buffer.slice(0, nl);
              buffer = buffer.slice(nl + 2);
              var line = null;
              var lines = frame.split("\n");
              for (var i = 0; i < lines.length; i++) {
                if (lines[i].indexOf("data: ") === 0) {
                  line = lines[i];
                  break;
                }
              }
              if (!line) continue;
              var event;
              try {
                event = JSON.parse(line.slice(6));
              } catch (e) {
                continue;
              }
              if (
                event.type === "token" &&
                typeof event.content === "string"
              ) {
                answerText += event.content;
                bubble.textContent = answerText;
                bubble.appendChild(cursor);
                scrollToBottom();
              } else if (event.type === "meta") {
                inScope = event.in_scope !== false;
                receivedSources = Array.isArray(event.sources)
                  ? event.sources
                  : [];
              } else if (event.type === "error") {
                throw new Error(event.message || "stream error");
              }
            }
            return pump();
          });
        }
        return pump();
      })
      .then(function () {
        cursor.remove();
        if (!inScope) appendBadge(metaEl, "Out of scope");
        appendSources(metaEl, receivedSources);
        history.push({ role: "bot", content: answerText });
      })
      .catch(function () {
        fail();
      })
      .finally(function () {
        streaming = false;
        sendBtn.disabled = false;
        inputEl.focus();
      });
  }

  composer.addEventListener("submit", function (e) {
    e.preventDefault();
    send(inputEl.value);
  });
  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(inputEl.value);
    }
  });
  inputEl.addEventListener("input", function () {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(96, inputEl.scrollHeight) + "px";
  });
})();
