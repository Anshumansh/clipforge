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

export async function sendVerificationEmail(to: string, verifyUrl: string): Promise<void> {
  await sendEmail(
    to,
    "Verify your Clipforge email",
    `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Verify your email</h2>
        <p>One more step before you can generate videos, clone your voice, or connect a social account — confirm this is really your inbox. This link expires in 24 hours.</p>
        <p><a href="${verifyUrl}" style="display:inline-block;padding:10px 20px;background:#111;color:#fff;border-radius:6px;text-decoration:none;">Verify email</a></p>
        <p>If you didn't create a Clipforge account, you can safely ignore this email.</p>
      </div>
    `
  );
}

export async function sendWorkspaceInviteEmail(
  to: string,
  inviterName: string,
  workspaceName: string,
  inviteUrl: string
): Promise<void> {
  await sendEmail(
    to,
    `${inviterName} invited you to ${workspaceName} on Clipforge`,
    `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>You've been invited to a Clipforge workspace</h2>
        <p>${inviterName} invited you to join <strong>${workspaceName}</strong> on Clipforge. Accepting shares their project pipeline and credit balance -- no separate subscription needed. This invite expires in 7 days.</p>
        <p><a href="${inviteUrl}" style="display:inline-block;padding:10px 20px;background:#111;color:#fff;border-radius:6px;text-decoration:none;">Accept invite</a></p>
        <p>If you weren't expecting this, you can safely ignore this email.</p>
      </div>
    `
  );
}
