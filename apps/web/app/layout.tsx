import type { Metadata } from "next";
import { auth } from "../auth";
import { signOutAction } from "./actions";
import "./styles.css";

export const metadata: Metadata = { title: "HighOdds | Paper football analysis", description: "Evidence-led football paper tickets." };
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();
  return <html lang="en"><body><header><a href="/">HighOdds</a><nav>{session?.user?.email && <a href="/dashboard">Dashboard</a>}<a href="/results">Results</a>{session?.user?.email ? <form action={signOutAction}><button type="submit" className="link-button">Sign out</button></form> : <a href="/signin">Sign in</a>}</nav></header><main>{children}</main><footer>18+ · Paper analysis only · No guaranteed outcomes</footer></body></html>;
}
