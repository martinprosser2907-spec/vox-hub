// ---------------------------------------------------------------------------
// Branded email. One wrapper, used by everything, so no message can drift out
// of house style. Table layout and inline styles because Outlook.
//
// Adapted from the Calla employee portal's wrapEmail().
// ---------------------------------------------------------------------------
import { Resend } from "resend";
import { BRAND } from "./brand.js";

let client = null;
// Constructed lazily: the Resend constructor throws if the key is missing,
// which would take the whole function down at load rather than at send.
function resend() {
  if (!client) client = new Resend(process.env.RESEND_API_KEY);
  return client;
}

// Anything that came from a person gets escaped before it goes near the HTML.
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function wrapEmail({ title, bodyHtml, ctaLabel, ctaHref, preheader }) {
  return `<!DOCTYPE html>
<html lang="en-GB"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background:${BRAND.wash};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${esc(preheader || "")}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.wash};">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0"
         style="width:600px;max-width:600px;background:${BRAND.paper};border-collapse:collapse;">

    <tr><td style="background:${BRAND.grey};padding:26px 40px;">
      <span style="font-family:Arial,Helvetica,sans-serif;font-size:21px;font-weight:bold;
                   letter-spacing:3px;color:#ffffff;">${BRAND.wordmark}</span>
      <span style="font-family:Arial,Helvetica,sans-serif;font-size:14px;
                   letter-spacing:2px;color:${BRAND.brick};padding-left:10px;">LONDON</span>
    </td></tr>

    <tr><td style="padding:40px 40px 8px;">
      <h1 style="margin:0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:25px;
                 line-height:1.25;font-weight:normal;color:${BRAND.ink};">${esc(title)}</h1>
      ${bodyHtml}
    </td></tr>

    ${ctaHref ? `<tr><td style="padding:12px 40px 34px;">
      <a href="${esc(ctaHref)}" style="display:inline-block;background:${BRAND.brick};color:#ffffff;
         font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;
         padding:13px 26px;border-radius:4px;">${esc(ctaLabel || "Open the hub")}</a>
    </td></tr>` : `<tr><td style="padding:0 40px 34px;"></td></tr>`}

    <tr><td style="background:${BRAND.grey};padding:20px 40px;">
      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;
                color:rgba(255,255,255,0.6);">
        ${BRAND.product} &middot; you are receiving this because your organisation is part of
        the VOX London founding group. Questions: ${BRAND.support}
      </p>
    </td></tr>

  </table>
</td></tr></table>
</body></html>`;
}

export async function sendSignInCode({ to, code, name }) {
  const body = `
    <p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;
              line-height:1.7;color:${BRAND.ink};">
      ${name ? esc(name.split(" ")[0]) + ", h" : "H"}ere is your sign-in code for the ${BRAND.product}.
    </p>
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:38px;font-weight:bold;
                letter-spacing:0.14em;color:${BRAND.ink};background:${BRAND.brick25};
                padding:20px 24px;border-radius:4px;text-align:center;margin:0 0 20px;">${esc(code)}</div>
    <p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;
              line-height:1.7;color:${BRAND.muted};">
      Type it into the sign-in screen. It is good for ten minutes and can only be used once.
    </p>
    <p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:13.5px;
              line-height:1.6;color:${BRAND.muted};">
      If you did not ask to sign in, you can ignore this — nobody can get in without the code.
    </p>`;

  const res = await resend().emails.send({
    from: BRAND.from,
    to,
    // The code goes in the subject so it can be read from a lock screen
    // without opening anything.
    subject: `${code} is your ${BRAND.product} sign-in code`,
    html: wrapEmail({
      title: "Your sign-in code",
      bodyHtml: body,
      preheader: `${code} — good for ten minutes.`
    })
  });

  // The Resend SDK does NOT throw on an API error — it resolves with
  // { data: null, error: {...} }. A try/catch around this call therefore
  // catches nothing, and a refused send looks exactly like a successful one.
  // Check the error field explicitly, or you will sit watching an empty inbox.
  if (res?.error) {
    const e = res.error;
    throw new Error(`Resend refused the send: ${e.name || ""} ${e.message || JSON.stringify(e)}`);
  }
  return res;
}
