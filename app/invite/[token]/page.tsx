"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Sparkles, Users } from "lucide-react";

interface InviteInfo {
  email: string;
  workspaceName: string;
  ownerName: string;
}

export default function InvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    fetch(`/api/workspace/invites/${params.token}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Invite not found");
        setInvite(data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Invite not found"))
      .finally(() => setLoading(false));
  }, [params.token]);

  async function accept() {
    setAccepting(true);
    setError(null);
    const res = await fetch(`/api/workspace/invites/${params.token}`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setAccepting(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong");
      return;
    }
    router.push("/dashboard/settings/team");
    router.refresh();
  }

  const nextParam = `/invite/${params.token}`;
  const loggedIn = sessionStatus === "authenticated";
  const sessionEmail = (session?.user as { email?: string } | undefined)?.email;
  const emailMismatch = loggedIn && invite && sessionEmail && sessionEmail.toLowerCase() !== invite.email.toLowerCase();

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <Link href="/" className="mb-2 flex items-center gap-2 font-display font-semibold">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-[hsl(262_83%_66%)] to-[hsl(316_80%_62%)]">
              <Sparkles className="h-4 w-4 text-white" />
            </span>
            Clipforge
          </Link>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15">
            <Users className="h-5 w-5 text-primary" />
          </div>
          <CardTitle>Team invite</CardTitle>
        </CardHeader>
        <CardContent className="text-center">
          {loading && <p className="text-sm text-muted-foreground">Loading invite…</p>}

          {!loading && error && !invite && (
            <>
              <p className="text-sm text-destructive">{error}</p>
              <Button asChild className="mt-4 w-full" variant="outline">
                <Link href="/dashboard">Go to dashboard</Link>
              </Button>
            </>
          )}

          {!loading && invite && (
            <>
              <CardDescription className="mb-6">
                <strong>{invite.ownerName}</strong> invited you to join <strong>{invite.workspaceName}</strong> on
                Clipforge. Accepting shares their project pipeline and credit balance.
              </CardDescription>

              {sessionStatus === "loading" && <p className="text-sm text-muted-foreground">Checking your session…</p>}

              {sessionStatus === "unauthenticated" && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Log in or create an account with {invite.email} to accept.</p>
                  <Button asChild className="w-full">
                    <Link href={`/login?next=${encodeURIComponent(nextParam)}`}>Log in</Link>
                  </Button>
                  <Button asChild className="w-full" variant="outline">
                    <Link href={`/register?next=${encodeURIComponent(nextParam)}&email=${encodeURIComponent(invite.email)}`}>
                      Create account
                    </Link>
                  </Button>
                </div>
              )}

              {emailMismatch && (
                <p className="text-sm text-destructive">
                  This invite is for {invite.email}, but you're logged in as {sessionEmail}. Log out and use that email to
                  accept it.
                </p>
              )}

              {loggedIn && !emailMismatch && (
                <>
                  {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
                  <Button className="w-full" onClick={accept} disabled={accepting}>
                    {accepting ? "Joining…" : `Accept invite`}
                  </Button>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
