"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, ShieldOff, Copy } from "lucide-react";

type Step = "idle" | "setup" | "backup-codes";

export function AdminMfaCard({ initiallyEnabled }: { initiallyEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [step, setStep] = useState<Step>("idle");
  const [secret, setSecret] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [disableCode, setDisableCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function startSetup() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/mfa/setup", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Couldn't start setup");
      return;
    }
    setSecret(data.secret);
    setQrDataUrl(data.qrDataUrl);
    setStep("setup");
  }

  async function confirmEnable() {
    if (code.trim().length !== 6) {
      setError("Enter the 6-digit code from your authenticator app");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/mfa/enable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, code: code.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong");
      return;
    }
    setBackupCodes(data.backupCodes);
    setStep("backup-codes");
    setEnabled(true);
  }

  async function disable() {
    if (!disableCode.trim()) {
      setError("Enter a current code or backup code to disable MFA");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/mfa/disable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: disableCode.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong");
      return;
    }
    setEnabled(false);
    setDisableCode("");
    setStep("idle");
  }

  function finishSetup() {
    setStep("idle");
    setSecret("");
    setQrDataUrl("");
    setCode("");
    setBackupCodes([]);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Two-factor authentication</CardTitle>
          {enabled ? (
            <Badge variant="success" className="gap-1">
              <ShieldCheck className="h-3 w-3" /> Enabled
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive">
              <ShieldOff className="h-3 w-3" /> Not enabled
            </Badge>
          )}
        </div>
        <CardDescription>
          This account can grant unlimited credits and comp any plan — protect it with an authenticator app, not
          just a password.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === "idle" && !enabled && (
          <Button size="sm" onClick={startSetup} disabled={busy}>
            {busy ? "Starting…" : "Set up two-factor authentication"}
          </Button>
        )}

        {step === "idle" && enabled && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Enter a current authenticator code (or a backup code) to disable two-factor authentication.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value)}
                placeholder="123456"
                className="w-40 rounded-md border border-border bg-background/60 px-3 py-2 text-sm"
              />
              <Button size="sm" variant="destructive" onClick={disable} disabled={busy}>
                {busy ? "Disabling…" : "Disable"}
              </Button>
            </div>
          </div>
        )}

        {step === "setup" && (
          <div className="space-y-3">
            <p className="text-sm">
              Scan this with an authenticator app (Google Authenticator, 1Password, Authy), or enter the key
              manually.
            </p>
            {qrDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrDataUrl} alt="TOTP QR code" className="h-40 w-40 rounded-lg border border-border bg-white p-2" />
            )}
            <p className="break-all rounded-md bg-secondary/40 px-3 py-2 font-mono text-xs">{secret}</p>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="6-digit code"
                className="w-40 rounded-md border border-border bg-background/60 px-3 py-2 text-sm"
              />
              <Button size="sm" onClick={confirmEnable} disabled={busy}>
                {busy ? "Verifying…" : "Confirm & enable"}
              </Button>
              <Button size="sm" variant="outline" onClick={finishSetup}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {step === "backup-codes" && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-emerald-500">Two-factor authentication is enabled.</p>
            <p className="text-sm text-muted-foreground">
              Save these backup codes somewhere safe — each works once if you lose access to your authenticator
              app. They won't be shown again.
            </p>
            <div className="grid grid-cols-2 gap-2 rounded-md bg-secondary/40 p-3 font-mono text-sm">
              {backupCodes.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => navigator.clipboard.writeText(backupCodes.join("\n"))}
            >
              <Copy className="h-3.5 w-3.5" /> Copy codes
            </Button>
            <Button size="sm" onClick={finishSetup} className="ml-2">
              Done
            </Button>
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
