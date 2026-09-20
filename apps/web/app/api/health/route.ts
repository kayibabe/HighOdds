import { db } from "@highodds/db";

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", service: "highodds-web", database: "ok" });
  } catch {
    return Response.json({ status: "degraded", service: "highodds-web", database: "unavailable" }, { status: 503 });
  }
}
