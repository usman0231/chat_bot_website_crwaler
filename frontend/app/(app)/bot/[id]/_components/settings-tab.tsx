"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  Copy,
  Info,
  Loader2,
  Mic,
  Pause,
  Play,
  Sliders,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ApiError,
  deleteBot,
  fetchVoicePreview,
  listVoices,
  updateBotVoice,
  type StatusResponse,
} from "@/lib/api";
import { gradientBtn } from "@/lib/landing";
import { cn } from "@/lib/utils";

type SettingsTabProps = {
  bot: StatusResponse;
  websiteUrl: string;
};

const RETRIEVED_OPTIONS = [3, 4, 5, 6, 8];

function CopyField({
  value,
  label,
  monospace = true,
}: {
  value: string;
  label: string;
  monospace?: boolean;
}) {
  const [copied, setCopied] = React.useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(`${label} copied`);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy");
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Input
        readOnly
        value={value}
        aria-label={label}
        className={cn(
          "h-9 bg-muted/40",
          monospace && "font-mono text-xs",
        )}
      />
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        onClick={onCopy}
        aria-label={`Copy ${label}`}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        ) : (
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </Button>
    </div>
  );
}

export function SettingsTab({ bot, websiteUrl }: SettingsTabProps) {
  const router = useRouter();
  const [name, setName] = React.useState(bot.website_name);
  const [strictness, setStrictness] = React.useState(0.65);
  const [topK, setTopK] = React.useState(4);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [deleteInput, setDeleteInput] = React.useState("");
  const [deleting, setDeleting] = React.useState(false);

  const onDelete = async () => {
    setDeleting(true);
    try {
      await deleteBot(bot.bot_id);
      toast.success("Bot deleted");
      router.push("/dashboard");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to delete bot";
      toast.error(msg);
      setDeleting(false);
    }
  };

  const deleteEnabled =
    !deleting && deleteInput.trim() === bot.website_name.trim() && !!bot.website_name;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">Configure your bot.</p>
      </div>

      {/* SECTION 1: General */}
      <section className="rounded-xl border border-border bg-card p-5 ring-1 ring-foreground/5">
        <h3 className="text-base font-semibold">General</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Basic information about this bot.
        </p>

        <div className="mt-5 grid gap-5">
          <div>
            <Label htmlFor="bot-name" className="mb-1.5 block">
              Bot name
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="bot-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-9"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled
                title="Coming soon"
                onClick={() =>
                  toast.info("Renaming will be available in the next update")
                }
              >
                Save changes
              </Button>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Renaming will be available in the next update.
            </p>
          </div>

          <div>
            <Label className="mb-1.5 block">Website URL</Label>
            <CopyField value={websiteUrl || "—"} label="Website URL" monospace={false} />
          </div>

          <div>
            <Label className="mb-1.5 block">Bot ID</Label>
            <CopyField value={bot.bot_id} label="Bot ID" />
          </div>

          <div>
            <Label className="mb-1.5 block">Created</Label>
            <p className="text-sm text-muted-foreground">
              {bot.created_at
                ? new Date(bot.created_at).toLocaleString()
                : "—"}
            </p>
          </div>
        </div>
      </section>

      {/* SECTION 2: Behaviour tuning — TODO: restore after backend support lands. */}
      {false && (
      <section className="rounded-xl border border-border bg-card p-5 ring-1 ring-foreground/5">
        <div className="flex items-center gap-2">
          <Sliders className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-base font-semibold">Behaviour tuning</h3>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Fine-tune how the bot decides when to answer.
        </p>

        <div className="mt-5 grid gap-6">
          <div>
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="strictness">Strictness</Label>
              <span className="font-mono text-xs text-muted-foreground">
                {strictness.toFixed(2)}
              </span>
            </div>
            <input
              id="strictness"
              type="range"
              min={0.4}
              max={0.9}
              step={0.01}
              value={strictness}
              onChange={(e) => setStrictness(parseFloat(e.target.value))}
              className="mt-2 w-full accent-purple-500"
              aria-label="Strictness"
            />
            <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
              <span>Strict (0.40)</span>
              <span>Lenient (0.90)</span>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Lower = bot says &quot;I don&apos;t know&quot; more often. Higher
              = bot attempts to answer related questions more aggressively.
            </p>
          </div>

          <div>
            <Label htmlFor="top-k" className="mb-1.5 block">
              Retrieved chunks
            </Label>
            <Select
              value={topK}
              onValueChange={(value) => {
                if (typeof value === "number") setTopK(value);
              }}
            >
              <SelectTrigger
                id="top-k"
                className="w-full max-w-xs"
                aria-label="Retrieved chunks"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RETRIEVED_OPTIONS.map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-2 text-[11px] text-muted-foreground">
              More chunks = more context but slower responses.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2">
            <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Tuning controls are read-only in this preview.</span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                toast.info("Tuning controls coming in next update")
              }
            >
              Save
            </Button>
          </div>
        </div>
      </section>
      )}

      {/* SECTION: Call voice */}
      <CallVoiceSection bot={bot} />

      {/* SECTION 3: Danger zone */}
      <section className="rounded-xl border border-red-500/30 bg-red-500/[0.03] p-5">
        <div className="flex items-center gap-2">
          <AlertTriangle
            className="h-4 w-4 text-red-600 dark:text-red-400"
            aria-hidden="true"
          />
          <h3 className="text-base font-semibold text-red-700 dark:text-red-300">
            Delete this bot
          </h3>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          This will permanently delete the bot and all its indexed content. This
          action cannot be undone.
        </p>
        <div className="mt-4">
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              setDeleteInput("");
              setConfirmOpen(true);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Delete bot
          </Button>
        </div>
      </section>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {bot.website_name || bot.bot_id}?</DialogTitle>
            <DialogDescription>
              Type the bot name to confirm:{" "}
              <span className="font-mono text-foreground">
                {bot.website_name}
              </span>
            </DialogDescription>
          </DialogHeader>
          <Input
            value={deleteInput}
            onChange={(e) => setDeleteInput(e.target.value)}
            placeholder={bot.website_name}
            aria-label="Confirm bot name"
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={onDelete}
              disabled={!deleteEnabled}
            >
              {deleting ? "Deleting…" : "Delete bot"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type VoiceOption = {
  id: string;
  name: string;
  description: string;
};

// Fallback used only if /voice/voices fails — the live list comes from
// the backend so adding a voice in api/voice/tts.py auto-shows here.
const VOICE_OPTIONS_FALLBACK: VoiceOption[] = [
  {
    id: "4tRn1lSkEn13EVTuqb0g",
    name: "Serafina",
    description: "Sweet, expressive female (premium — paid plan)",
  },
  {
    id: "cgSgspJ2msm6clMCkdW9",
    name: "Jessica",
    description: "Warm, conversational female",
  },
  {
    id: "EXAVITQu4vr4xnSDxMaL",
    name: "Sarah",
    description: "Soft, professional female",
  },
  {
    id: "ErXwobaYiN019PkySvjV",
    name: "Antoni",
    description: "Natural, friendly male",
  },
  {
    id: "pNInz6obpgDQGcFmaJgB",
    name: "Adam",
    description: "Professional, clear male",
  },
];

const VOICE_PREVIEW_TEXT =
  "Hello! We're happy to help you today. How can I assist you?";

function CallVoiceSection({ bot }: { bot: StatusResponse }) {
  const [voiceOptions, setVoiceOptions] = React.useState<VoiceOption[]>(
    VOICE_OPTIONS_FALLBACK,
  );
  const initial = bot.voice_id || VOICE_OPTIONS_FALLBACK[0].id;
  const [selectedId, setSelectedId] = React.useState<string>(initial);
  const [savedId, setSavedId] = React.useState<string>(initial);
  const [saving, setSaving] = React.useState(false);
  const [previewingId, setPreviewingId] = React.useState<string | null>(null);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const urlRef = React.useRef<string | null>(null);

  // Hydrate from /voice/voices so backend additions show up without a
  // frontend edit. Falls back silently to the hardcoded list on error.
  React.useEffect(() => {
    let cancelled = false;
    listVoices()
      .then((voices) => {
        if (!cancelled && voices.length > 0) setVoiceOptions(voices);
      })
      .catch(() => {
        /* tolerated — fallback list stays in place */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = selectedId !== savedId;

  const stopPreview = React.useCallback(() => {
    if (audioRef.current) {
      try {
        audioRef.current.pause();
      } catch {
        /* ignore */
      }
      audioRef.current = null;
    }
    if (urlRef.current) {
      try {
        URL.revokeObjectURL(urlRef.current);
      } catch {
        /* ignore */
      }
      urlRef.current = null;
    }
    setPreviewingId(null);
  }, []);

  React.useEffect(() => stopPreview, [stopPreview]);

  const onPreview = async (voiceId: string) => {
    if (previewingId === voiceId) {
      stopPreview();
      return;
    }
    stopPreview();
    setPreviewingId(voiceId);
    try {
      const blob = await fetchVoicePreview(voiceId, VOICE_PREVIEW_TEXT);
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => stopPreview();
      audio.onerror = () => stopPreview();
      await audio.play();
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : "Voice preview failed";
      toast.error(msg);
      setPreviewingId(null);
    }
  };

  const onSave = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const res = await updateBotVoice(bot.bot_id, selectedId);
      setSavedId(res.voice_id);
      toast.success("Voice updated — will apply to next call");
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : "Failed to save voice";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card p-5 ring-1 ring-foreground/5">
      <div className="flex items-center gap-2">
        <Mic className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-base font-semibold">Call voice</h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Pick the voice your bot uses on phone calls. Preview each before
        saving.
      </p>

      <ul className="mt-5 grid gap-2">
        {voiceOptions.map((v) => {
          const checked = selectedId === v.id;
          const previewing = previewingId === v.id;
          return (
            <li key={v.id}>
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                  checked
                    ? "border-purple-500/50 bg-purple-500/5"
                    : "border-border hover:bg-muted/40",
                )}
              >
                <input
                  type="radio"
                  name="voice"
                  value={v.id}
                  checked={checked}
                  onChange={() => setSelectedId(v.id)}
                  className="h-4 w-4 accent-purple-500"
                  aria-label={`Select ${v.name}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{v.name}</span>
                    {savedId === v.id && (
                      <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-300">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {v.description}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.preventDefault();
                    onPreview(v.id);
                  }}
                  disabled={previewingId !== null && !previewing}
                >
                  {previewing ? (
                    <>
                      <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                      Stop
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5" aria-hidden="true" />
                      Preview
                    </>
                  )}
                </Button>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setSelectedId(savedId)}
          disabled={!dirty || saving}
        >
          Reset
        </Button>
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty || saving}
          className={cn(gradientBtn("sm"))}
        >
          {saving ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Saving…
            </>
          ) : (
            "Save voice"
          )}
        </button>
      </div>
    </section>
  );
}
