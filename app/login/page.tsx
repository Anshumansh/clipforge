import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { safeInternalPath } from "@/lib/safe-redirect";
import { LoginForm } from "@/components/login-form";

// Real bug this fixes: an already-logged-in visitor landing on /login (e.g.
// the public homepage's header links here unconditionally -- see
// site-header.tsx -- since it has no way to know the visitor already has a
// session) saw a blank login form and, reasonably, assumed they'd been
// signed out and typed their credentials in again. The session was never
// actually touched; the page just never checked for one. Redirecting here
// closes that regardless of which link sent them.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (session) redirect(safeInternalPath((await searchParams).next));

  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
