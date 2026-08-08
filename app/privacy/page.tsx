import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Clipforge collects, uses, and protects your data.",
};

const LAST_UPDATED = "August 9, 2026";

const H2 = "mt-10 text-lg font-semibold tracking-tight";
const H3 = "mt-6 text-base font-semibold tracking-tight";
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
          it's used. Clipforge is operated by Anshuman Sharma, an individual sole proprietor.
        </p>

        <h2 className={H2}>1. Information we collect</h2>
        <ul className={UL}>
          <li>
            <span className="text-foreground">Account information:</span> name, email address, and password
            (stored as a salted bcrypt hash, never in plain text).
          </li>
          <li>
            <span className="text-foreground">Content you provide:</span> scripts, prompts, product descriptions,
            and any video/audio files you upload for generation — including a reference voice sample if you use
            voice cloning (see §3 below for how that's specifically handled).
          </li>
          <li>
            <span className="text-foreground">Generated content:</span> the videos, voiceovers, and captions
            Clipforge produces for you.
          </li>
          <li>
            <span className="text-foreground">Connected platform data:</span> if you connect a YouTube, TikTok,
            or Instagram account, we store your platform account ID, display name, and an OAuth access/refresh
            token — encrypted at rest (AES-256-GCM) and never stored or logged in plain text — so we can publish
            on your behalf when you choose to. Disconnecting a platform deletes the stored token.
          </li>
          <li>
            <span className="text-foreground">Trend Radar data:</span> if you use Trend Radar, we store the
            niche and YouTube channels you choose to track, and public YouTube video metadata (titles,
            thumbnails, and public view/engagement statistics) for videos related to those channels — collected
            via the official YouTube Data API. This is public information about videos, not personal data about
            you, except for your own niche/channel selections.
          </li>
          <li>
            <span className="text-foreground">Billing information:</span> handled entirely by Stripe — we never
            see or store your card number. We keep a reference to your Stripe customer/subscription ID.
          </li>
          <li>
            <span className="text-foreground">Usage data:</span> basic request logs (IP address, timestamps) used
            for security and abuse prevention.
          </li>
          <li>
            <span className="text-foreground">Cookies:</span> we use only strictly necessary cookies — a signed
            session cookie (to keep you logged in) and a short-lived OAuth state cookie (to prevent forged
            connection requests when you link a social platform). No advertising, analytics, or tracking cookies
            are set, and we don't run any third-party analytics or tracking scripts on the Service.
          </li>
        </ul>

        <h2 className={H2}>2. How we use your information</h2>
        <ul className={UL}>
          <li>To generate the videos, voiceovers, and captions you request</li>
          <li>To operate your account, track credits, and process billing</li>
          <li>To publish to platforms you've explicitly connected, when you ask us to</li>
          <li>To run Trend Radar's scheduled scans of the channels/niches you've chosen to track</li>
          <li>To send account-related emails (e.g. password resets)</li>
          <li>To detect and prevent abuse of the Service</li>
        </ul>

        <h2 className={H2}>3. Voice cloning data</h2>
        <p className={P}>
          A reference voice sample you upload for cloning is stored in the same private media storage as your
          other project files, and is used only to generate the voiceover for that project — it's never used to
          train a shared model or used for any other user's generation. Voice recordings can be considered
          sensitive or biometric-adjacent data under some laws (e.g. Illinois's BIPA, and California's CCPA/CPRA
          treatment of biometric information). By uploading a voice sample, you consent to Clipforge processing
          it for the purpose of voice cloning as described in our Terms of Service §4.1. You can delete a
          project (and its associated voice sample) from your dashboard at any time, or request full account
          deletion — see §6.
        </p>

        <h2 className={H2}>4. Third-party processors</h2>
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
          <li>Google (YouTube Data API) — Trend Radar's channel/video data, and YouTube publishing if you connect a YouTube account</li>
          <li>TikTok and Meta (Instagram) — publishing, if you connect those accounts</li>
        </ul>
        <p className={P}>
          Each of these providers processes data under their own privacy policy and terms. We only send them what
          each specific feature requires. Some of these providers are located outside your country and may
          process data internationally; where required, we rely on those providers' own compliance mechanisms
          (e.g. standard contractual clauses) for cross-border transfers.
        </p>

        <h3 className={H3}>4.1 YouTube API Services disclosure</h3>
        <p className={P}>
          Trend Radar uses the YouTube Data API Service. By using this feature, you're also agreeing to be bound
          by the{" "}
          <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            YouTube Terms of Service
          </a>
          . Google's use of information received from the YouTube API is governed by the{" "}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            Google Privacy Policy
          </a>
          . You can revoke Clipforge's access to your Google/YouTube account at any time via{" "}
          <a href="https://security.google.com/settings/security/permissions" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            Google's security settings
          </a>{" "}
          or by disconnecting YouTube from your Clipforge dashboard.
        </p>

        <h2 className={H2}>5. Data retention</h2>
        <p className={P}>
          We retain your account data and generated projects for as long as your account is active. You can
          delete individual projects from your dashboard. Database backups are retained for 30 days on a rolling
          basis for disaster recovery, then automatically deleted.
        </p>

        <h2 className={H2}>6. Your rights</h2>
        <p className={P}>Depending on where you live, you may have rights including:</p>
        <ul className={UL}>
          <li>Access — request a copy of the personal data we hold about you</li>
          <li>Correction — ask us to fix inaccurate data</li>
          <li>Deletion — ask us to delete your account and associated data (see below)</li>
          <li>Portability — request your data in a portable format</li>
          <li>Objection/restriction — object to or limit certain processing</li>
          <li>
            California residents specifically also have the right to know what personal information is
            collected, and to opt out of any sale or sharing of it — we don't sell or share personal information
            to third parties for advertising purposes
          </li>
        </ul>
        <p className={P}>
          You can permanently delete your account and all associated data (projects, generated media, connected
          platform tokens, and voice samples) from{" "}
          <span className="text-foreground">Dashboard → Billing → Delete account</span>. This immediately cancels
          any active subscription and cannot be undone. For any other request, or if you'd rather we handle it
          for you, email{" "}
          <a href="mailto:support@forgecut.app" className="text-primary hover:underline">support@forgecut.app</a>.
        </p>

        <h2 className={H2}>7. Data security</h2>
        <p className={P}>
          Passwords are hashed with bcrypt. Social platform access tokens are encrypted at rest (AES-256-GCM).
          Generated media is stored in a private bucket and served only through short-lived signed URLs — it is
          never made publicly listable. Data in transit is encrypted via HTTPS.
        </p>

        <h2 className={H2}>8. Children's privacy</h2>
        <p className={P}>
          The Service is not directed at anyone under 18, and we don't knowingly collect data from children. See
          our Terms of Service §2.
        </p>

        <h2 className={H2}>9. Changes to this policy</h2>
        <p className={P}>
          We may update this Privacy Policy from time to time. Material changes will be reflected by updating the
          "Last updated" date above.
        </p>

        <h2 className={H2}>10. Contact</h2>
        <p className={P}>
          Questions about this policy, or want to exercise any of the rights above? Email{" "}
          <a href="mailto:support@forgecut.app" className="text-primary hover:underline">support@forgecut.app</a>.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
