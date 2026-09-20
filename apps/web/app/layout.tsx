import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = { title: "HighOdds | Paper football analysis", description: "Evidence-led football paper tickets." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><header><a href="/">HighOdds</a><nav><a href="/results">Results</a><a href="/signin">Sign in</a></nav></header><main>{children}</main><footer>18+ · Paper analysis only · No guaranteed outcomes</footer></body></html>;
}
