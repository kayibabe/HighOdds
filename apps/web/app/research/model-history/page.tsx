import ResearchWorkspace, { type ResearchSearchParams } from "../workspace";
export const dynamic = "force-dynamic";
export default function ModelHistoryPage({ searchParams }: { searchParams: Promise<ResearchSearchParams> }) {
  return <ResearchWorkspace searchParams={searchParams} view="history" />;
}
