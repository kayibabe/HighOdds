import { db } from "@highodds/db";

const BASE_URL = "https://v3.football.api-sports.io";

/** A provider response item paired with the persisted response page that supplied it. */
export interface CapturedProviderRecord {
  record: unknown;
  rawPayloadId: string;
}

/** Test doubles may expose only getPaged; production always uses the provenance-preserving path. */
export type OddsProviderClient = Pick<ApiFootballClient, "getPaged"> & Partial<Pick<ApiFootballClient, "getPagedCaptured">>;

export async function getOddsWithProvenance(client: OddsProviderClient, query: Record<string, string | number | undefined>): Promise<unknown[]> {
  return client.getPagedCaptured ? client.getPagedCaptured("/odds", query) : client.getPaged("/odds", query);
}

function utcDateOnly(date: Date): Date { return new Date(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`); }

export class ApiFootballClient {
  constructor(private readonly apiKey = process.env.API_FOOTBALL_KEY, private readonly quota = Number(process.env.API_FOOTBALL_DAILY_QUOTA ?? 7500)) {}

  // Counts HighOdds' own requests for the admin/analysis pages only; it never blocks a request. The
  // key is shared with other systems, so the provider's own daily limit is the only real ceiling.
  private async recordUsage(): Promise<void> {
    const usageDate = utcDateOnly(new Date());
    await db.apiQuotaUsage.upsert({
      where: { usageDate },
      create: { usageDate, quotaLimit: this.quota, requestCount: 1 },
      update: { requestCount: { increment: 1 } }
    });
  }

  async getPagedCaptured(endpoint: string, query: Record<string, string | number | undefined>): Promise<CapturedProviderRecord[]> {
    if (!this.apiKey) throw new Error("API_FOOTBALL_KEY is not configured");
    const response: CapturedProviderRecord[] = [];
    for (let page = 1; ; page += 1) {
      await this.recordUsage();
      const params = new URLSearchParams(page > 1 ? { page: String(page) } : {});
      Object.entries(query).forEach(([key, value]) => { if (value !== undefined) params.set(key, String(value)); });
      const url = `${BASE_URL}${endpoint}?${params}`;
      const request = await fetch(url, { headers: { "x-apisports-key": this.apiKey, accept: "application/json" }, signal: AbortSignal.timeout(45_000) });
      if (!request.ok) throw new Error(`API-Football ${endpoint} page ${page} returned ${request.status}`);
      const body = await request.json() as { response?: unknown[]; paging?: { current?: number; total?: number }; errors?: unknown };
      if (body.errors && Object.keys(body.errors as object).length > 0) throw new Error(`API-Football error: ${JSON.stringify(body.errors)}`);
      const requestKey = `${endpoint}:${params.toString().replace(/&page=\d+/, "")}`;
      const payload = await db.rawProviderPayload.create({ data: { endpoint, requestKey, page, body: body as object } });
      response.push(...(body.response ?? []).map((record) => ({ record, rawPayloadId: payload.id })));
      const total = body.paging?.total ?? page;
      if (page >= total) break;
    }
    return response;
  }

  /** Compatibility view for fixture/result callers that do not persist per-record provenance. */
  async getPaged(endpoint: string, query: Record<string, string | number | undefined>): Promise<unknown[]> {
    return (await this.getPagedCaptured(endpoint, query)).map(({ record }) => record);
  }
}
