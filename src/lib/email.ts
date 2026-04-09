import nodemailer from 'nodemailer';

function createTransport() {
  if (!process.env.EMAIL_HOST) return null;

  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT || '587', 10),
    secure: process.env.EMAIL_SECURE === 'true',
    auth: process.env.EMAIL_USER
      ? { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
      : undefined,
  });
}

export async function sendConfirmationEmail(email: string, token: string): Promise<void> {
  const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3001}`;
  const confirmUrl = `${appUrl}/api/auth/confirm-email?token=${token}`;
  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER || 'noreply@companies-intelligence.local';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
    <div style="background:#2563eb;padding:32px;text-align:center">
      <div style="font-size:32px">🏢</div>
      <h1 style="color:#fff;margin:8px 0 0;font-size:20px;font-weight:700">Companies Intelligence</h1>
    </div>
    <div style="padding:40px">
      <h2 style="color:#111827;font-size:18px;margin:0 0 16px">Confirm your email address</h2>
      <p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0 0 24px">
        Thanks for signing up! Click the button below to verify your email address and activate your account.
      </p>
      <a href="${confirmUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">
        Confirm Email Address
      </a>
      <p style="color:#9ca3af;font-size:12px;margin:32px 0 0;line-height:1.6">
        If you didn't create an account, you can safely ignore this email.<br>
        This link expires in 24 hours.
      </p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
      <p style="color:#9ca3af;font-size:12px;margin:0">
        Or copy this link into your browser:<br>
        <span style="color:#6b7280;word-break:break-all">${confirmUrl}</span>
      </p>
    </div>
  </div>
</body>
</html>`;

  const transporter = createTransport();

  if (!transporter) {
    console.log('\n📧 [EMAIL - DEV MODE — set EMAIL_HOST to send real emails]');
    console.log(`   To: ${email}`);
    console.log(`   Confirm URL: ${confirmUrl}\n`);
    return;
  }

  await transporter.sendMail({
    from,
    to: email,
    subject: 'Confirm your Companies Intelligence account',
    text: `Confirm your email address by visiting: ${confirmUrl}`,
    html,
  });
}
