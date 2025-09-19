// src/lib/salesforce/client.ts
import "@/lib/initserver";
import { Connection } from "jsforce";

type SObjectRecord = Record<string, unknown> & {
  attributes?: { type: string; url: string };
};

let connPromise: Promise<Connection> | null = null;

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export async function getConn(): Promise<Connection> {
  if (!connPromise) {
    connPromise = (async () => {
      const loginUrl = mustEnv("SF_LOGIN_URL").replace(/\/+$/, "");
      const username = mustEnv("SF_USERNAME");
      const password = mustEnv("SF_PASSWORD");
      const token = process.env.SF_SECURITY_TOKEN ?? "";

      const conn = new Connection({ loginUrl });
      await conn.login(username, password + token);
      return conn;
    })();
  }
  return connPromise;
}

/** Jalankan SOQL dan kembalikan records (array). */
export async function sfQuery<T extends SObjectRecord = SObjectRecord>(
  soql: string
): Promise<T[]> {
  const conn = await getConn();
  const res = await conn.query<T>(soql);
  return (res.records ?? []) as T[];
}

/** GET request ke REST API Salesforce dengan path relatif. */
export async function sfGet<T = unknown>(path: string): Promise<T> {
  const conn = await getConn();
  const json = await conn.request<T>(path);
  return json;
}
