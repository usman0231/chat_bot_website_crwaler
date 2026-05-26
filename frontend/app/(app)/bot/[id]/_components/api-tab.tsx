"use client";

import * as React from "react";
import { Check, Copy, ExternalLink, Lock, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type CodeBlockProps = {
  code: string;
  language?: string;
};

function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = React.useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Copied!");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        className="absolute right-2 top-2 z-10 bg-background/80 backdrop-blur"
        onClick={onCopy}
        aria-label="Copy code"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        ) : (
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </Button>
      <pre
        className={cn(
          "max-h-[480px] overflow-auto rounded-lg border border-border bg-muted/40 p-4 pr-12 font-mono text-xs leading-relaxed text-foreground",
        )}
        data-language={language}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

type ApiTabProps = {
  botId: string;
  websiteName: string;
};

export function ApiTab({ botId, websiteName }: ApiTabProps) {
  const baseUrl = api.baseUrl;
  const publicApiKey = process.env.NEXT_PUBLIC_API_KEY ?? "";

  const widgetSnippet = `<script
  src="${baseUrl}/widget.js"
  data-bot-id="${botId}"
  data-api-key="${publicApiKey || "YOUR_API_KEY"}"
  async></script>`;

  const curlSnippet = `curl -X POST ${baseUrl}/bot/${botId}/chat \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"message": "What services do you offer?"}'`;

  const jsSnippet = `async function askBot(message) {
  const res = await fetch(
    "${baseUrl}/bot/${botId}/chat",
    {
      method: "POST",
      headers: {
        "X-API-Key": "YOUR_API_KEY",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message }),
    }
  );
  const data = await res.json();
  console.log(data.answer);
  console.log(data.sources);
}`;

  const pySnippet = `import requests

response = requests.post(
    "${baseUrl}/bot/${botId}/chat",
    headers={"X-API-Key": "YOUR_API_KEY"},
    json={"message": "What services do you offer?"},
)
data = response.json()
print(data["answer"])
print(data["sources"])`;

  const responseSnippet = `{
  "answer": "${websiteName || "Visionara"} offers web development, mobile app development...",
  "sources": ["https://www.example.com/about"],
  "in_scope": true,
  "match_quality": "strong"
}`;

  const demoHref = `/widget-demo?bot_id=${encodeURIComponent(botId)}`;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">
          Integrate with your app
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Use these snippets to add{" "}
          <span className="text-foreground">{websiteName || "this site"}</span>
          &apos;s chatbot anywhere.
        </p>
      </div>

      <section
        aria-labelledby="quick-install-heading"
        className="rounded-xl border border-purple-500/20 bg-gradient-to-br from-indigo-500/5 via-purple-500/5 to-pink-500/5 p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3
              id="quick-install-heading"
              className="flex items-center gap-2 text-base font-semibold tracking-tight"
            >
              <Sparkles
                className="h-4 w-4 text-purple-500"
                aria-hidden="true"
              />
              Add to your website
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Drop this snippet into your website&apos;s HTML, anywhere before
              {" "}<code className="rounded bg-muted px-1 text-[11px]">&lt;/body&gt;</code>.
              You&apos;ll get a chat bubble in the bottom-right corner.
            </p>
          </div>
          <a
            href={demoHref}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border border-border bg-background px-3 py-1 text-xs font-medium transition-colors hover:border-purple-500/40"
          >
            Try it
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        </div>
        <div className="mt-3">
          <CodeBlock code={widgetSnippet} language="html" />
        </div>
      </section>

      <div className="flex items-start gap-3 rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3">
        <Lock
          className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400"
          aria-hidden="true"
        />
        <p className="text-sm text-muted-foreground">
          Your API key is in your account settings. The examples below use a
          placeholder.
        </p>
      </div>

      <Tabs defaultValue="curl">
        <TabsList>
          <TabsTrigger value="curl">cURL</TabsTrigger>
          <TabsTrigger value="js">JavaScript</TabsTrigger>
          <TabsTrigger value="py">Python</TabsTrigger>
        </TabsList>
        <TabsContent value="curl" className="mt-3">
          <CodeBlock code={curlSnippet} language="bash" />
        </TabsContent>
        <TabsContent value="js" className="mt-3">
          <CodeBlock code={jsSnippet} language="javascript" />
        </TabsContent>
        <TabsContent value="py" className="mt-3">
          <CodeBlock code={pySnippet} language="python" />
        </TabsContent>
      </Tabs>

      <div>
        <h3 className="mb-2 text-sm font-semibold tracking-tight">Response</h3>
        <CodeBlock code={responseSnippet} language="json" />
      </div>
    </div>
  );
}
