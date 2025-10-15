// src/app/login/page.tsx
import { Suspense } from "react";
import LoginClient from "./LoginClient";

// (opsional) jika ingin benar2 paksa dinamis
// export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <Suspense fallback={<div />}>
      <LoginClient />
    </Suspense>
  );
}
