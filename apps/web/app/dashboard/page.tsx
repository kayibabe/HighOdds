import { redirect } from "next/navigation";

export default async function TodayPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(name, item);
  }
  const route = params.minProbability !== undefined || params.pick !== undefined
    ? "/dashboard/high-probability" : "/dashboard/research";
  redirect(`${route}${query.size ? `?${query}` : ""}`);
}
