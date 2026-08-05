import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Clipforge collects, uses, and protects your data.",
};

const LAST_UPDATED = "August 5, 2026";

const H2 = "mt-10 text-lg font-semibold tracking-tight";
const P = "mt-3 leading-relaxed text-muted-foreground";
const UL = "mt-3 list-disc space-y-1.5 pl-6 text-muted-foreground";

export default function PrivacyPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>

        <p className={P}>
          This Privacy Policy explains what information Clipforge collects when you use the Service, and how
          it's used.
        </p>

        <h2 className={H2}>1. Information we collect</h2>
        <ul className={UL}>
          <li>
            <span className="text-foreground">Account information:</span> name, email address, and password
            (stored as a salted hash, never in plain text).
          </li>
          <li>
            <span className="text-foreground">Content you provide:</span> scripts, prompts, product descriptions,
            and any video/audio files you upload for generation.
          </li>
          <li>
            <span className="text-foreground">Generated content:</span> the videos, voiceovers, and captions
            Clipforge produces for you.
          </li>
          <li>
            <span className="text-foreground">Billing information:</span> handled entirely by Stripe — we never
            see or store your card number. We keep a reference to your Stripe customer/subscription ID.
          </li>
          <li>
            <span className="text-foreground">Usage data:</span> basic request logs (IP address, timestamps) used
            for security and abuse prevention.
          </li>
        </ul>

        <h2 className={H2}>2. How we use your information</h2>
        <ul className={UL}>
          <li>To generate the videos, voiceovers, and captions you request</li>
          <li>To operate your account, track credits, and process billing</li>
          <li>To send account-related emails (e.g. password resets)</li>
          <li>To detect and prevent abuse of the Service</li>
        </ul>

        <h2 className={H2}>3. Third-party processors</h2>
        <p className={P}>
          Generating a video means sending relevant parts of your input to the providers that power that step.
          Depending on which provider is active for your request, this may include:
        </p>
        <ul className={UL}>
          <li>OpenAI and/or Groq — script writing, transcription, and text-to-speech</li>
          <li>Microsoft Edge TTS — text-to-speech (free-tier fallback)</li>
          <li>Pexels — stock video/photo b-roll matching</li>
          <li>Stripe — payment processing and subscription billing</li>
          <li>Cloudflare / Backblaze (or another S3-compatible provider) — storage of generated media files</li>
          <li>Resend — delivery of transactional emails (e.g. password resets)</li>
        </ul>
        <p className={P}>
          Each of these providers processes data under their own privacy policy and terms. We only send them what
          each specific generation step requires.
        </p>

        <h2 className={H2}>4. Data retention</h2>
        <p className={P}>
          We retain your account data and generated projects for as long as your account is active. You can
          delete individual projects from your dashboard. To delete your account entirely, contact us using the
          details on our homepage.
        </p>

        <h2 className={H2}>5. Data security</h2>
        <p className={P}>
          Passwords are hashed with bcrypt. Generated media is stored in a private bucket and served only through
          short-lived signed URLs — it is never made publicly listable. Data in transit is encrypted via HTTPS.
        </p>

        <h2 className={H2}>6. Your rights</h2>
        <p className={P}>
          Depending on where you live, you may have rights to access, correct, export, or delete your personal
          data. Contact us to exercise any of these rights.
        </p>

        <h2 className={H2}>7. Changes to this policy</h2>
        <p className={P}>
          We may update this Privacy Policy from time to time. Material changes will be reflected by updating the
          "Last updated" date above.
        </p>

        <h2 className={H2}>8. Contact</h2>
        <p className={P}>Questions about this policy? Reach out via the contact details on our homepage.</p>
      </main>
      <SiteFooter />
    </div>
  );
}
