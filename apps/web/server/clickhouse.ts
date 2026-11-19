import "server-only";
import { createClient, type ClickHouseClient } from "@clickhouse/client";

const g = globalThis as unknown as { __ch?: ClickHouseClient };

export function ch(): ClickHouseClient {
  if (!g.__ch) {
    const url = new URL(process.env.CLICKHOUSE_URL ?? "http://localhost:8123/default");
    g.__ch = createClient({
      url: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username) || "default",
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, "") || "default",
      request_timeout: 10_000,
    });
  }
  return g.__ch;
}

export async function chQuery<T>(query: string, params: Record<string, unknown> = {}): Promise<T[]> {
  const rs = await ch().query({ query, query_params: params, format: "JSONEachRow" });
  return rs.json<T>();
}
