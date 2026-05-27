/*
 * Call panel running inside the widget iframe.
 *
 * Reads bot_id, api_key, base from URL. Opens a WebSocket to
 * /ws/call/{bot_id}, streams mic audio as base64 float32 chunks, and plays
 * server-side TTS MP3 audio back via <audio> blob URLs (per-utterance, not
 * per-chunk, because edge-tts chunks aren't framed for decodeAudioData).
 */
(function () {
  var params = new URLSearchParams(location.search);
  var botId = params.get("bot_id") || "";
  var apiKey = params.get("api_key") || "";
  var base = params.get("base") || "";

  var titleEl = document.getElementById("title");
  var closeBtn = document.getElementById("close");
  var statusEl = document.getElementById("status");
  var transcriptEl = document.getElementById("transcript");
  var timerEl = document.getElementById("timer");
  var muteBtn = document.getElementById("mute");
  var endBtn = document.getElementById("endcall");
  var errorEl = document.getElementById("error");

  var botName = "Assistant";
  var ws = null;
  var mediaStream = null;
  var audioCtx = null;
  var sourceNode = null;
  var processor = null;
  var muted = false;
  var callState = "connecting";
  var startedAt = 0;
  var timerId = 0;
  var currentAudio = null;
  var currentUrl = null;
  // Server streams MP3 chunks per utterance; accumulate until bot_end then
  // play once. Individual chunks aren't standalone-decodable MP3 files.
  var pendingChunks = [];

  function authHeaders(extra) {
    var h = extra || {};
    if (apiKey) h["X-API-Key"] = apiKey;
    return h;
  }

  function setState(s) {
    callState = s;
    document.body.setAttribute("data-state", s);
    var map = {
      connecting: "Connecting…",
      listening: "Listening…",
      processing: "Thinking…",
      speaking: "Speaking…",
      ended: "Call ended",
    };
    statusEl.textContent = map[s] || s;
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  function fmt(sec) {
    var m = Math.floor(sec / 60).toString().padStart(2, "0");
    var s = Math.floor(sec % 60).toString().padStart(2, "0");
    return m + ":" + s;
  }

  function langLabel(lang) {
    var code = (lang || "en").toLowerCase();
    if (code === "ur") return "UR";
    if (code === "en") return "EN";
    return code.slice(0, 2).toUpperCase();
  }

  function appendTranscript(role, text, lang) {
    var row = document.createElement("div");
    row.className = "tr-row " + role;
    var bubble = document.createElement("div");
    bubble.className = "tr-bubble";
    var l = document.createElement("span");
    l.className = "tr-lang";
    l.textContent = langLabel(lang);
    var t = document.createElement("span");
    t.textContent = text;
    bubble.appendChild(l);
    bubble.appendChild(t);
    row.appendChild(bubble);
    transcriptEl.appendChild(row);
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }

  function stopPlayback() {
    if (currentAudio) {
      try { currentAudio.pause(); } catch (e) {}
      currentAudio = null;
    }
    if (currentUrl) {
      try { URL.revokeObjectURL(currentUrl); } catch (e) {}
      currentUrl = null;
    }
  }

  function playMp3(bytes) {
    stopPlayback();
    var blob = new Blob([bytes], { type: "audio/mpeg" });
    var url = URL.createObjectURL(blob);
    currentUrl = url;
    var a = new Audio(url);
    currentAudio = a;
    a.onended = function () {
      if (currentUrl === url) {
        URL.revokeObjectURL(url);
        currentUrl = null;
      }
    };
    a.onerror = function () {
      if (currentUrl === url) {
        URL.revokeObjectURL(url);
        currentUrl = null;
      }
    };
    a.play().catch(function (err) {
      console.warn("audio play failed", err);
    });
  }

  function base64ToBytes(b64) {
    var binary = atob(b64);
    var out = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  function float32ToBase64(buf) {
    var bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    var s = "";
    var CHUNK = 0x8000;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(s);
  }

  function buildWsUrl() {
    var origin = base || location.origin;
    var wsBase = origin.replace(/^http/i, function (m) {
      return m.toLowerCase() === "https" ? "wss" : "ws";
    });
    var query = "";
    if (apiKey) query = "?api_key=" + encodeURIComponent(apiKey);
    return wsBase + "/ws/call/" + encodeURIComponent(botId) + query;
  }

  function endCall(silent) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: "end_call" })); } catch (e) {}
    }
    try { processor && processor.disconnect(); } catch (e) {}
    try { sourceNode && sourceNode.disconnect(); } catch (e) {}
    try { mediaStream && mediaStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    try { audioCtx && audioCtx.close(); } catch (e) {}
    stopPlayback();
    try { ws && ws.close(); } catch (e) {}
    if (timerId) {
      clearInterval(timerId);
      timerId = 0;
    }
    setState("ended");
    if (!silent) {
      try { parent.postMessage({ type: "sitebot:close" }, "*"); } catch (e) {}
    }
  }

  closeBtn.addEventListener("click", function () {
    endCall();
  });
  endBtn.addEventListener("click", function () {
    endCall();
  });
  muteBtn.addEventListener("click", function () {
    muted = !muted;
    muteBtn.setAttribute("aria-pressed", muted ? "true" : "false");
    muteBtn.setAttribute(
      "aria-label",
      muted ? "Unmute microphone" : "Mute microphone"
    );
  });

  // Best-effort header.
  fetch(base + "/bot/" + encodeURIComponent(botId) + "/status", {
    headers: authHeaders(),
  })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (data && data.website_name) {
        botName = data.website_name;
      }
      titleEl.textContent = botName;
    })
    .catch(function () {
      titleEl.textContent = botName;
    });

  function startMic() {
    return navigator.mediaDevices
      .getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      .then(function (stream) {
        mediaStream = stream;
        var Ctor = window.AudioContext || window.webkitAudioContext;
        audioCtx = new Ctor({ sampleRate: 16000 });
        sourceNode = audioCtx.createMediaStreamSource(stream);
        // Buffer size must be a power of two in [256, 16384]; 2048 ≈ 128ms @ 16k.
        processor = audioCtx.createScriptProcessor(2048, 1, 1);
        processor.onaudioprocess = function (e) {
          if (muted) return;
          if (callState === "processing") return;
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          var input = e.inputBuffer.getChannelData(0);
          var copy = new Float32Array(input.length);
          copy.set(input);
          ws.send(
            JSON.stringify({
              type: "audio_chunk",
              data: float32ToBase64(copy),
              sample_rate: 16000,
            })
          );
        };
        sourceNode.connect(processor);
        processor.connect(audioCtx.destination);
      });
  }

  function connectWs() {
    ws = new WebSocket(buildWsUrl());
    ws.onopen = function () {
      // ready will arrive from server.
    };
    ws.onmessage = function (ev) {
      var msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      switch (msg.type) {
        case "ready":
          setState("listening");
          break;
        case "listening":
          setState("listening");
          break;
        case "speech_detected":
          if (callState === "speaking") {
            pendingChunks = [];
            stopPlayback();
          }
          break;
        case "processing":
          setState("processing");
          break;
        case "transcript":
          appendTranscript("user", msg.text || "", msg.lang || "en");
          break;
        case "bot_start":
          pendingChunks = [];
          setState("speaking");
          if (msg.text) appendTranscript("bot", msg.text, "en");
          break;
        case "audio_chunk":
          try {
            if (msg.data) pendingChunks.push(base64ToBytes(msg.data));
          } catch (e) {
            console.warn("audio chunk decode failed", e);
          }
          break;
        case "bot_end":
          if (pendingChunks.length) {
            var total = 0;
            for (var ci = 0; ci < pendingChunks.length; ci++) {
              total += pendingChunks[ci].byteLength;
            }
            var merged = new Uint8Array(total);
            var off = 0;
            for (var cj = 0; cj < pendingChunks.length; cj++) {
              merged.set(pendingChunks[cj], off);
              off += pendingChunks[cj].byteLength;
            }
            pendingChunks = [];
            try { playMp3(merged); } catch (e) { console.warn("play failed", e); }
          }
          setState("listening");
          break;
        case "error":
          showError(msg.message || "Call error");
          endCall();
          break;
        case "pong":
          break;
      }
    };
    ws.onerror = function () {
      showError("Connection error");
    };
    ws.onclose = function () {
      if (callState !== "ended") {
        setState("ended");
        endCall(true);
      }
    };
  }

  // Boot.
  startMic()
    .then(function () {
      connectWs();
      startedAt = Date.now();
      timerId = setInterval(function () {
        timerEl.textContent = fmt(
          Math.floor((Date.now() - startedAt) / 1000)
        );
      }, 1000);
    })
    .catch(function (err) {
      showError("Microphone access denied");
      console.warn("getUserMedia failed", err);
      setState("ended");
    });
})();
