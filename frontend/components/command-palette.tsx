"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Bot as BotIcon,
  BookOpen,
  LayoutGrid,
  LogOut,
  MoonStar,
  Plus,
  Sun,
} from "lucide-react";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { useKeyboard } from "@/hooks/use-keyboard";
import { listBots, type BotSummary } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";

const API_DOCS_URL = `${
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
}/docs`;

type CommandPaletteProps = {
  /** External control, optional — usually pair with the cmd+k shortcut below. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function CommandPalette({
  open: controlledOpen,
  onOpenChange,
}: CommandPaletteProps = {}) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;

  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const logout = useAuthStore((s) => s.logout);

  const [bots, setBots] = React.useState<BotSummary[]>([]);

  // Lazy-load the bot list when the palette opens.
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listBots()
      .then((list) => {
        if (!cancelled) setBots(list);
      })
      .catch(() => {
        /* silent — palette still works for navigation */
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useKeyboard(
    "k",
    (e) => {
      e.preventDefault();
      setOpen(!open);
    },
    { meta: true, allowInInput: true },
  );

  const run = React.useCallback(
    (action: () => void) => {
      setOpen(false);
      action();
    },
    [setOpen],
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <Command shouldFilter loop>
        <CommandInput placeholder="Search actions, bots, settings…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>

          <CommandGroup heading="Navigation">
            <CommandItem
              onSelect={() => run(() => router.push("/dashboard"))}
              keywords={["dashboard", "home", "bots"]}
            >
              <LayoutGrid />
              <span>Dashboard</span>
              <CommandShortcut>G D</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() => run(() => router.push("/dashboard/new"))}
              keywords={["new", "create", "bot"]}
            >
              <Plus />
              <span>New bot</span>
            </CommandItem>
            <CommandItem
              onSelect={() => run(() => window.open(API_DOCS_URL, "_blank"))}
              keywords={["api", "docs", "documentation"]}
            >
              <BookOpen />
              <span>API docs</span>
            </CommandItem>
          </CommandGroup>

          {bots.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Bots">
                {bots.slice(0, 8).map((b) => (
                  <CommandItem
                    key={b.bot_id}
                    onSelect={() =>
                      run(() => router.push(`/bot/${b.bot_id}`))
                    }
                    keywords={[b.website_name, b.website_url, b.bot_id]}
                  >
                    <BotIcon />
                    <span className="truncate">
                      {b.website_name || b.bot_id}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          <CommandSeparator />
          <CommandGroup heading="Account">
            <CommandItem
              onSelect={() =>
                run(() => setTheme(theme === "dark" ? "light" : "dark"))
              }
              keywords={["theme", "dark", "light", "toggle"]}
            >
              {theme === "dark" ? <Sun /> : <MoonStar />}
              <span>Toggle theme</span>
            </CommandItem>
            <CommandItem
              onSelect={() => run(() => window.open(API_DOCS_URL, "_blank"))}
              keywords={["documentation", "help"]}
            >
              <BookOpen />
              <span>Documentation</span>
            </CommandItem>
            <CommandItem
              onSelect={() =>
                run(() => {
                  logout();
                  router.replace("/login");
                })
              }
              keywords={["logout", "signout", "sign out"]}
            >
              <LogOut />
              <span>Sign out</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
