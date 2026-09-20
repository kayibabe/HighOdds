import { db } from "@highodds/db";

const BASE_URL = "https://v3.football.api-sports.io";

export class QuotaSafetyError extends Error {}

function utcDateOnly(date: Date): Date { return new Date(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`); }

export class ApiFootballClient {
  constructor(private readonly apiKey = process.env.API_FOOTBALL_KEY, private readonly quota = Number(process.env.API_FOOTBALL_DAILY_QUOTA ?? 7500), private readonly safetyPercent = Number(process.env.API_FOOTBALL_QUOTA_SAFETY_PERCENT ?? 90)) {}

  private async consumeQuota(): Promise<void> {
    const usageDate = utcDateOnly(new Date());
    const limit = Math.floor(this.quota * this.safetyPercent / 100);
    const result = await db.apiQuotaUsage.upsert({
      where: { usageDate },
      create: { usageDate, quotaLimit: this.quota, safetyPercent: this.safetyPercent, requestCount: 1 },
      update: { requestCount: { increment: 1 } }
    });
    if (result.requestCount > limit) {
      await db.apiQuotaUsage.update({ where: { usageDate }, data: { degradedAt: new Date() } });
      throw new QuotaSafetyError(`API-Football quota safety margin (${limit}) reached`);
    }
  }

  async getPaged(endpoint: string, query: Record<string, string | number | undefined>): Promise<unknown[]> {
    if (!this.apiKey) throw new Error("API_FOOTBALL_KEY is not configured");
    const response: unknown[] = [];
    for (let page = 1; ; page += 1) {
      await this.consumeQuota();
      const params = new URLSearchParams({ page: String(page) });
      Object.entries(query).forEach(([key, value]) => { if (value !== undefined) params.set(key, String(value)); });
      const url = `${BASE_URL}${endpoint}?${params}`;
      const request = await fetch(url, { headers: { "x-apisports-key": this.apiKey, accept: "application/json" }, signal: AbortSignal.timeout(45_000) });
      if (!request.ok) throw new Error(`API-Football ${endpoint} page ${page} returned ${request.status}`);
      const body = await request.json() as { response?: unknown[]; paging?: { current?: number; total?: number }; errors?: unknown };
      if (body.errors && Object.keys(body.errors as object).length > 0) throw new Error(`API-Football error: ${JSON.stringify(body.errors)}`);
      const requestKey = `${endpoint}:${params.toString().replace(/&page=\d+/, "")}`;
      await db.rawProviderPayload.create({ data: { endpoint, requestKey, page, body: body as object } });
      response.push(...(body.response ?? []));
      const total = body.paging?.total ?? page;
      if (page >= total) break;
    }
    return response;
  }
}
