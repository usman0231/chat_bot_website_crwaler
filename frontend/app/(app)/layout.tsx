"use client";

import { AppSidebar, MobileSidebar } from "@/components/app/sidebar";
import { BackendStatusBanner } from "@/components/backend-status-banner";
import { CommandPalette } from "@/components/command-palette";
import { GlobalShortcuts } from "@/components/global-shortcuts";
import { ThemeToggle } from "@/components/theme-toggle";
import { useRequireAuth } from "@/lib/auth-store";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, hydrated } = useRequireAuth();

  if (!hydrated) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!user) {
    // useRequireAuth has triggered a redirect; render nothing in the meantime.
    return null;
  }

  return (
    <div className="flex min-h-[100dvh] w-full">
      <BackendStatusBanner />
      <CommandPalette />
      <GlobalShortcuts />
      <AppSidebar user={user} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-background/80 px-3 backdrop-blur md:justify-end md:px-6">
          <MobileSidebar user={user} />
          <ThemeToggle />
        </header>
        <main className="mx-auto w-full flex-1 px-4 py-6 md:px-8 md:py-8 min-[1920px]:max-w-[1600px]">
          {children}
        </main>
      </div>
    </div>
  );
}
