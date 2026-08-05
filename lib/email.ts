const RESEND_API_URL = "https://api.resend.com/emails";

// resend.dev is Resend's shared sending domain — works with no DNS setup, meant
// for testing/low-volume sends. Once a custom domain is verified in Resend,
// set EMAIL_FROM to an address on it for better deliverability.
const DEFAULT_FROM = "Clipforge <onboarding@resend.dev>";

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY not set");

  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || DEFAULT_FROM,
      to,
      subject,
      html,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend send failed: ${res.status} ${body}`);
  }
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  await sendEmail(
    to,
    "Reset your Clipforge password",
    `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Reset your password</h2>
        <p>We got a request to reset the password for your Clipforge account. This link expires in 1 hour.</p>
        <p><a href="${resetUrl}" style="display:inline-block;padding:10px 20px;background:#111;color:#fff;border-radius:6px;text-decoration:none;">Reset password</a></p>
        <p>If you didn't request this, you can safely ignore this email.</p>
      </div>
    `
  );
}
