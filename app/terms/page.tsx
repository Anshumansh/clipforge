import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Clipforge's terms of service.",
};

const LAST_UPDATED = "August 9, 2026";

const H2 = "mt-10 text-lg font-semibold tracking-tight";
const H3 = "mt-6 text-base font-semibold tracking-tight";
const P = "mt-3 leading-relaxed text-muted-foreground";
const UL = "mt-3 list-disc space-y-1.5 pl-6 text-muted-foreground";

export default function TermsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <h1 className="text-3xl font-bold tracking-tight">Terms of Service</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>

        <p className={P}>
          These Terms of Service ("Terms") govern your use of Clipforge (the "Service"). Clipforge is operated by
          Anshuman Sharma, an individual sole proprietor ("Clipforge", "we", "us") — not yet a separate registered
          business entity. By creating an account or using the Service, you agree to these Terms.
        </p>

        <h2 className={H2}>1. The Service</h2>
        <p className={P}>
          Clipforge generates short-form video content using third-party AI providers (including OpenAI, Groq,
          and Pexels) based on the scripts, prompts, and media you provide. It also offers optional features that
          connect to third-party platforms — YouTube, TikTok, and Instagram accounts you choose to connect, and
          the YouTube Data API for the Trend Radar feature (see §4 and our Privacy Policy for what that involves).
          Generation consumes credits allocated to your plan.
        </p>

        <h2 className={H2}>2. Eligibility</h2>
        <p className={P}>
          You must be at least 18 years old, or the age of majority in your jurisdiction if higher, to use the
          Service. The Service is not directed at children, and we do not knowingly collect information from
          anyone under 18. If we learn a child has created an account, we'll delete it.
        </p>

        <h2 className={H2}>3. Accounts</h2>
        <p className={P}>
          You must provide accurate information when creating an account and are responsible for keeping your
          login credentials secure. You're responsible for all activity that happens under your account.
        </p>

        <h2 className={H2}>4. Acceptable use</h2>
        <p className={P}>You agree not to use the Service to generate or distribute content that:</p>
        <ul className={UL}>
          <li>Infringes someone else's intellectual property or publicity rights</li>
          <li>Is defamatory, fraudulent, or misleading (including impersonation or deceptive deepfakes)</li>
          <li>Is unlawful, harassing, hateful, or sexually exploitative</li>
          <li>Violates the acceptable-use policies of the third-party providers we rely on (OpenAI, Pexels, etc.)</li>
        </ul>

        <h3 id="4-1-voice-cloning" className={H3}>4.1 Voice cloning</h3>
        <p className={P}>
          If you use the voice cloning feature, you confirm that you own the voice you're uploading, or that you
          have that person's explicit, informed consent to clone and use their voice through Clipforge. A general
          agreement to these Terms does not by itself satisfy that requirement for any specific voice you upload —
          you need the actual consent of the person whose voice it is. Cloning a voice you don't have the right to
          use, including public figures, celebrities, or anyone who hasn't agreed to it, is prohibited and will
          result in account termination. We may require you to demonstrate that consent on request.
        </p>

        <h3 className={H3}>4.2 Auto-posting to connected platforms</h3>
        <p className={P}>
          If you connect a YouTube, TikTok, or Instagram account, you're responsible for what gets published to
          it — Clipforge publishes on your explicit action, using your own connected credentials. You're
          responsible for complying with each platform's own terms and policies, including their requirements
          around disclosing AI-generated or synthetic media, which several platforms mandate as of 2026. You can
          disconnect any platform at any time from your dashboard.
        </p>

        <p className={P}>We may suspend or terminate accounts that violate this policy, at our discretion.</p>

        <h2 className={H2}>5. Your content</h2>
        <p className={P}>
          You retain ownership of the scripts, media, and other input you upload, and of the videos Clipforge
          generates for you. You're responsible for having the rights to any content you upload (e.g. footage you
          submit to the Repurpose tool, or a voice sample for cloning) and for how you use generated output.
        </p>

        <h2 className={H2}>6. Trend Radar and generated content originality</h2>
        <p className={P}>
          Trend Radar analyzes publicly available YouTube video metadata (titles, descriptions, thumbnails, and
          public view/engagement statistics) via the official YouTube Data API to identify structural patterns —
          never the video's actual audio or spoken content — and uses those patterns to help generate an
          original script for you. The output is meant to be original content inspired by a structural style, not
          a copy of any specific video. You're still responsible for reviewing generated output before publishing
          it, the same as any other Clipforge-generated content.
        </p>

        <h2 className={H2}>7. Billing</h2>
        <p className={P}>
          Paid plans are billed on a recurring basis through Stripe. Credits reset each billing period and unused
          credits don't roll over unless stated otherwise on the pricing page. You can cancel anytime from your
          billing dashboard; cancellation takes effect at the end of the current billing period, and you keep
          access until then. We don't offer refunds for partial billing periods or unused credits, except where
          required by law or at our discretion for a genuine service failure on our part.
        </p>

        <h2 className={H2}>8. Copyright complaints (DMCA)</h2>
        <p className={P}>
          If you believe content generated or hosted through Clipforge infringes your copyright, send a notice to{" "}
          <a href="mailto:support@forgecut.app" className="text-primary hover:underline">support@forgecut.app</a>{" "}
          with: (1) a description of the copyrighted work, (2) the specific URL or location of the material on
          Clipforge, (3) your contact information, (4) a statement that you have a good-faith belief the use is
          unauthorized, and (5) a statement made under penalty of perjury that the notice is accurate and you're
          authorized to act on the copyright owner's behalf. We'll respond and remove or disable access to
          material we determine to be infringing.
        </p>

        <h2 className={H2}>9. Service availability</h2>
        <p className={P}>
          The Service is provided "as is." Generation depends on third-party AI providers we don't control, and
          results (including rendering time and output quality) may vary. We don't guarantee uninterrupted or
          error-free operation.
        </p>

        <h2 className={H2}>10. Limitation of liability</h2>
        <p className={P}>
          To the maximum extent permitted by law, Clipforge is not liable for indirect, incidental, or
          consequential damages arising from your use of the Service. Our total liability for any claim is
          limited to the amount you paid us in the 3 months before the claim arose.
        </p>

        <h2 className={H2}>11. Indemnification</h2>
        <p className={P}>
          You agree to indemnify and hold Clipforge harmless from any claims, damages, or expenses (including
          reasonable legal fees) arising from your use of the Service, your generated content, or your violation
          of these Terms — including claims related to content you generate, footage or voice samples you upload,
          or your use of a connected social platform account.
        </p>

        <h2 className={H2}>12. Governing law</h2>
        <p className={P}>
          These Terms are governed by the laws of the United States, without regard to conflict-of-law
          principles. Any dispute arising from these Terms or the Service will be resolved through
          individual arbitration or small-claims court where permitted, rather than as part of a class action, to
          the extent allowed by applicable law.
        </p>

        <h2 className={H2}>13. Changes</h2>
        <p className={P}>
          We may update these Terms from time to time. Continued use of the Service after changes take effect
          constitutes acceptance of the revised Terms.
        </p>

        <h2 className={H2}>14. Contact</h2>
        <p className={P}>
          Questions about these Terms? Reach us at{" "}
          <a href="mailto:support@forgecut.app" className="text-primary hover:underline">support@forgecut.app</a>.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
