import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create new bot",
};

export default function NewBotLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
