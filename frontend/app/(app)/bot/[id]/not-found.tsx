import Link from "next/link";
import { Bot as BotIcon } from "lucide-react";

import { gradientBtn } from "@/lib/landing";

export default function BotNotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center px-6 py-20 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <BotIcon className="h-8 w-8" aria-hidden="true" />
      </div>
      <h2 className="mt-5 text-2xl font-semibold tracking-tight">
        Bot not found
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        This bot may have been deleted or you don&apos;t have access.
      </p>
      <Link href="/dashboard" className={`${gradientBtn("md")} mt-6`}>
        Back to dashboard
      </Link>
    </div>
  );
}
