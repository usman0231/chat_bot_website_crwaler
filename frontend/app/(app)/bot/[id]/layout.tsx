import type { Metadata } from "next";

type Props = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const base =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:8000";
  const key = process.env.NEXT_PUBLIC_API_KEY ?? "";

  try {
    const res = await fetch(`${base}/bot/${id}/status`, {
      headers: key ? { "X-API-Key": key } : undefined,
      cache: "no-store",
    });
    if (res.ok) {
      const data = (await res.json()) as { website_name?: string };
      const name = data.website_name?.trim();
      if (name) return { title: name };
    }
  } catch {
    /* fall through to default */
  }

  return { title: id };
}

export default function BotLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
