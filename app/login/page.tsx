import { Suspense } from "react";
import LoginPage from "./LoginPageClient";

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-aeris-bg text-aeris-muted">
          Loading...
        </div>
      }
    >
      <LoginPage />
    </Suspense>
  );
}
