"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Globe, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { AuthShell } from "@/components/auth/auth-shell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { AuthError, useAuth } from "@/lib/auth-store";
import { BRAND } from "@/lib/brand";
import { gradientBtn } from "@/lib/landing";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Errors = {
  name?: string;
  email?: string;
  password?: string;
  confirm?: string;
  form?: string;
};

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefilledUrl = searchParams.get("url");
  const { signup } = useAuth();

  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [errors, setErrors] = React.useState<Errors>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [welcoming, setWelcoming] = React.useState(false);

  function validate(): Errors {
    const next: Errors = {};
    if (!name.trim()) next.name = "Name is required";
    if (!email.trim()) next.email = "Email is required";
    else if (!EMAIL_RE.test(email.trim())) next.email = "Enter a valid email";
    if (!password) next.password = "Password is required";
    else if (password.length < 8)
      next.password = "Password must be at least 8 characters";
    if (confirm !== password) next.confirm = "Passwords don't match";
    return next;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    try {
      await signup(name.trim(), email.trim(), password);
      toast.success("Account created!");
      setWelcoming(true);
      const target = prefilledUrl
        ? `/dashboard/new?url=${encodeURIComponent(prefilledUrl)}`
        : "/dashboard";
      window.setTimeout(() => router.push(target), 1500);
    } catch (err) {
      if (err instanceof AuthError) {
        if (err.status === 409) {
          setErrors({ email: "Email already registered" });
        } else if (err.status === 422) {
          setErrors({ form: err.message || "Please double-check the form" });
        } else if (err.status === 0) {
          setErrors({ form: "Cannot reach the server. Is the API running?" });
        } else {
          setErrors({ form: err.message || "Something went wrong" });
        }
      } else {
        setErrors({ form: "Something went wrong" });
      }
      setWelcoming(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {welcoming && (
        <div
          className="welcome-overlay fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/95 px-6 text-center backdrop-blur-sm"
          role="status"
          aria-live="polite"
        >
          <div className="relative mb-5">
            <div
              aria-hidden="true"
              className="absolute inset-0 -z-10 rounded-full bg-gradient-to-br from-indigo-500/40 via-purple-500/40 to-pink-500/40 blur-2xl"
            />
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white shadow-lg">
              <Sparkles className="h-8 w-8" aria-hidden="true" />
            </div>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Welcome to {BRAND.name}!
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Setting up your account…
          </p>
        </div>
      )}
      {prefilledUrl && (
        <div className="mb-5 flex items-center gap-2 rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-700 dark:text-indigo-300">
          <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">
            We&apos;ll help you create a bot for{" "}
            <span className="font-medium">{prefilledUrl}</span> after signup
          </span>
        </div>
      )}

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {errors.form && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {errors.form}
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            type="text"
            autoComplete="name"
            placeholder="Ada Lovelace"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={!!errors.name}
            className="h-10"
          />
          {errors.name && (
            <p className="text-xs text-destructive">{errors.name}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!errors.email}
            className="h-10"
          />
          {errors.email && (
            <p className="text-xs text-destructive">{errors.email}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!errors.password}
            className="h-10"
          />
          {errors.password && (
            <p className="text-xs text-destructive">{errors.password}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirm">Confirm password</Label>
          <PasswordInput
            id="confirm"
            autoComplete="new-password"
            placeholder="Repeat your password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={!!errors.confirm}
            className="h-10"
          />
          {errors.confirm && (
            <p className="text-xs text-destructive">{errors.confirm}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting}
          className={gradientBtn("md", "w-full")}
        >
          {submitting ? "Creating…" : "Create account"}
        </button>
      </form>
    </>
  );
}

export default function SignupPage() {
  return (
    <AuthShell
      title="Create your account"
      subtitle="Start training bots in seconds"
      footer={
        <>
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-foreground hover:underline"
          >
            Log in
          </Link>
        </>
      }
    >
      <React.Suspense fallback={null}>
        <SignupForm />
      </React.Suspense>
    </AuthShell>
  );
}
