import type { Metadata } from "next";
import { auth } from "../auth";
import { signOutAction } from "./actions";
import ThemeToggle from "./theme-toggle";
import "./styles.css";

export const metadata: Metadata = { title: "HighOdds | Paper football analysis", description: "Evidence-led football paper tickets." };

// Runs before first paint so a saved theme doesn't flash the system theme on load.
const THEME_INIT = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: THEME_INIT }} /></head><body><header><a href="/">HighOdds</a><nav>{session?.user?.email && <a href="/dashboard">Dashboard</a>}<a href="/results">Results</a>{session?.user?.role === "ADMIN" && <a href="/admin">Admin</a>}{session?.user?.email ? <form action={signOutAction}><button type="submit" className="link-button">Sign out</button></form> : <a href="/signin">Sign in</a>}<ThemeToggle /></nav></header><main>{children}</main><footer>18+ · Paper analysis only · No guaranteed outcomes</footer></body></html>;
}
