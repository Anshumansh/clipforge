"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Copy, Check, Trash2, Sparkles, KeyRound } from "lucide-react";

interface ApiKeySummary {
  id: string;
  label: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setFailed(false);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          setFailed(true);
        }
      }}
      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium transition-colors hover:bg-secondary"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
      {failed ? "Copy failed" : copied ? "Copied" : "Copy"}
    </button>
  );
}

export function ApiKeysManager({ canCreate, initialKeys }: { canCreate: boolean; initialKeys: ApiKeySummary[] }) {
  const [keys, setKeys] = useState(initialKeys);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freshKey, setFreshKey] = useState<{ id: string; raw: string } | null>(null);
  const [mcpEndpoint, setMcpEndpoint] = useState("/api/mcp");

  useEffect(() => {
    setMcpEndpoint(`${window.location.origin}/api/mcp`);
  }, []);

  async function createKey() {
    setCreating(true);
    setError(null);
    let res: Response;
    try {
      res = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() || "MCP key" }),
      });
    } catch {
      setCreating(false);
      setError("Could not reach the server. Check your connection and try again.");
      return;
    }
    const data = await res.json().catch(() => ({}));
    setCreating(false);
    if (!res.ok) {
      setError(data.error ?? "Could not generate a key. Please try again.");
      return;
    }
    setKeys((prev) => [
      { id: data.id, label: data.label, keyPrefix: data.keyPrefix, lastUsedAt: null, createdAt: new Date().toISOString() },
      ...prev,
    ]);
    setFreshKey({ id: data.id, raw: data.raw });
    setLabel("");
  }

  async function revokeKey(id: string) {
    if (!window.confirm("Revoke this API key? Any integration using it will stop immediately.")) return;
    setError(null);
    let res: Response;
    try {
      res = await fetch(`/api/api-keys/${id}`, { method: "DELETE" });
    } catch {
      setError("Could not reach the server. The key was not revoked.");
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not revoke the key. Please try again.");
      return;
    }
    setKeys((prev) => prev.filter((k) => k.id !== id));
    if (freshKey?.id === id) setFreshKey(null);
  }

  const configSnippet = JSON.stringify(
    {
      mcpServers: {
        clipforge: {
          type: "http",
          url: mcpEndpoint,
          headers: { Authorization: `Bearer ${freshKey?.raw ?? "cf_live_..."}` },
        },
      },
    },
    null,
    2
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Your keys</CardTitle>
            {!canCreate && (
              <Badge variant="outline" className="gap-1 border-primary/30 bg-primary/5">
                <Sparkles className="h-3 w-3 text-primary" /> Business plan
              </Badge>
            )}
          </div>
          <CardDescription>
            {canCreate
              ? "Each key acts as your account when used through the API or an MCP client. Treat it like a password."
              : "API access is a Business-plan feature. Upgrade to generate a key."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {keys.length === 0 && <p className="text-sm text-muted-foreground">No keys yet.</p>}
          {keys.map((k) => (
            <div key={k.id} className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
              <div>
                <p className="text-sm font-medium">{k.label}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {k.keyPrefix}… · {k.lastUsedAt ? `last used ${new Date(k.lastUsedAt).toLocaleDateString()}` : "never used"}
                </p>
              </div>
              <Button variant="ghost" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => revokeKey(k.id)}>
                <Trash2 className="h-3.5 w-3.5" /> Revoke
              </Button>
            </div>
          ))}

          {canCreate && (
            <div className="flex items-end gap-2 border-t border-border pt-4">
              <div className="flex-1">
                <label htmlFor="key-label" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Label
                </label>
                <input
                  id="key-label"
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Claude Desktop"
                  maxLength={60}
                  className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm"
                />
              </div>
              <Button onClick={createKey} disabled={creating} className="gap-1.5">
                <KeyRound className="h-4 w-4" /> {creating ? "Generating…" : "Generate key"}
              </Button>
            </div>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {freshKey && (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle className="text-base">Save this key now</CardTitle>
            <CardDescription>This is the only time it's shown in full. If you lose it, revoke it and generate a new one.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2">
              <code className="overflow-x-auto text-xs">{freshKey.raw}</code>
              <CopyButton text={freshKey.raw} />
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connect an AI assistant</CardTitle>
          <CardDescription>Add Clipforge as an MCP server so a compatible assistant can generate and check videos for you.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="mb-2 text-xs text-muted-foreground">MCP endpoint</p>
          <div className="mb-4 flex items-center justify-between gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2">
            <code className="text-xs">{mcpEndpoint}</code>
            <CopyButton text={mcpEndpoint} />
          </div>
          <p className="mb-2 text-xs text-muted-foreground">Example config (Claude Desktop, Claude Code or another MCP client)</p>
          <div className="relative rounded-lg border border-border bg-secondary/40 p-3">
            <pre className="overflow-x-auto text-xs"><code>{configSnippet}</code></pre>
            <div className="absolute right-2 top-2">
              <CopyButton text={configSnippet} />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
