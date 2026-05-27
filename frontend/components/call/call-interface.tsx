"use client";

import * as React from "react";
import { Loader2, Mic, MicOff, Phone, PhoneOff, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { callWebSocketUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Tiny Web Audio tone synth for call UX feedback. Generates ringing,
 * connect, hangup, and notification beep tones on-the-fly so we don't
 * need to ship audio assets.
 */
class CallSounds {
  private ctx: AudioContext | null = null;

  private getContext(): AudioContext {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === "suspended") {
      // Best-effort; ignore rejection (browser may require a fresh gesture).
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private _tone(
    ctx: AudioContext,
    freq: number,
    startOffset: number,
    duration: number,
    peak = 0.2,
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = freq;
    const start = ctx.currentTime + startOffset;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + 0.02);
    gain.gain.linearRampToValueAtTime(peak, start + duration - 0.02);
    gain.gain.linearRampToValueAtTime(0, start + duration);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  /** One classic two-tone ring cycle (~1.5 s). */
  async playRingCycle(): Promise<void> {
    const ctx = this.getContext();
    // 400 Hz then 450 Hz, 0.75 s each.
    this._tone(ctx, 400, 0, 0.6, 0.25);
    this._tone(ctx, 450, 0.7, 0.6, 0.25);
    await this._sleep(1500);
  }

  /** Short ascending two-beep — call connected. */
  async playConnected(): Promise<void> {
    const ctx = this.getContext();
    this._tone(ctx, 440, 0, 0.1, 0.18);
    this._tone(ctx, 880, 0.15, 0.1, 0.18);
    await this._sleep(300);
  }

  /** Three descending tones — call ended. */
  async playHangup(): Promise<void> {
    const ctx = this.getContext();
    const tones = [480, 440, 400];
    tones.forEach((f, i) => this._tone(ctx, f, i * 0.15, 0.12, 0.22));
    await this._sleep(500);
  }

  /** Brief beep — bot finished speaking, your turn. */
  async playBeep(): Promise<void> {
    const ctx = this.getContext();
    this._tone(ctx, 800, 0, 0.09, 0.1);
    await this._sleep(120);
  }
}

const callSounds = new CallSounds();

type CallState =
  | "idle"
  | "connecting"
  | "listening"
  | "processing"
  | "speaking"
  | "ended";

type Lang = "en" | "ur" | string;

type TranscriptItem = {
  role: "user" | "bot";
  text: string;
  lang: Lang;
  ts: number;
};

type CallInterfaceProps = {
  botId: string;
  botName: string;
  onEnd: () => void;
};

function fmtDuration(seconds: number) {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

function langLabel(l: Lang): string {
  if (!l) return "EN";
  const code = l.toLowerCase();
  if (code === "ur") return "UR";
  if (code === "en") return "EN";
  return code.slice(0, 2).toUpperCase();
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function float32ToBase64(buf: Float32Array): string {
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + CHUNK) as unknown as number[],
    );
  }
  return btoa(s);
}

export function CallInterface({ botId, botName, onEnd }: CallInterfaceProps) {
  const [callState, setCallState] = React.useState<CallState>("connecting");
  const [transcript, setTranscript] = React.useState<TranscriptItem[]>([]);
  const [callDuration, setCallDuration] = React.useState(0);
  const [muted, setMuted] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const wsRef = React.useRef<WebSocket | null>(null);
  const mediaStreamRef = React.useRef<MediaStream | null>(null);
  const audioContextRef = React.useRef<AudioContext | null>(null);
  const workletNodeRef = React.useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef = React.useRef<MediaStreamAudioSourceNode | null>(null);
  const playbackAudioRef = React.useRef<HTMLAudioElement | null>(null);
  const playbackUrlRef = React.useRef<string | null>(null);
  // Server now streams MP3 chunks per utterance — accumulate until bot_end,
  // then decode + play once. Individual chunks from ElevenLabs aren't
  // framed as standalone MP3 files, so per-chunk decode would fail.
  const pendingMp3Ref = React.useRef<Uint8Array[]>([]);
  // Interrupt detector: barge in only after several consecutive speech
  // frames (debounces against cough/click false positives).
  const speechFrameCountRef = React.useRef(0);
  const INTERRUPT_FRAMES_NEEDED = 3; // ~300 ms at 100 ms / frame
  // Ringing loop control flag — set true while connecting, false when
  // the server sends `ready` (or on error/end).
  const ringingRef = React.useRef(false);
  const mutedRef = React.useRef(false);
  const callStateRef = React.useRef<CallState>("connecting");
  const startedAtRef = React.useRef<number>(Date.now());
  const transcriptScrollRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  React.useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  const appendTranscript = React.useCallback(
    (role: "user" | "bot", text: string, lang: Lang) => {
      setTranscript((prev) => [...prev, { role, text, lang, ts: Date.now() }]);
    },
    [],
  );

  const cleanup = React.useCallback(() => {
    ringingRef.current = false;
    try {
      workletNodeRef.current?.port.close();
    } catch {
      /* ignore */
    }
    try {
      workletNodeRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      sourceNodeRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    try {
      audioContextRef.current?.close();
    } catch {
      /* ignore */
    }
    if (playbackAudioRef.current) {
      try {
        playbackAudioRef.current.pause();
      } catch {
        /* ignore */
      }
      playbackAudioRef.current = null;
    }
    if (playbackUrlRef.current) {
      try {
        URL.revokeObjectURL(playbackUrlRef.current);
      } catch {
        /* ignore */
      }
      playbackUrlRef.current = null;
    }
    try {
      wsRef.current?.close();
    } catch {
      /* ignore */
    }
    workletNodeRef.current = null;
    sourceNodeRef.current = null;
    mediaStreamRef.current = null;
    audioContextRef.current = null;
    wsRef.current = null;
  }, []);

  const stopPlayback = React.useCallback(() => {
    if (playbackAudioRef.current) {
      try {
        playbackAudioRef.current.pause();
        playbackAudioRef.current.currentTime = 0;
      } catch {
        /* ignore */
      }
    }
    if (playbackUrlRef.current) {
      try {
        URL.revokeObjectURL(playbackUrlRef.current);
      } catch {
        /* ignore */
      }
      playbackUrlRef.current = null;
    }
  }, []);

  const playMp3 = React.useCallback((mp3: Uint8Array) => {
    stopPlayback();
    // Slice into a fresh buffer so TS sees a concrete ArrayBuffer rather
    // than the ArrayBufferLike union (which includes SharedArrayBuffer).
    const buffer = mp3.slice().buffer;
    const blob = new Blob([buffer], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    playbackUrlRef.current = url;
    const audio = new Audio(url);
    playbackAudioRef.current = audio;
    audio.onended = () => {
      if (playbackUrlRef.current === url) {
        URL.revokeObjectURL(url);
        playbackUrlRef.current = null;
      }
    };
    audio.onerror = () => {
      if (playbackUrlRef.current === url) {
        URL.revokeObjectURL(url);
        playbackUrlRef.current = null;
      }
    };
    audio.play().catch((err) => {
      console.warn("Audio playback failed", err);
    });
  }, [stopPlayback]);

  const sendInterrupt = React.useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "interrupt" }));
    }
    pendingMp3Ref.current = [];
    stopPlayback();
  }, [stopPlayback]);

  const endCall = React.useCallback(() => {
    ringingRef.current = false;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "end_call" }));
      } catch {
        /* ignore */
      }
    }
    // Best-effort hangup tone — don't block cleanup waiting for it.
    callSounds.playHangup().catch(() => {});
    cleanup();
    setCallState("ended");
    onEnd();
  }, [cleanup, onEnd]);

  // Call duration ticker.
  React.useEffect(() => {
    startedAtRef.current = Date.now();
    const id = window.setInterval(() => {
      setCallDuration(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  // Auto-scroll transcript to bottom.
  React.useEffect(() => {
    if (transcriptScrollRef.current) {
      transcriptScrollRef.current.scrollTop =
        transcriptScrollRef.current.scrollHeight;
    }
  }, [transcript.length]);

  // Set up mic + WebSocket on mount.
  React.useEffect(() => {
    let cancelled = false;

    // Kick off the ringing tone loop until the server says "ready".
    ringingRef.current = true;
    (async () => {
      while (ringingRef.current && !cancelled) {
        try {
          await callSounds.playRingCycle();
        } catch {
          /* ignore */
        }
        if (!ringingRef.current) break;
        await new Promise((r) => setTimeout(r, 700));
      }
    })();

    async function start() {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: { ideal: 16000 },
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Microphone permission denied";
        setErrorMsg(msg);
        toast.error("Microphone access denied");
        setCallState("ended");
        onEnd();
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      mediaStreamRef.current = stream;

      const AudioCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AudioCtor({ sampleRate: 16000 });
      audioContextRef.current = ctx;

      try {
        await ctx.audioWorklet.addModule("/audio-processor.js");
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "Failed to load audio processor";
        console.warn("AudioWorklet load failed", err);
        setErrorMsg(msg);
        toast.error("Audio init failed");
        setCallState("ended");
        onEnd();
        return;
      }
      if (cancelled) return;

      const sourceNode = ctx.createMediaStreamSource(stream);
      sourceNodeRef.current = sourceNode;

      const workletNode = new AudioWorkletNode(ctx, "audio-processor");
      workletNodeRef.current = workletNode;

      const wsUrl = callWebSocketUrl(botId);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        setCallState("connecting");
      };

      ws.onmessage = (ev) => {
        let msg: { type: string; [k: string]: unknown };
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        switch (msg.type) {
          case "ready":
            ringingRef.current = false;
            callSounds.playConnected().catch(() => {});
            setCallState("listening");
            break;
          case "listening":
            setCallState("listening");
            break;
          case "speech_detected":
            // If we're mid-playback, halt it; the server already counted it
            // as an interrupt on its side.
            if (callStateRef.current === "speaking") stopPlayback();
            break;
          case "processing":
            setCallState("processing");
            break;
          case "transcript": {
            const text = (msg.text as string) || "";
            const lang = (msg.lang as string) || "en";
            if (text) appendTranscript("user", text, lang);
            break;
          }
          case "bot_start": {
            const text = (msg.text as string) || "";
            pendingMp3Ref.current = [];
            setCallState("speaking");
            if (text) appendTranscript("bot", text, "en");
            break;
          }
          case "audio_chunk": {
            const b64 = (msg.data as string) || "";
            if (b64) {
              try {
                pendingMp3Ref.current.push(base64ToBytes(b64));
              } catch (e) {
                console.warn("Audio chunk decode failed", e);
              }
            }
            break;
          }
          case "bot_end": {
            const chunks = pendingMp3Ref.current;
            pendingMp3Ref.current = [];
            if (chunks.length > 0) {
              const total = chunks.reduce((n, c) => n + c.byteLength, 0);
              const merged = new Uint8Array(total);
              let off = 0;
              for (const c of chunks) {
                merged.set(c, off);
                off += c.byteLength;
              }
              try {
                playMp3(merged);
              } catch (e) {
                console.warn("Audio play failed", e);
              }
            }
            // Subtle beep so the user knows the bot finished — handy when
            // the streamed MP3 takes a beat to start. Fire-and-forget.
            callSounds.playBeep().catch(() => {});
            setCallState("listening");
            break;
          }
          case "error": {
            const message = (msg.message as string) || "Call error";
            toast.error(message);
            setErrorMsg(message);
            endCall();
            break;
          }
          case "pong":
            break;
          default:
            break;
        }
      };

      ws.onerror = () => {
        toast.error("Connection error");
      };

      ws.onclose = () => {
        if (!cancelled) {
          setCallState("ended");
          onEnd();
        }
      };

      workletNode.port.onmessage = (e: MessageEvent) => {
        if (mutedRef.current) return;
        if (callStateRef.current === "processing") return;
        const payload = e.data as {
          type?: string;
          data?: ArrayBuffer;
          is_speech?: boolean;
        };
        if (payload?.type !== "audio_chunk" || !payload.data) return;
        const float32 = new Float32Array(payload.data);

        // Barge-in: require N consecutive speech frames (debounces against
        // cough/click false positives) AND we're in the speaking state.
        // The worklet computes RMS against a calibrated ambient floor and
        // sends `is_speech` per chunk.
        if (payload.is_speech) {
          speechFrameCountRef.current += 1;
        } else {
          speechFrameCountRef.current = 0;
        }
        if (
          callStateRef.current === "speaking" &&
          speechFrameCountRef.current >= INTERRUPT_FRAMES_NEEDED
        ) {
          try {
            ws.send(JSON.stringify({ type: "interrupt" }));
          } catch {
            /* ignore */
          }
          pendingMp3Ref.current = [];
          stopPlayback();
          speechFrameCountRef.current = 0;
        }

        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(
          JSON.stringify({
            type: "audio_chunk",
            data: float32ToBase64(float32),
            sample_rate: 16000,
          }),
        );
      };

      sourceNode.connect(workletNode);
      workletNode.connect(ctx.destination);
    }

    start();

    return () => {
      cancelled = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botId]);

  const statusLabel = (() => {
    switch (callState) {
      case "connecting":
        return `Calling ${botName || "your bot"}…`;
      case "listening":
        return "Listening…";
      case "processing":
        return "Thinking…";
      case "speaking":
        return "Speaking…";
      case "ended":
        return "Call ended";
      case "idle":
        return "Ready";
    }
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur">
      <div className="relative flex w-full max-w-md flex-col items-center gap-6 rounded-2xl border border-white/10 bg-zinc-950 px-6 py-8 text-white shadow-2xl">
        <div className="relative">
          {callState === "speaking" && (
            <>
              <span
                aria-hidden="true"
                className="absolute inset-0 -m-2 animate-ping rounded-full bg-emerald-500/30"
              />
              <span
                aria-hidden="true"
                className="absolute inset-0 -m-6 animate-pulse rounded-full bg-emerald-500/10"
              />
            </>
          )}
          {callState === "processing" && (
            <span
              aria-hidden="true"
              className="absolute inset-0 -m-1 animate-spin rounded-full border-2 border-transparent border-t-purple-400 border-r-pink-400"
            />
          )}
          {callState === "listening" && (
            <span
              aria-hidden="true"
              className="absolute inset-0 -m-2 animate-pulse rounded-full bg-indigo-500/15"
            />
          )}
          {callState === "connecting" && (
            <span
              aria-hidden="true"
              className="absolute inset-0 -m-2 animate-pulse rounded-full bg-amber-400/20"
            />
          )}
          <div
            className={cn(
              "relative flex h-32 w-32 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 shadow-2xl",
            )}
          >
            {callState === "connecting" ? (
              <Phone
                className="h-10 w-10 animate-[phone-ring_1.1s_ease-in-out_infinite] text-white"
                aria-hidden="true"
              />
            ) : (
              <Sparkles className="h-10 w-10 text-white" aria-hidden="true" />
            )}
          </div>
          <style>{`
            @keyframes phone-ring {
              0%, 100% { transform: rotate(0deg); }
              10% { transform: rotate(-15deg); }
              20% { transform: rotate(15deg); }
              30% { transform: rotate(-15deg); }
              40% { transform: rotate(0deg); }
            }
          `}</style>
        </div>

        <div className="text-center">
          <h2 className="text-xl font-semibold tracking-tight">
            {botName || "Assistant"}
          </h2>
          <p className="mt-1 text-sm text-white/60">{statusLabel}</p>
        </div>

        <Waveform active={callState === "speaking"} />

        <div
          ref={transcriptScrollRef}
          className="max-h-40 w-full overflow-y-auto rounded-lg border border-white/10 bg-black/30 p-3 text-sm"
          aria-live="polite"
        >
          {transcript.length === 0 ? (
            <p className="text-center text-xs text-white/40">
              Your conversation will appear here.
            </p>
          ) : (
            <ul className="space-y-2">
              {transcript.map((t, i) => (
                <li
                  key={`${t.ts}-${i}`}
                  className={cn(
                    "flex flex-col gap-0.5",
                    t.role === "user" ? "items-end" : "items-start",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex max-w-[90%] items-center gap-1.5 rounded-lg px-2 py-1 text-xs",
                      t.role === "user"
                        ? "bg-white/10 text-white/70"
                        : "bg-emerald-500/15 text-white",
                    )}
                  >
                    <span className="rounded bg-black/30 px-1 text-[10px] font-semibold tracking-wider text-white/60">
                      {langLabel(t.lang)}
                    </span>
                    <span className="whitespace-pre-wrap text-left leading-snug">
                      {t.text}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex w-full items-center justify-between">
          <span className="font-mono text-xs tabular-nums text-white/60">
            {fmtDuration(callDuration)}
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              aria-pressed={muted}
              aria-label={muted ? "Unmute microphone" : "Mute microphone"}
              className={cn(
                "flex h-12 w-12 items-center justify-center rounded-full border transition-colors",
                muted
                  ? "border-amber-400/40 bg-amber-500/20 text-amber-200"
                  : "border-white/10 bg-white/5 text-white hover:bg-white/10",
              )}
            >
              {muted ? (
                <MicOff className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Mic className="h-5 w-5" aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              onClick={endCall}
              aria-label="End call"
              className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500 text-white shadow-lg transition-colors hover:bg-red-400"
            >
              <PhoneOff className="h-5 w-5" aria-hidden="true" />
            </button>
            {callState === "speaking" && (
              <button
                type="button"
                onClick={sendInterrupt}
                aria-label="Interrupt the assistant"
                className="hidden h-10 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 text-xs text-white/80 transition-colors hover:bg-white/10 sm:inline-flex"
              >
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                Interrupt
              </button>
            )}
          </div>
          <span className="w-12" aria-hidden="true" />
        </div>

        {errorMsg && (
          <p className="w-full rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-center text-xs text-red-300">
            {errorMsg}
          </p>
        )}
      </div>
    </div>
  );
}

function Waveform({ active }: { active: boolean }) {
  return (
    <div className="flex h-8 items-end gap-1.5" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={cn(
            "block w-1.5 rounded-full bg-gradient-to-t from-indigo-400 via-purple-400 to-pink-400",
            active ? "animate-[wave_900ms_ease-in-out_infinite]" : "h-2",
          )}
          style={
            active
              ? ({
                  animationDelay: `${i * 90}ms`,
                  height: "100%",
                } as React.CSSProperties)
              : undefined
          }
        />
      ))}
      <style>{`
        @keyframes wave {
          0%, 100% { transform: scaleY(0.3); }
          50% { transform: scaleY(1); }
        }
      `}</style>
    </div>
  );
}
