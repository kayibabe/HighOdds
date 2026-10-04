import { redirect } from "next/navigation";
import ResearchWorkspace, { type ResearchSearchParams } from "./workspace";
export const dynamic = "force-dynamic";

export default async function FixtureInspectorPage({ searchParams }: { searchParams: Promise<ResearchSearchParams> }) {
  const params = await searchParams;
  if (params.screen === "1") {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(params)) {
      if (name === "screen") continue;
      for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(name, item);
    }
    redirect(`/research/screener${query.size ? `?${query}` : ""}`);
  }
  return <ResearchWorkspace searchParams={Promise.resolve(params)} view="fixture" />;
}
