import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Clipforge's terms of service.",
};

const LAST_UPDATED = "August 5, 2026";

const H2 = "mt-10 text-lg font-semibold tracking-tight";
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
          These Terms of Service ("Terms") govern your use of Clipforge (the "Service"), operated by us
          ("Clipforge", "we", "us"). By creating an account or using the Service, you agree to these Terms.
        </p>

        <h2 className={H2}>1. The Service</h2>
        <p className={P}>
          Clipforge generates short-form video content using third-party AI providers (including OpenAI, Groq,
          and Pexels) based on the scripts, prompts, and media you provide. Generation consumes credits allocated
          to your plan.
        </p>

        <h2 className={H2}>2. Accounts</h2>
        <p className={P}>
          You must provide accurate information when creating an account and are responsible for keeping your
          login credentials secure. You're responsible for all activity that happens under your account.
        </p>

        <h2 className={H2}>3. Acceptable use</h2>
        <p className={P}>You agree not to use the Service to generate or distribute content that:</p>
        <ul className={UL}>
          <li>Infringes someone else's intellectual property or publicity rights</li>
          <li>Is defamatory, fraudulent, or misleading (including impersonation or deceptive deepfakes)</li>
          <li>Is unlawful, harassing, hateful, or sexually exploitative</li>
          <li>Violates the acceptable-use policies of the third-party providers we rely on (OpenAI, Pexels, etc.)</li>
        </ul>
        <p className={P}>We may suspend or terminate accounts that violate this policy.</p>

        <h2 className={H2}>4. Your content</h2>
        <p className={P}>
          You retain ownership of the scripts, media, and other input you upload, and of the videos Clipforge
          generates for you. You're responsible for having the rights to any content you upload (e.g. footage you
          submit to the Repurpose tool) and for how you use generated output, including complying with
          platform-specific rules (TikTok, YouTube, Instagram, etc.) on AI-generated or synthetic media.
        </p>

        <h2 className={H2}>5. Billing</h2>
        <p className={P}>
          Paid plans are billed on a recurring basis through Stripe. Credits reset each billing period and unused
          credits don't roll over unless stated otherwise on the pricing page. You can cancel anytime from your
          billing dashboard; cancellation takes effect at the end of the current billing period.
        </p>

        <h2 className={H2}>6. Service availability</h2>
        <p className={P}>
          The Service is provided "as is." Generation depends on third-party AI providers we don't control, and
          results (including rendering time and output quality) may vary. We don't guarantee uninterrupted or
          error-free operation.
        </p>

        <h2 className={H2}>7. Limitation of liability</h2>
        <p className={P}>
          To the maximum extent permitted by law, Clipforge is not liable for indirect, incidental, or
          consequential damages arising from your use of the Service. Our total liability for any claim is
          limited to the amount you paid us in the 3 months before the claim arose.
        </p>

        <h2 className={H2}>8. Changes</h2>
        <p className={P}>
          We may update these Terms from time to time. Continued use of the Service after changes take effect
          constitutes acceptance of the revised Terms.
        </p>

        <h2 className={H2}>9. Contact</h2>
        <p className={P}>Questions about these Terms? Reach out via the contact details on our homepage.</p>
      </main>
      <SiteFooter />
    </div>
  );
}
