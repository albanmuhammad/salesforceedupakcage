// src/lib/salesforce/client.ts
import "@/lib/initserver";
import { Connection } from "jsforce";

let connPromise: Promise<Connection> | null = null;

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

/**
 * Login ke Salesforce menggunakan Username + Password + Security Token
 * dan kembalikan jsforce Connection. Dip-cache di level modul agar tidak
 * login berulang di satu proses server.
 *
 * NOTE:
 * - Gunakan SF_LOGIN_URL: https://login.salesforce.com (prod) atau https://test.salesforce.com (sandbox)
 * - SF_PASSWORD + SF_SECURITY_TOKEN harus digabung (PASSWORD + TOKEN)
 */
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
  console.log(connPromise);
  return connPromise;
}

/**
 * Jalankan SOQL dan kembalikan records (array).
 */
export async function sfQuery<T = any>(soql: string): Promise<T[]> {
  const conn = await getConn();
  const res = await conn.query<T>(soql);
  // jsforce: res.totalSize, res.done, res.records
  return (res.records ?? []) as T[];
}

/**
 * GET request ke REST API Salesforce dengan path relatif, misal:
 *   path: `/services/data/v59.0/sobjects/Account/001...`
 */
export async function sfGet<T = any>(path: string): Promise<T> {
  const conn = await getConn();
  // jsforce akan handle base URL + Authorization header
  const json = await conn.request<T>(path);
  return json;
}
