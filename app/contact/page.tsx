import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Reveal, RevealGroup, RevealItem } from "@/components/reveal";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LifeBuoy, CreditCard, ShieldAlert, Copyright, ShieldCheck, Mic2 } from "lucide-react";

export const metadata: Metadata = {
  title: "Contact",
  description: "Reach Clipforge for support, billing, privacy requests, copyright complaints, or security reports.",
};

const SUPPORT_EMAIL = "support@forgecut.app";

function mailto(subject: string) {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}

const channels = [
  {
    icon: LifeBuoy,
    title: "General support",
    description: "Something broke, a render failed, or you're not sure how a feature works.",
    subject: "[Support] ",
  },
  {
    icon: CreditCard,
    title: "Billing & refunds",
    description: "Subscription changes, a charge you don't recognize, or a cancellation issue.",
    subject: "[Billing] ",
  },
  {
    icon: ShieldCheck,
    title: "Privacy requests",
    description: "Export your data, request a correction, or ask us to delete your account and associated data.",
    subject: "[Privacy request] ",
  },
  {
    icon: Copyright,
    title: "Copyright complaints",
    description: "Report content generated or hosted through Clipforge that infringes your copyright.",
    subject: "[Copyright] ",
  },
  {
    icon: ShieldAlert,
    title: "Security disclosure",
    description: "Report a vulnerability. Please include steps to reproduce — see our responsible-disclosure notes below.",
    subject: "[Security] ",
  },
  {
    icon: Mic2,
    title: "Voice-cloning abuse report",
    description: "Report a voice clone used without the speaker's consent, or created to impersonate someone.",
    subject: "[Voice abuse report] ",
  },
];

export default function ContactPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1 px-6 py-20">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-4xl font-bold tracking-tight">Contact us</h1>
            <p className="mt-4 text-muted-foreground">
              Every category below currently routes to one monitored inbox — {SUPPORT_EMAIL}. Picking a category
              below pre-fills the subject line so your message gets triaged correctly; it doesn't route anywhere
              different yet.
            </p>
          </div>
        </Reveal>

        <RevealGroup className="mx-auto mt-14 grid max-w-4xl gap-5 sm:grid-cols-2">
          {channels.map((c) => (
            <RevealItem key={c.title}>
              <Card className="h-full">
                <CardHeader>
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15">
                    <c.icon className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="text-base">{c.title}</CardTitle>
                  <CardDescription>{c.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button asChild size="sm" variant="outline">
                    <a href={mailto(c.subject)}>Email {SUPPORT_EMAIL}</a>
                  </Button>
                </CardContent>
              </Card>
            </RevealItem>
          ))}
        </RevealGroup>

        <Reveal>
          <div className="mx-auto mt-14 max-w-2xl space-y-4 rounded-xl border border-border/60 bg-card/40 p-6 text-sm text-muted-foreground">
            <p>
              <strong className="text-foreground">Response times:</strong> Clipforge is not a 24/7 operation. We
              don't currently commit to a fixed response-time SLA — we read and respond to every message, but please
              don't rely on this for a time-critical outage.
            </p>
            <p>
              <strong className="text-foreground">Security disclosure:</strong> if you've found a vulnerability,
              please report it privately here rather than filing a public issue, and give us a reasonable window to
              fix it before any public disclosure. See{" "}
              <a href="/.well-known/security.txt" className="underline underline-offset-2 hover:text-foreground">
                /.well-known/security.txt
              </a>{" "}
              for the same contact in machine-readable form.
            </p>
            <p>
              <strong className="text-foreground">Business identity:</strong> legal entity name, registration
              details, and a physical service address will be published here once finalized — see our{" "}
              <a href="/terms" className="underline underline-offset-2 hover:text-foreground">
                Terms
              </a>{" "}
              for what's currently disclosed.
            </p>
          </div>
        </Reveal>
      </main>
      <SiteFooter />
    </div>
  );
}
