"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Upload, X, Sparkles } from "lucide-react";
import { BRAND_FONT_KEYS, BRAND_FONT_LABELS, type BrandFontKey } from "@/lib/brand";

interface BrandKitData {
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  fontFamily: string | null;
  canApply: boolean;
}

const DEFAULT_PRIMARY = "#7c3aed";
const DEFAULT_SECONDARY = "#ec4899";

export function BrandKitForm({ initial }: { initial: BrandKitData }) {
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(initial.logoUrl);
  const [primaryColor, setPrimaryColor] = useState(initial.primaryColor ?? DEFAULT_PRIMARY);
  const [secondaryColor, setSecondaryColor] = useState(initial.secondaryColor ?? DEFAULT_SECONDARY);
  const [fontFamily, setFontFamily] = useState<BrandFontKey>(
    initial.fontFamily === "serif" || initial.fontFamily === "mono" ? initial.fontFamily : "sans"
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function onLogoSelected(file: File) {
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  }

  function removeLogo() {
    setLogoFile(null);
    setLogoPreview(null);
    setLogoUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);

    const form = new FormData();
    form.set("primaryColor", primaryColor);
    form.set("secondaryColor", secondaryColor);
    form.set("fontFamily", fontFamily);
    if (logoFile) form.set("logo", logoFile);
    if (!logoPreview && logoUrl === null) form.set("removeLogo", "true");

    const res = await fetch("/api/brand-kit", { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    setSaving(false);

    if (!res.ok) {
      setError(data.error ?? "Something went wrong");
      return;
    }
    setLogoUrl(data.logoUrl);
    setLogoFile(null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Brand kit</CardTitle>
          {!initial.canApply && (
            <Badge variant="outline" className="gap-1 border-primary/30 bg-primary/5">
              <Sparkles className="h-3 w-3 text-primary" /> Business plan
            </Badge>
          )}
        </div>
        <CardDescription>
          Your logo, colors, and font applied to every script-to-video, repurpose, and UGC ad render.
          {!initial.canApply && " Set it up now — it takes effect automatically once you're on the Business plan."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <p className="mb-2 text-sm font-medium">Logo</p>
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-secondary/40">
              {logoPreview ? (
                <img src={logoPreview} alt="Logo preview" className="h-full w-full object-contain" />
              ) : (
                <span className="text-[10px] text-muted-foreground">No logo</span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                id="brand-logo-input"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onLogoSelected(file);
                }}
              />
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> Upload
              </Button>
              {logoPreview && (
                <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={removeLogo}>
                  <X className="h-3.5 w-3.5" /> Remove
                </Button>
              )}
            </div>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">Shown in the top-left corner of every render. PNG with a transparent background works best.</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="brand-primary" className="mb-2 block text-sm font-medium">
              Primary color
            </label>
            <div className="flex items-center gap-2">
              <input
                id="brand-primary"
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="h-9 w-9 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
              />
              <input
                type="text"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="w-full rounded-md border border-border bg-background/60 px-2 py-1.5 text-sm"
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Active caption word + CTA gradient start</p>
          </div>
          <div>
            <label htmlFor="brand-secondary" className="mb-2 block text-sm font-medium">
              Secondary color
            </label>
            <div className="flex items-center gap-2">
              <input
                id="brand-secondary"
                type="color"
                value={secondaryColor}
                onChange={(e) => setSecondaryColor(e.target.value)}
                className="h-9 w-9 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
              />
              <input
                type="text"
                value={secondaryColor}
                onChange={(e) => setSecondaryColor(e.target.value)}
                className="w-full rounded-md border border-border bg-background/60 px-2 py-1.5 text-sm"
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">CTA gradient end</p>
          </div>
        </div>

        <div>
          <label htmlFor="brand-font" className="mb-2 block text-sm font-medium">
            Font
          </label>
          <select
            id="brand-font"
            value={fontFamily}
            onChange={(e) => setFontFamily(e.target.value as BrandFontKey)}
            className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm"
          >
            {BRAND_FONT_KEYS.map((key) => (
              <option key={key} value={key}>
                {BRAND_FONT_LABELS[key]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">Applied to captions and CTA text.</p>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save brand kit"}
          </Button>
          {saved && <span className="text-xs text-emerald-500">Saved</span>}
        </div>
      </CardContent>
    </Card>
  );
}
