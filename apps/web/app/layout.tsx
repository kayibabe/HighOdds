import type { Metadata } from "next";
import { auth } from "../auth";
import AppShell from "./app-shell";
import "./styles.css";

export const metadata: Metadata = { title: "HighOdds | Paper football analysis", description: "Evidence-led football paper tickets." };

// Runs before first paint so a saved theme doesn't flash the system theme on load.
const THEME_INIT = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: THEME_INIT }} /></head><body><AppShell email={session?.user?.email ?? null} isAdmin={session?.user?.role === "ADMIN"}>{children}</AppShell></body></html>;
}
