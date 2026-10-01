import type { Metadata } from "next";
import { auth } from "../auth";
import AppShell from "./app-shell";
import "./styles.css";

export const metadata: Metadata = { title: "HighOdds | Paper football analysis", description: "Evidence-led football paper tickets." };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();
  return <html lang="en" suppressHydrationWarning><body><AppShell email={session?.user?.email ?? null} isAdmin={session?.user?.role === "ADMIN"}>{children}</AppShell></body></html>;
}
