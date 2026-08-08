"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2 } from "lucide-react";

export function DeleteAccountButton() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    setLoading(true);
    setError(null);

    const res = await fetch("/api/account/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Something went wrong");
      setLoading(false);
      return;
    }

    await signOut({ callbackUrl: "/" });
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:bg-destructive/10" onClick={() => setOpen(true)}>
        <Trash2 className="h-3.5 w-3.5" /> Delete account
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
      <div>
        <p className="text-sm font-medium text-destructive">This permanently deletes your account</p>
        <p className="mt-1 text-xs text-muted-foreground">
          All projects, generated videos, voice samples, and connected accounts are permanently deleted, and any
          active subscription is canceled immediately. This can't be undone.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm-password" className="text-xs">Enter your password to confirm</Label>
        <Input
          id="confirm-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button
          variant="destructive"
          size="sm"
          disabled={loading || !password}
          onClick={confirmDelete}
        >
          {loading ? "Deleting…" : "Permanently delete"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => { setOpen(false); setError(null); setPassword(""); }}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
