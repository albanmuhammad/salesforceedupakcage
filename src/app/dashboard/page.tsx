// app/dashboard/page.tsx
import { cookies } from "next/headers";
import LogoutButton from "@/app/logout/logout";
import DashboardClient, { OpportunityItem, ProgressResponse } from "./DashboardClient";

type LookupName = { Name?: string } | null;

export default async function Dashboard() {
  const cookieHeader = (await cookies())
    .getAll()
    .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
    .join("; ");

  const base = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const res = await fetch(`${base}/api/salesforce/progress`, {
    cache: "no-store",
    headers: { cookie: cookieHeader },
  });
  const data: ProgressResponse = await res.json();
  const items: OpportunityItem[] = data?.items ?? [];
  const applicantName = data?.applicantName ?? "Applicant";

  return (
    <DashboardClient applicantName={applicantName} items={items} />
  );
}
