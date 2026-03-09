/**
 * Email Service — Team Invitation Emails
 *
 * Uses Resend when RESEND_API_KEY is set; falls back to console logging
 * so development and local mode work without configuration.
 */

import { Resend } from 'resend'

const BASE_URL = process.env.ASTRO_BASE_URL || 'http://localhost:5173'
const NOREPLY_EMAIL = process.env.ASTRO_NOREPLY_EMAIL || 'noreply@astroanywhere.com'
const RESEND_API_KEY = process.env.RESEND_API_KEY

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
 * Send a team invitation email via Resend.
 * Falls back to console logging when RESEND_API_KEY is not set.
 */
export async function sendInvitationEmail(data: InvitationEmailData): Promise<boolean> {
  if (!RESEND_API_KEY) {
    // No email provider configured — log invite link so it's discoverable in dev
    console.log('[email] RESEND_API_KEY not set — logging invite instead of sending')
    console.log(`[email] Invite for ${data.to} → ${data.inviteUrl}`)
    return true
  }

  try {
    const resend = new Resend(RESEND_API_KEY)
    const { error } = await resend.emails.send({
      from: `Astro <${NOREPLY_EMAIL}>`,
      to: data.to,
      subject: `You've been invited to join ${data.teamName} on Astro`,
      html: generateInvitationEmailHTML(data),
      text: generateInvitationEmailText(data),
    })

    if (error) {
      console.error('[email] Resend error:', error)
      return false
    }

    console.log(`[email] Invitation sent to ${data.to} via Resend`)
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
    h1 { font-size: 24px; margin: 0 0 16px 0; color: #111; }
    p { margin: 0 0 16px 0; color: #555; }
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
    .details-label { font-weight: 500; color: #666; }
    .details-value { color: #333; }
    .footer {
      margin-top: 32px;
      padding-top: 24px;
      border-top: 1px solid #e5e7eb;
      font-size: 14px;
      color: #6b7280;
    }
    .warning { font-size: 14px; color: #ef4444; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">Astro</div>
    <h1>You've been invited to join ${escapeHtml(data.teamName)}</h1>
    <p>
      ${escapeHtml(data.inviterName)} (${escapeHtml(data.inviterEmail)}) has invited you to join their workspace on Astro.
    </p>
    <div class="details">
      <div class="details-row">
        <span class="details-label">Workspace:</span>
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
    <p>Click the button below to accept. This link will expire on ${expiryDate}.</p>
    <a href="${escapeHtml(data.inviteUrl)}" class="button">Accept Invitation</a>
    <p class="warning">
      This invitation is only valid for <strong>${escapeHtml(data.to)}</strong>.
      If you didn't expect this, you can safely ignore this email.
    </p>
    <div class="footer">
      <p>
        Sent from <a href="${escapeHtml(BASE_URL)}">Astro</a>, a planning-first platform for builders and scientists.
      </p>
      <p>
        If the button doesn't work, copy this URL into your browser:<br>
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

${data.inviterName} (${data.inviterEmail}) has invited you to join their workspace on Astro.

Workspace: ${data.teamName}
Role: ${data.role}
Invited by: ${data.inviterName}

Accept this invitation: ${data.inviteUrl}

This invitation expires on ${expiryDate}.
It is only valid for ${data.to}. If you didn't expect this, ignore this email.

---
Sent from Astro (${BASE_URL})
  `.trim()
}
