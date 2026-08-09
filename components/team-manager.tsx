"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Trash2, UserPlus, LogOut, Mail } from "lucide-react";

interface Member {
  id: string;
  email: string;
  name: string | null;
  joinedAt: string;
}

interface PendingInvite {
  id: string;
  email: string;
  createdAt: string;
  expiresAt: string;
}

interface WorkspaceState {
  role: "owner" | "member" | null;
  workspace: { id: string; name: string; ownerEmail?: string; ownerName?: string } | null;
  members: Member[];
  pendingInvites: PendingInvite[];
  canCreate: boolean;
}

export function TeamManager() {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/workspace");
    if (res.ok) setState(await res.json());
  }

  useEffect(() => {
    void load();
  }, []);

  async function createWorkspace(name: string) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong");
      return;
    }
    await load();
  }

  async function inviteMember(email: string) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/workspace/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong");
      return;
    }
    await load();
  }

  async function removeMember(id: string) {
    setBusy(true);
    await fetch(`/api/workspace/members/${id}`, { method: "DELETE" });
    setBusy(false);
    await load();
  }

  async function cancelInvite(id: string) {
    setBusy(true);
    await fetch(`/api/workspace/invite/${id}`, { method: "DELETE" });
    setBusy(false);
    await load();
  }

  async function leaveWorkspace() {
    setBusy(true);
    await fetch("/api/workspace/leave", { method: "POST" });
    setBusy(false);
    await load();
  }

  async function deleteWorkspace() {
    setBusy(true);
    await fetch("/api/workspace", { method: "DELETE" });
    setBusy(false);
    await load();
  }

  if (!state) return <p className="text-sm text-muted-foreground">Loading…</p>;

  if (state.role === null) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Create a workspace</CardTitle>
            {!state.canCreate && (
              <Badge variant="outline" className="gap-1 border-primary/30 bg-primary/5">
                <Sparkles className="h-3 w-3 text-primary" /> Business plan
              </Badge>
            )}
          </div>
          <CardDescription>
            {state.canCreate
              ? "Invite teammates who'll share your project pipeline and credit balance -- no separate subscription for them."
              : "Team workspaces are a Business-plan feature."}
          </CardDescription>
        </CardHeader>
        {state.canCreate && (
          <CardContent>
            <CreateWorkspaceForm onSubmit={createWorkspace} busy={busy} error={error} />
          </CardContent>
        )}
      </Card>
    );
  }

  if (state.role === "member" && state.workspace) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{state.workspace.name}</CardTitle>
          <CardDescription>
            You're a member, owned by {state.workspace.ownerName ?? state.workspace.ownerEmail}. Your renders draw from
            their credit balance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" className="gap-1.5 text-destructive hover:text-destructive" onClick={leaveWorkspace} disabled={busy}>
            <LogOut className="h-3.5 w-3.5" /> Leave workspace
          </Button>
        </CardContent>
      </Card>
    );
  }

  // owner
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{state.workspace?.name}</CardTitle>
          <CardDescription>Members share your project pipeline and spend from your credit balance.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {state.members.length === 0 && <p className="text-sm text-muted-foreground">No members yet -- invite someone below.</p>}
          {state.members.map((m) => (
            <div key={m.id} className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
              <div>
                <p className="text-sm font-medium">{m.name ?? m.email}</p>
                <p className="text-xs text-muted-foreground">{m.email}</p>
              </div>
              <Button variant="ghost" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => removeMember(m.id)} disabled={busy}>
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </Button>
            </div>
          ))}

          {state.pendingInvites.length > 0 && (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-xs font-medium text-muted-foreground">Pending invites</p>
              {state.pendingInvites.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between rounded-lg border border-dashed border-border px-4 py-2.5">
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground" /> {inv.email}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => cancelInvite(inv.id)} disabled={busy}>
                    Cancel
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-border pt-4">
            <InviteForm onSubmit={inviteMember} busy={busy} error={error} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Disband workspace</CardTitle>
          <CardDescription>Removes all members. Everyone keeps their already-generated videos.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" className="text-destructive hover:text-destructive" onClick={deleteWorkspace} disabled={busy}>
            Delete workspace
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function CreateWorkspaceForm({ onSubmit, busy, error }: { onSubmit: (name: string) => void; busy: boolean; error: string | null }) {
  const [name, setName] = useState("");
  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <label htmlFor="workspace-name" className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Workspace name
        </label>
        <input
          id="workspace-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Acme Agency"
          maxLength={60}
          className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm"
        />
      </div>
      <Button onClick={() => onSubmit(name)} disabled={busy || !name.trim()}>
        {busy ? "Creating…" : "Create"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function InviteForm({ onSubmit, busy, error }: { onSubmit: (email: string) => void; busy: boolean; error: string | null }) {
  const [email, setEmail] = useState("");
  return (
    <div>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label htmlFor="invite-email" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Invite by email
          </label>
          <input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@company.com"
            className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm"
          />
        </div>
        <Button
          className="gap-1.5"
          onClick={() => {
            onSubmit(email);
            setEmail("");
          }}
          disabled={busy || !email.trim()}
        >
          <UserPlus className="h-3.5 w-3.5" /> {busy ? "Sending…" : "Invite"}
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
