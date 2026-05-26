"use client";

import * as React from "react";
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Loader2,
  Plus,
  Sparkles,
  X,
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
import {
  ApiError,
  regenerateBotQuestions,
  updateBotQuestions,
} from "@/lib/api";
import { gradientBtn } from "@/lib/landing";
import { cn } from "@/lib/utils";

const MAX_QUESTIONS = 8;
const MAX_QUESTION_CHARS = 120;

type QuestionsTabProps = {
  botId: string;
  websiteName: string;
  initialQuestions: string[];
  onSaved?: (questions: string[]) => void;
  onDirtyChange?: (dirty: boolean) => void;
};

type Row = { id: string; value: string };

function rowId() {
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function rowsFrom(values: string[]): Row[] {
  return values.map((v) => ({ id: rowId(), value: v }));
}

function rowsEqualToStrings(rows: Row[], strings: string[]): boolean {
  if (rows.length !== strings.length) return false;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].value !== strings[i]) return false;
  }
  return true;
}

export function QuestionsTab({
  botId,
  websiteName,
  initialQuestions,
  onSaved,
  onDirtyChange,
}: QuestionsTabProps) {
  const [baseline, setBaseline] = React.useState<string[]>(() =>
    initialQuestions.length ? [...initialQuestions] : [""],
  );
  const [rows, setRows] = React.useState<Row[]>(() =>
    rowsFrom(initialQuestions.length ? initialQuestions : [""]),
  );
  const [saving, setSaving] = React.useState(false);
  const [regenLoading, setRegenLoading] = React.useState(false);
  const [confirmRegenOpen, setConfirmRegenOpen] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const newRowIdRef = React.useRef<string | null>(null);
  const inputRefs = React.useRef<Map<string, HTMLInputElement>>(new Map());

  // Drag state for HTML5 drag-and-drop reorder.
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = React.useState<number | null>(null);

  // Focus a freshly-added row after it lands in the DOM.
  React.useEffect(() => {
    if (newRowIdRef.current) {
      const el = inputRefs.current.get(newRowIdRef.current);
      if (el) {
        el.focus();
        newRowIdRef.current = null;
      }
    }
  }, [rows]);

  const setInputRef = (id: string) => (el: HTMLInputElement | null) => {
    if (el) inputRefs.current.set(id, el);
    else inputRefs.current.delete(id);
  };

  const valuesNow = React.useMemo(() => rows.map((r) => r.value), [rows]);
  const trimmedValid = React.useMemo(
    () => valuesNow.map((v) => v.trim()).filter(Boolean),
    [valuesNow],
  );
  const dirty = !rowsEqualToStrings(rows, baseline);

  React.useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  const canSave =
    dirty &&
    trimmedValid.length >= 1 &&
    trimmedValid.length === valuesNow.length &&
    valuesNow.every((v) => v.length <= MAX_QUESTION_CHARS);

  const updateRow = (id: string, value: string) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, value } : r)),
    );
  };

  const removeRow = (id: string) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)));
  };

  const addRow = () => {
    setRows((prev) => {
      if (prev.length >= MAX_QUESTIONS) return prev;
      const id = rowId();
      newRowIdRef.current = id;
      return [...prev, { id, value: "" }];
    });
  };

  const replaceAllWith = (values: string[]) => {
    const trimmed = values
      .map((v) => v.trim())
      .filter(Boolean)
      .slice(0, MAX_QUESTIONS);
    if (trimmed.length === 0) return;
    setRows(rowsFrom(trimmed));
  };

  const moveRow = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    setRows((prev) => {
      if (from >= prev.length || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const onDragStart = (index: number) => (e: React.DragEvent) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
    try {
      e.dataTransfer.setData("text/plain", String(index));
    } catch {
      /* ignore for browsers that block setData on synthetic events */
    }
  };

  const onDragOver = (index: number) => (e: React.DragEvent) => {
    if (dragIndex === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverIndex !== index) setDragOverIndex(index);
  };

  const onDrop = (index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (dragIndex === null) return;
    moveRow(dragIndex, index);
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const onDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const onSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const payload = valuesNow.map((v) => v.trim());
      const res = await updateBotQuestions(botId, payload);
      const next = res.questions ?? payload;
      setBaseline([...next]);
      setRows(rowsFrom(next));
      onSaved?.(next);
      toast.success("Questions updated");
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : "Failed to save questions";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const onRegenerateClick = () => {
    setConfirmRegenOpen(true);
  };

  const onConfirmRegenerate = async () => {
    setRegenLoading(true);
    try {
      const res = await regenerateBotQuestions(botId);
      if (!res.questions?.length) {
        toast.error("AI didn't return any questions — try again.");
        return;
      }
      replaceAllWith(res.questions);
      setConfirmRegenOpen(false);
      toast.success("Generated fresh questions");
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : "Failed to regenerate";
      toast.error(msg);
    } finally {
      setRegenLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">
          Suggested questions
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          These appear as quick-start chips in your chat widget and chat
          preview. Customize them to match your most common queries.
        </p>
      </div>

      <ul className="space-y-2">
        {rows.map((row, idx) => {
          const count = row.value.length;
          const overLimit = count > MAX_QUESTION_CHARS;
          const empty = row.value.trim().length === 0;
          const canDelete = rows.length > 1;
          const isDragged = dragIndex === idx;
          const isDragTarget =
            dragOverIndex === idx && dragIndex !== null && dragIndex !== idx;

          return (
            <li
              key={row.id}
              draggable
              onDragStart={onDragStart(idx)}
              onDragOver={onDragOver(idx)}
              onDrop={onDrop(idx)}
              onDragEnd={onDragEnd}
              className={cn(
                "flex items-start gap-2 rounded-lg border border-border bg-card p-2 transition-colors",
                isDragged && "opacity-50",
                isDragTarget && "border-purple-500/50 ring-1 ring-purple-500/30",
              )}
            >
              <button
                type="button"
                aria-label="Drag to reorder"
                className="mt-2 cursor-grab touch-none text-muted-foreground transition-colors hover:text-foreground active:cursor-grabbing"
              >
                <GripVertical className="h-4 w-4" aria-hidden="true" />
              </button>
              <div className="min-w-0 flex-1">
                <Input
                  ref={setInputRef(row.id)}
                  value={row.value}
                  onChange={(e) => updateRow(row.id, e.target.value)}
                  placeholder={`Question ${idx + 1}`}
                  maxLength={MAX_QUESTION_CHARS}
                  aria-label={`Question ${idx + 1}`}
                  aria-invalid={overLimit || (dirty && empty) ? true : undefined}
                  className="h-9"
                />
                <div className="mt-1 flex items-center justify-between px-0.5 text-[11px]">
                  <span
                    className={cn(
                      "text-muted-foreground",
                      dirty && empty && "text-destructive",
                    )}
                  >
                    {empty
                      ? "Empty questions will block saving"
                      : " "}
                  </span>
                  <span
                    className={cn(
                      "tabular-nums text-muted-foreground",
                      overLimit && "text-destructive",
                    )}
                  >
                    {count}/{MAX_QUESTION_CHARS}
                  </span>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeRow(row.id)}
                disabled={!canDelete}
                aria-label={`Remove question ${idx + 1}`}
                className="mt-1 h-8 w-8 text-muted-foreground hover:text-destructive"
                title={canDelete ? "Remove" : "Keep at least one question"}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addRow}
          disabled={rows.length >= MAX_QUESTIONS}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add question
          <span className="ml-1 text-[11px] text-muted-foreground">
            {rows.length}/{MAX_QUESTIONS}
          </span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRegenerateClick}
          disabled={regenLoading}
        >
          {regenLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Regenerate with AI
        </Button>
      </div>

      <div className="flex flex-col items-start justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3 sm:flex-row sm:items-center">
        <p className="text-sm text-muted-foreground">
          {dirty ? (
            <>
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle" />
              Unsaved changes — apply to update widget chips.
            </>
          ) : (
            "Changes apply to chat widget immediately on save."
          )}
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setRows(rowsFrom(baseline.length ? baseline : [""]));
            }}
            disabled={!dirty || saving}
          >
            Reset
          </Button>
          <button
            type="button"
            className={cn(gradientBtn("sm"))}
            onClick={onSave}
            disabled={!canSave || saving}
          >
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Saving…
              </>
            ) : (
              "Save changes"
            )}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <button
          type="button"
          onClick={() => setPreviewOpen((o) => !o)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-foreground"
          aria-expanded={previewOpen}
        >
          <span>Preview</span>
          {previewOpen ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          )}
        </button>
        {previewOpen && (
          <div className="border-t border-border bg-background/40 px-4 py-6">
            <div className="flex flex-col items-center justify-center text-center">
              <div className="relative mb-3">
                <div
                  aria-hidden="true"
                  className="absolute inset-0 -z-10 rounded-full bg-gradient-to-br from-indigo-500/30 via-purple-500/30 to-pink-500/30 blur-2xl"
                />
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white shadow-lg">
                  <Sparkles className="h-6 w-6" aria-hidden="true" />
                </div>
              </div>
              <h3 className="text-base font-semibold">Try your bot</h3>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                Ask anything about{" "}
                <span className="text-foreground">
                  {websiteName || "this site"}
                </span>
                .
              </p>
              <div className="mt-4 flex max-w-xl flex-wrap items-center justify-center gap-2">
                {trimmedValid.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Add at least one question to preview.
                  </p>
                ) : (
                  trimmedValid.map((q, i) => (
                    <span
                      key={`${q}-${i}`}
                      className="inline-flex h-8 items-center rounded-full border border-border bg-background px-3 text-xs text-foreground"
                    >
                      {q}
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <Dialog open={confirmRegenOpen} onOpenChange={setConfirmRegenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate questions with AI?</DialogTitle>
            <DialogDescription>
              The current questions will be replaced with AI-generated ones
              based on your indexed website content. You can still edit them
              before saving.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmRegenOpen(false)}
              disabled={regenLoading}
            >
              Cancel
            </Button>
            <button
              type="button"
              className={cn(gradientBtn("md"))}
              onClick={onConfirmRegenerate}
              disabled={regenLoading}
            >
              {regenLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Generating…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  Regenerate
                </>
              )}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export type { QuestionsTabProps };
