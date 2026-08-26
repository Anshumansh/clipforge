import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { safeInternalPath } from "@/lib/safe-redirect";
import { RegisterForm } from "@/components/register-form";

// Same fix as app/login/page.tsx: an already-logged-in visitor has no
// reason to see a signup form, and staying on it invites creating a second,
// unrelated account by mistake.
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (session) redirect(safeInternalPath((await searchParams).next));

  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
