"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BookOpen,
  Command as CommandIcon,
  ExternalLink,
  Key,
  LayoutGrid,
  LogOut,
  Menu,
  Plus,
  Settings,
  User as UserIcon,
} from "lucide-react";

import { BackendStatusDot } from "@/components/app/backend-status-dot";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuth, type Tier, type User } from "@/lib/auth-store";
import { cn } from "@/lib/utils";
import { gradientBtn } from "@/lib/landing";

function getInitials(name: string): string {
  const clean = (name ?? "").trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/).filter(Boolean);
  const letters =
    parts.length === 1
      ? parts[0].slice(0, 2)
      : `${parts[0][0]}${parts[parts.length - 1][0]}`;
  return letters.toUpperCase().slice(0, 2);
}

const API_DOCS_URL = `${
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
}/docs`;

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutGrid;
  external?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Bots", icon: LayoutGrid },
  { href: "/api-keys", label: "API keys", icon: Key },
  {
    href: API_DOCS_URL,
    label: "Documentation",
    icon: BookOpen,
    external: true,
  },
];

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const className = cn(
    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
    active
      ? "bg-muted text-foreground"
      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
  );

  if (item.external) {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        onClick={onNavigate}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="flex-1">{item.label}</span>
        <ExternalLink className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
      </a>
    );
  }

  return (
    <Link href={item.href} className={className} onClick={onNavigate}>
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{item.label}</span>
    </Link>
  );
}

function TierBadge({ tier }: { tier: Tier }) {
  const isPaid = tier !== "free";
  const label = tier.charAt(0).toUpperCase() + tier.slice(1);
  const target = isPaid ? "/account" : "/pricing";
  return (
    <Link
      href={target}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-opacity hover:opacity-90",
        isPaid
          ? "bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white shadow-sm"
          : "bg-muted text-muted-foreground",
      )}
      aria-label={`${label} plan — click to ${isPaid ? "manage" : "upgrade"}`}
    >
      {label}
    </Link>
  );
}

function UserCard({ user }: { user: User }) {
  const router = useRouter();
  const { me, logout } = useAuth();

  function onLogout() {
    logout();
    toast("Signed out");
    router.replace("/login");
  }

  const tier: Tier = me?.tier ?? "free";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-3 rounded-lg border border-border bg-card/60 p-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="User menu"
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-xs font-semibold text-white"
          aria-hidden="true"
        >
          {getInitials(user.name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{user.name}</span>
            <TierBadge tier={tier} />
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {user.email}
          </span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" sideOffset={6} className="w-56">
        <DropdownMenuItem onClick={() => router.push("/account")}>
          <UserIcon className="mr-2 h-4 w-4" />
          Account
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/pricing")}>
          <Settings className="mr-2 h-4 w-4" />
          Plans & billing
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onLogout} variant="destructive">
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SidebarBody({
  user,
  onNavigate,
}: {
  user: User;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <>
      <div className="flex flex-col gap-5 p-4">
        <Link
          href="/dashboard"
          className="inline-flex items-center"
          onClick={onNavigate}
          aria-label="Dashboard home"
        >
          <Logo size="sm" variant="horizontal" />
        </Link>

        <Link
          href="/dashboard/new"
          className={gradientBtn("md", "w-full")}
          onClick={onNavigate}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New bot
        </Link>
      </div>

      <nav
        className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2"
        aria-label="Primary"
      >
        {NAV_ITEMS.map((item) => {
          const active = !item.external && pathname === item.href;
          return (
            <NavLink
              key={item.href}
              item={item}
              active={active}
              onNavigate={onNavigate}
            />
          );
        })}
      </nav>

      <div className="space-y-2 border-t border-border p-3">
        <BackendStatusDot />
        <div
          className="flex items-center justify-between rounded-md px-1.5 py-1 text-[11px] text-muted-foreground"
          aria-hidden="true"
        >
          <span className="inline-flex items-center gap-1.5">
            <CommandIcon className="h-3 w-3" />
            Press ⌘K
          </span>
          <span className="opacity-70">Quick actions</span>
        </div>
        <UserCard user={user} />
      </div>
    </>
  );
}

export function AppSidebar({ user }: { user: User }) {
  return (
    <aside className="hidden w-[260px] shrink-0 flex-col border-r border-border bg-sidebar md:flex">
      <SidebarBody user={user} />
    </aside>
  );
}

export function MobileSidebar({ user }: { user: User }) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();

  // Auto-close on route change.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(false);
  }, [pathname]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Open menu"
        onClick={() => setOpen(true)}
        className="md:hidden"
      >
        <Menu className="h-4 w-4" aria-hidden="true" />
      </Button>
      <SheetContent
        side="left"
        className="flex w-72 max-w-[85vw] flex-col bg-sidebar p-0"
      >
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SheetDescription className="sr-only">
          Application sidebar
        </SheetDescription>
        <SidebarBody user={user} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
