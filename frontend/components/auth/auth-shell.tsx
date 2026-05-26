import Link from "next/link";
import {
  ArrowLeft,
  Lock,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";

import { Logo } from "@/components/logo";
import { BRAND } from "@/lib/brand";

type AuthShellProps = {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

const VALUE_PROPS = [
  {
    icon: Lock,
    title: "Privacy-first",
    body: "Your data never leaves your server. Local LLM, no third-party APIs.",
  },
  {
    icon: Zap,
    title: "Instant training",
    body: "Paste a URL and get a working chatbot in under a minute.",
  },
  {
    icon: ShieldCheck,
    title: "Strict guardrails",
    body: "Refuses off-topic questions. Only answers from your content.",
  },
];

export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  return (
    <main className="relative isolate mx-auto flex min-h-[100dvh] w-full min-[1920px]:max-w-[1600px]">
      {/* Left hero panel — visible on lg+ */}
      <aside
        aria-hidden="true"
        className="relative hidden w-[44%] flex-col justify-between overflow-hidden p-10 lg:flex xl:w-2/5"
      >
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            backgroundImage:
              "linear-gradient(135deg, rgba(99,102,241,0.12) 0%, rgba(168,85,247,0.10) 50%, rgba(236,72,153,0.10) 100%), radial-gradient(ellipse 60% 50% at 30% 20%, rgba(99,102,241,0.18), transparent 60%), radial-gradient(ellipse 50% 50% at 70% 70%, rgba(236,72,153,0.16), transparent 60%)",
          }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 -z-10 w-px bg-gradient-to-b from-transparent via-border to-transparent"
        />

        <div>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to home
          </Link>
        </div>

        <div className="max-w-md">
          <Link
            href="/"
            className="inline-block"
            aria-label={`${BRAND.name} home`}
          >
            <Logo size="md" variant="horizontal" />
          </Link>
          <h2 className="mt-6 text-3xl font-semibold tracking-tight leading-tight text-balance">
            Train a chatbot on your website in seconds.
          </h2>
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
            {BRAND.description}
          </p>

          <ul className="mt-10 space-y-5">
            {VALUE_PROPS.map((p) => {
              const Icon = p.icon;
              return (
                <li key={p.title} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500/15 via-purple-500/15 to-pink-500/15 ring-1 ring-foreground/5">
                    <Icon
                      className="h-4 w-4 text-foreground/80"
                      aria-hidden="true"
                    />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">{p.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                      {p.body}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <p className="text-[11px] text-muted-foreground">
          <Sparkles
            className="mr-1 inline h-3 w-3 align-[-2px] text-purple-500"
            aria-hidden="true"
          />
          Built for university competition 2026
        </p>
      </aside>

      {/* Right form panel */}
      <section className="relative flex flex-1 flex-col items-center justify-center px-4 py-10 sm:px-6 sm:py-14">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 lg:hidden"
          style={{
            backgroundImage:
              "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(99,102,241,0.08), transparent 60%), radial-gradient(ellipse 60% 60% at 85% 60%, rgba(168,85,247,0.07), transparent 60%), radial-gradient(ellipse 50% 50% at 15% 90%, rgba(236,72,153,0.05), transparent 60%)",
          }}
        />

        <div className="w-full max-w-[440px]">
          {/* Brand mark — only on smaller screens, hero already shows it on lg+ */}
          <div className="mb-8 flex justify-center lg:hidden">
            <Link
              href="/"
              className="inline-flex"
              aria-label={`${BRAND.name} home`}
            >
              <Logo size="md" variant="stacked" />
            </Link>
          </div>

          <div className="mb-7 lg:mb-8">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.7rem]">
              {title}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
          </div>

          {children}

          {footer ? (
            <p className="mt-8 text-center text-sm text-muted-foreground">
              {footer}
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
