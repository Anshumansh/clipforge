"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles } from "lucide-react";
import { safeInternalPath } from "@/lib/safe-redirect";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeInternalPath(searchParams.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [needsMfa, setNeedsMfa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    let res: Awaited<ReturnType<typeof signIn>>;
    try {
      res = await signIn("credentials", { email, password, totpCode, redirect: false });
    } catch {
      setLoading(false);
      setError("Could not reach the server. Check your connection and try again.");
      return;
    }
    setLoading(false);

    if (res?.error === "MFA_REQUIRED") {
      setNeedsMfa(true);
      return;
    }
    if (res?.error === "MFA_INVALID") {
      setError("That code didn't match. Check your authenticator app or use a backup code.");
      return;
    }
    if (res?.error) {
      setError("Invalid email or password");
      return;
    }
    router.replace(next);
    router.refresh();
  }

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
          <CardTitle>Welcome back</CardTitle>
          <CardDescription>Log in to keep generating videos.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                disabled={needsMfa}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link href="/forgot-password" className="text-xs text-primary underline underline-offset-2 hover:no-underline">
                  Forgot password?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                disabled={needsMfa}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {needsMfa && (
              <div className="space-y-1.5">
                <Label htmlFor="totpCode">Authenticator code</Label>
                <Input
                  id="totpCode"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  placeholder="123456 or a backup code"
                  required
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  This account has two-factor authentication enabled. Enter the 6-digit code from your
                  authenticator app, or one of your backup codes.
                </p>
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Logging in…" : needsMfa ? "Verify" : "Log in"}
            </Button>
            {needsMfa && (
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setNeedsMfa(false);
                  setTotpCode("");
                  setError(null);
                }}
              >
                Use a different account
              </Button>
            )}
          </form>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            No account?{" "}
            <Link href={`/register${next !== "/dashboard" ? `?next=${encodeURIComponent(next)}` : ""}`} className="text-primary underline underline-offset-2 hover:no-underline">
              Sign up free
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
