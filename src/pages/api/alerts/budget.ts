/**
 * Send a budget-alert email to the auditor viewing the dashboard.
 *
 * Triggered by the "Send critical alerts now" button on the Budget Allocation
 * audit when one or more campaigns are flagged Overspending/Critical.
 *
 * Sending path (in priority order):
 *   1. Gmail API — if the request carries `gmailAuth` (the user's DV360 Google
 *      OAuth creds with the gmail.send scope). Sends FROM the signed-in Gmail.
 *      No provider account needed — reuses the Google login.
 *   2. Resend (https://resend.com) — if RESEND_API_KEY + ALERT_FROM_EMAIL are set.
 *
 * If neither is available the endpoint returns 503 with a clear setup hint
 * (the UI surfaces it inline) — never silently no-ops.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import nodemailer from "nodemailer";

interface CriticalCampaign {
  name: string;
  objective?: string;
  budget: number;
  spend: number;
  spendPct: number;
  currency: string;
  status: string; // e.g. "Overspending" / "Near cap" / "Underspending"
}

interface AlertRequest {
  recipient: string;
  periodLabel?: string;
  campaigns: CriticalCampaign[];
}

interface AlertResponse {
  sent: boolean;
  provider?: "resend" | "webhook" | "smtp";
  id?: string;
  error?: string;
}

/**
 * Self-contained send via SMTP (nodemailer). Uses a Gmail App Password — no
 * third-party service, no OAuth verification. Configure:
 *   SMTP_USER=you@gmail.com          (your Gmail address; also the From)
 *   SMTP_PASS=xxxxxxxxxxxxxxxx        (16-char Gmail App Password, 2FA required)
 *   SMTP_HOST=smtp.gmail.com          (optional; defaults to Gmail)
 *   SMTP_PORT=465                     (optional; 465 SSL / 587 TLS)
 */
async function sendViaSmtp(to: string, subject: string, html: string, text: string): Promise<void> {
  const user = process.env.SMTP_USER!;
  const pass = process.env.SMTP_PASS!;
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = Number(process.env.SMTP_PORT || 465);
  const transporter = nodemailer.createTransport({
    host, port, secure: port === 465,
    auth: { user, pass },
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM || user,
    to, subject, html, text,
  });
}

function fmt(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `$${Math.round(amount).toLocaleString()}`;
  }
}

function buildHtml(req: AlertRequest): { subject: string; html: string; text: string } {
  const n = req.campaigns.length;
  const period = req.periodLabel ? ` (${req.periodLabel})` : "";
  const subject = `🚨 ${n} campaign${n === 1 ? "" : "s"} need attention — Budget Alert${period}`;

  const rowsHtml = req.campaigns
    .map(
      (c) => `
      <tr style="border-bottom:1px solid #eee;">
        <td style="padding:10px 12px;font-family:monospace;font-size:13px;">${escape(c.name)}</td>
        <td style="padding:10px 12px;font-size:13px;color:#555;">${escape(c.objective || "—")}</td>
        <td style="padding:10px 12px;font-size:13px;text-align:right;">${fmt(c.budget, c.currency)}</td>
        <td style="padding:10px 12px;font-size:13px;text-align:right;">${fmt(c.spend, c.currency)}</td>
        <td style="padding:10px 12px;font-size:13px;text-align:right;font-weight:600;">${Math.round(c.spendPct)}%</td>
        <td style="padding:10px 12px;font-size:12px;color:#b91c1c;font-weight:600;">${escape(c.status)}</td>
      </tr>`
    )
    .join("");

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111;">
    <div style="max-width:680px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
      <div style="padding:24px 28px;border-bottom:1px solid #f3f4f6;">
        <h1 style="margin:0;font-size:20px;color:#111;">🚨 Budget Alert${period}</h1>
        <p style="margin:6px 0 0 0;color:#555;font-size:14px;">${n} campaign${n === 1 ? " is" : "s are"} flagged critical and need immediate attention.</p>
      </div>
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr style="background:#f9fafb;text-align:left;">
          <th style="padding:10px 12px;font-size:12px;color:#555;font-weight:600;">Campaign</th>
          <th style="padding:10px 12px;font-size:12px;color:#555;font-weight:600;">Objective</th>
          <th style="padding:10px 12px;font-size:12px;color:#555;font-weight:600;text-align:right;">Budget</th>
          <th style="padding:10px 12px;font-size:12px;color:#555;font-weight:600;text-align:right;">Spend</th>
          <th style="padding:10px 12px;font-size:12px;color:#555;font-weight:600;text-align:right;">Spend %</th>
          <th style="padding:10px 12px;font-size:12px;color:#555;font-weight:600;">Status</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <div style="padding:20px 28px;color:#6b7280;font-size:12px;background:#f9fafb;border-top:1px solid #f3f4f6;">
        Open the Auditor dashboard to drill into each campaign and take action.
      </div>
    </div>
  </body></html>`;

  const text =
    `Budget Alert${period}\n` +
    `${n} campaign(s) need attention.\n\n` +
    req.campaigns
      .map(
        (c) =>
          `- ${c.name} (${c.objective || "—"}) — Budget ${fmt(c.budget, c.currency)} / Spend ${fmt(
            c.spend,
            c.currency
          )} = ${Math.round(c.spendPct)}% — ${c.status}`
      )
      .join("\n");

  return { subject, html, text };
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"
  );
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AlertResponse>
) {
  if (req.method !== "POST") {
    res.status(405).json({ sent: false, error: "Method not allowed" });
    return;
  }

  const body = req.body as AlertRequest;
  if (!body?.recipient || !Array.isArray(body.campaigns) || body.campaigns.length === 0) {
    res.status(400).json({ sent: false, error: "Missing recipient or campaigns[]" });
    return;
  }

  const { subject, html, text } = buildHtml(body);

  // 1. Self-contained: SMTP via nodemailer (Gmail App Password). No third-party
  //    service, no OAuth verification — the app sends the email itself.
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      await sendViaSmtp(body.recipient, subject, html, text);
      res.status(200).json({ sent: true, provider: "smtp" });
      return;
    } catch (e) {
      const smtpErr = e instanceof Error ? e.message : String(e);
      // Fall through to webhook/Resend if configured; else report the SMTP error.
      if (!process.env.ALERT_WEBHOOK_URL && !process.env.RESEND_API_KEY) {
        res.status(502).json({ sent: false, error: `SMTP send failed: ${smtpErr}. Check SMTP_USER / SMTP_PASS (Gmail App Password).` });
        return;
      }
    }
  }

  // 2. Optional: n8n (or any) webhook — POST the alert payload; the workflow
  //    sends it via Gmail/SMTP/etc.
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (webhookUrl) {
    try {
      const r = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: body.recipient,
          subject, html, text,
          periodLabel: body.periodLabel,
          campaigns: body.campaigns,
        }),
      });
      if (r.ok) {
        res.status(200).json({ sent: true, provider: "webhook" });
        return;
      }
      // Non-2xx from the webhook — fall through to Resend if configured.
      if (!process.env.RESEND_API_KEY) {
        res.status(502).json({ sent: false, error: `Alert webhook returned HTTP ${r.status}. Check the n8n workflow.` });
        return;
      }
    } catch (e) {
      if (!process.env.RESEND_API_KEY) {
        res.status(502).json({ sent: false, error: `Alert webhook failed: ${e instanceof Error ? e.message : String(e)}` });
        return;
      }
    }
  }

  // 2. Fallback: Resend (send from your own verified domain).
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.ALERT_FROM_EMAIL;
  if (!apiKey || !fromEmail) {
    res.status(503).json({
      sent: false,
      error:
        "Email alerts not configured. Set SMTP_USER + SMTP_PASS (Gmail App Password) — or ALERT_WEBHOOK_URL, or RESEND_API_KEY + ALERT_FROM_EMAIL — in the environment and restart.",
    });
    return;
  }

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [body.recipient],
        subject,
        html,
        text,
      }),
    });
    const data = (await r.json()) as { id?: string; message?: string; name?: string };
    if (!r.ok) {
      res.status(502).json({
        sent: false,
        error: data?.message || data?.name || `Resend HTTP ${r.status}`,
      });
      return;
    }
    res.status(200).json({ sent: true, provider: "resend", id: data.id });
  } catch (e) {
    res.status(502).json({ sent: false, error: e instanceof Error ? e.message : String(e) });
  }
}
