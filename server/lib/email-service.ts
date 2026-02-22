/**
 * Email Service — Team Invitation Emails
 *
 * Abstraction layer for sending emails. Currently logs to console.
 * In production, integrate with SendGrid, AWS SES, Resend, or similar.
 */

const BASE_URL = process.env.ASTRO_BASE_URL || 'http://localhost:5173'
const NOREPLY_EMAIL = process.env.ASTRO_NOREPLY_EMAIL || 'noreply@astro.app'

export interface InvitationEmailData {
  to: string
  teamName: string
  inviterName: string
  inviterEmail: string
  inviteUrl: string
  role: string
  expiresAt: Date
}

/**
 * Send a team invitation email.
 *
 * @param data - Invitation email data
 * @returns Promise<boolean> - Success status
 */
export async function sendInvitationEmail(data: InvitationEmailData): Promise<boolean> {
  try {
    // TODO: Integrate with actual email service (SendGrid, AWS SES, Resend, etc.)
    // For now, log to console for development/testing

    const emailContent = generateInvitationEmailHTML(data)

    console.log('[email] Sending team invitation email:')
    console.log({
      to: data.to,
      from: '${NOREPLY_EMAIL}',
      subject: `You've been invited to join ${data.teamName} on Astro`,
      teamName: data.teamName,
      inviterName: data.inviterName,
      inviteUrl: data.inviteUrl,
      expiresAt: data.expiresAt.toISOString(),
    })

    console.log('[email] Email HTML preview:')
    console.log(emailContent)

    // In production, replace with actual email sending:
    // const result = await emailProvider.send({
    //   to: data.to,
    //   from: '${NOREPLY_EMAIL}',
    //   subject: `You've been invited to join ${data.teamName} on Astro`,
    //   html: emailContent,
    // })
    // return result.success

    return true
  } catch (error) {
    console.error('[email] Failed to send invitation email:', error)
    return false
  }
}

/**
 * Generate HTML content for invitation email.
 */
function generateInvitationEmailHTML(data: InvitationEmailData): string {
  const expiryDate = data.expiresAt.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Team Invitation</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f5f5f5;
    }
    .container {
      background-color: white;
      border-radius: 8px;
      padding: 32px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .logo {
      font-size: 24px;
      font-weight: 600;
      color: #3b82f6;
      margin-bottom: 24px;
    }
    h1 {
      font-size: 24px;
      margin: 0 0 16px 0;
      color: #111;
    }
    p {
      margin: 0 0 16px 0;
      color: #555;
    }
    .button {
      display: inline-block;
      padding: 12px 24px;
      background-color: #3b82f6;
      color: white;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 500;
      margin: 16px 0;
    }
    .button:hover {
      background-color: #2563eb;
    }
    .details {
      background-color: #f9fafb;
      border-radius: 6px;
      padding: 16px;
      margin: 16px 0;
    }
    .details-row {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
    }
    .details-label {
      font-weight: 500;
      color: #666;
    }
    .details-value {
      color: #333;
    }
    .footer {
      margin-top: 32px;
      padding-top: 24px;
      border-top: 1px solid #e5e7eb;
      font-size: 14px;
      color: #6b7280;
    }
    .warning {
      font-size: 14px;
      color: #ef4444;
      margin-top: 16px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">✨ Astro</div>

    <h1>You've been invited to join ${escapeHtml(data.teamName)}</h1>

    <p>
      ${escapeHtml(data.inviterName)} (${escapeHtml(data.inviterEmail)}) has invited you to join their team on Astro.
    </p>

    <div class="details">
      <div class="details-row">
        <span class="details-label">Team:</span>
        <span class="details-value">${escapeHtml(data.teamName)}</span>
      </div>
      <div class="details-row">
        <span class="details-label">Role:</span>
        <span class="details-value">${escapeHtml(data.role)}</span>
      </div>
      <div class="details-row">
        <span class="details-label">Invited by:</span>
        <span class="details-value">${escapeHtml(data.inviterName)}</span>
      </div>
    </div>

    <p>
      Click the button below to accept this invitation. This link will expire on ${expiryDate}.
    </p>

    <a href="${escapeHtml(data.inviteUrl)}" class="button">Accept Invitation</a>

    <p class="warning">
      ⚠️ This invitation is only valid for <strong>${escapeHtml(data.to)}</strong>.
      If you didn't expect this invitation, you can safely ignore this email.
    </p>

    <div class="footer">
      <p>
        This invitation was sent from <a href="${escapeHtml(BASE_URL)}">Astro</a>,
        a planning-first platform for builders and scientists.
      </p>
      <p>
        If you're having trouble with the button above, copy and paste this URL into your browser:<br>
        <a href="${escapeHtml(data.inviteUrl)}">${escapeHtml(data.inviteUrl)}</a>
      </p>
    </div>
  </div>
</body>
</html>
  `.trim()
}

/**
 * Escape HTML special characters to prevent XSS.
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }
  return text.replace(/[&<>"']/g, (char) => map[char] || char)
}

/**
 * Generate plain text version of invitation email.
 */
export function generateInvitationEmailText(data: InvitationEmailData): string {
  const expiryDate = data.expiresAt.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return `
You've been invited to join ${data.teamName}

${data.inviterName} (${data.inviterEmail}) has invited you to join their team on Astro.

Team: ${data.teamName}
Role: ${data.role}
Invited by: ${data.inviterName}

Accept this invitation by visiting:
${data.inviteUrl}

This invitation will expire on ${expiryDate}.

⚠️ This invitation is only valid for ${data.to}. If you didn't expect this invitation, you can safely ignore this email.

---
This invitation was sent from Astro (${BASE_URL}), a planning-first platform for builders and scientists.
  `.trim()
}
