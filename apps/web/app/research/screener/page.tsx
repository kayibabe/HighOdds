import ResearchWorkspace, { type ResearchSearchParams } from "../workspace";
export const dynamic = "force-dynamic";
export default function HistoricalScreenerPage({ searchParams }: { searchParams: Promise<ResearchSearchParams> }) {
  return <ResearchWorkspace searchParams={searchParams} view="screener" />;
}
