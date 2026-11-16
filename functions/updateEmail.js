// ---------------------------------------------------------------------------
// The VOX London update email — ONE template, used twice:
//   functions/updateEmail.js  (what is actually sent)
//   js/updateEmail.js         (the live preview in the editor)
// The two files are identical copies. Change one, copy it over the other, so
// the preview never lies about what people receive.
//
// No imports and no DOM, so it runs the same in Node and the browser.
// Table layout and inline styles throughout, because Outlook.
//
// The body is a small, safe markdown:
//   ## Heading           - bullet            **bold**          [text](https://…)
//   ![caption](https://…)  on its own line = a photo
//   - 10.00: Something     a list where every line starts with a time = a timetable
//   "With kind regards," … as the last paragraph = a signature
// ---------------------------------------------------------------------------

const C = {
  grey: "#3c3c3c", brick: "#f28d65", ink: "#2b2b2b", body: "#3c3c3c", muted: "#6b6b6b",
  wash: "#f2f2f2", line: "#e6e6e6", tint: "#fdf1ec"
};
const FONT = "'Barlow', Arial, Helvetica, sans-serif";
const LOGO = "https://voxlondon.uk/assets/logo.png";
const ADDRESS = "VOX London Office Ltd · 128 City Road, London EC1V 2NX";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const IMG = /^!\[([^\]]*)\]\((https:\/\/[^)\s]+)\)$/;
const TIME = /^(\d{1,2}[.:]\d{2})\s*[:–—-]\s*(.+)$/;
const SIGN = /^(with )?(kind |best |warm )?(regards|wishes)|^(many )?thanks|^best,?$/i;

function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, `<strong style="color:${C.ink};">$1</strong>`)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      `<a href="$2" style="color:${C.grey};text-decoration:underline;text-decoration-color:${C.brick};">$1</a>`);
}

const P = `margin:0 0 18px;font-family:${FONT};font-size:16px;line-height:1.65;color:${C.body};`;

function heading(text) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:30px 0 12px;"><tr><td>
    <div style="width:36px;height:4px;background:${C.brick};margin:0 0 12px;font-size:0;line-height:0;">&nbsp;</div>
    <h2 style="margin:0;font-family:${FONT};font-size:20px;line-height:1.3;font-weight:bold;color:${C.ink};">${inline(text)}</h2>
  </td></tr></table>`;
}

function bullets(items) {
  const row = (t) => `<tr>
      <td valign="top" width="18" style="padding:0 0 9px;font-family:${FONT};font-size:16px;line-height:1.55;color:${C.brick};">&#9632;</td>
      <td valign="top" style="padding:0 0 9px;font-family:${FONT};font-size:16px;line-height:1.55;color:${C.body};">${inline(t)}</td></tr>`;
  const short = items.length >= 6 && items.every(t => t.length <= 38);
  if (!short) {
    return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 14px;">${items.map(row).join("")}</table>`;
  }
  // A long list of short names reads better in two columns.
  const half = Math.ceil(items.length / 2);
  const col = (list) => `<table role="presentation" cellpadding="0" cellspacing="0" width="100%">${list.map(row).join("")}</table>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 14px;"><tr>
      <td class="col" valign="top" width="50%" style="padding-right:10px;">${col(items.slice(0, half))}</td>
      <td class="col" valign="top" width="50%" style="padding-left:10px;">${col(items.slice(half))}</td></tr></table>`;
}

function timetable(items) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%"
      style="margin:4px 0 20px;border-top:1px solid ${C.line};">${items.map(t => {
        const [, time, what] = t.match(TIME);
        return `<tr>
          <td valign="top" width="70" style="padding:11px 0;border-bottom:1px solid ${C.line};font-family:${FONT};font-size:15px;line-height:1.5;font-weight:bold;color:${C.brick};">${esc(time.replace(":", "."))}</td>
          <td valign="top" style="padding:11px 0;border-bottom:1px solid ${C.line};font-family:${FONT};font-size:15px;line-height:1.5;color:${C.body};">${inline(what)}</td></tr>`;
      }).join("")}</table>`;
}

function photo(alt, url) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:6px 0 22px;"><tr><td>
    <img src="${esc(url)}" alt="${esc(alt)}" width="520" style="display:block;width:100%;max-width:520px;height:auto;border:0;border-radius:6px;">
    ${alt ? `<div style="font-family:${FONT};font-size:13px;line-height:1.5;color:${C.muted};margin-top:8px;">${esc(alt)}</div>` : ""}
  </td></tr></table>`;
}

function signature(lines) {
  const [greet, name, ...rest] = lines;
  return `<p style="${P}margin-top:28px;">${inline(greet)}${name ? `<br><strong style="color:${C.ink};">${inline(name)}</strong>` : ""}${
    rest.length ? `<br><span style="font-size:14px;color:${C.muted};">${rest.map(inline).join("<br>")}</span>` : ""}</p>`;
}

export function mdToHtml(text) {
  const blocks = String(text || "").replace(/\r/g, "").split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  const out = [];
  blocks.forEach((b, i) => {
    let lines = b.split("\n").map(l => l.trimEnd());
    // A heading may have its text straight underneath, with no blank line.
    if (lines[0].startsWith("## ")) {
      out.push(heading(lines[0].slice(3)));
      lines = lines.slice(1);
      if (!lines.length) return;
    }
    const isList = lines.every(l => /^\s*[-•]\s+/.test(l));
    const items = isList ? lines.map(l => l.replace(/^\s*[-•]\s+/, "")) : [];
    if (lines.every(l => IMG.test(l.trim()))) {
      lines.forEach(l => { const [, alt, url] = l.trim().match(IMG); out.push(photo(alt, url)); });
    } else if (isList && items.every(t => TIME.test(t))) {
      out.push(timetable(items));
    } else if (isList) {
      out.push(bullets(items));
    } else if (i === blocks.length - 1 && SIGN.test(lines[0]) && lines.length <= 5) {
      out.push(signature(lines));
    } else {
      out.push(`<p style="${P}">${lines.map(inline).join("<br>")}</p>`);
    }
  });
  return out.join("");
}

export function mdToText(text) {
  return String(text || "").replace(/\r/g, "")
    .replace(/^!\[([^\]]*)\]\((https:\/\/[^)\s]+)\)$/gm, "[Photo: $1] $2")
    .replace(/^## /gm, "").replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)")
    .replace(/^\s*[-•]\s+/gm, "• ");
}

export function renderUpdateEmail({ title, body, tag, dateText, ctaLabel, ctaHref, preheader }) {
  const eyebrow = [tag || "Update", dateText].filter(Boolean).join(" · ").toUpperCase();
  return `<!DOCTYPE html>
<html lang="en-GB"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  @media only screen and (max-width:620px) {
    .px { padding-left:24px !important; padding-right:24px !important; }
    .h1 { font-size:24px !important; }
    .col { display:block !important; width:100% !important; padding:0 !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.wash};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${esc(preheader || "")}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.wash};">
<tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border-collapse:collapse;">

    <tr><td class="px" style="background:${C.grey};padding:26px 40px 22px;">
      <img src="${LOGO}" alt="VOX London" width="150" style="display:block;width:150px;height:auto;border:0;">
    </td></tr>
    <tr><td style="background:${C.brick};height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>

    <tr><td class="px" style="padding:38px 40px 6px;">
      <div style="font-family:${FONT};font-size:12px;letter-spacing:2px;font-weight:bold;color:${C.brick};margin:0 0 10px;">${esc(eyebrow)}</div>
      <h1 class="h1" style="margin:0 0 22px;font-family:${FONT};font-size:29px;line-height:1.2;font-weight:bold;color:${C.ink};">${esc(title)}</h1>
      ${mdToHtml(body)}
    </td></tr>

    ${ctaHref ? `<tr><td class="px" style="padding:6px 40px 40px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:${C.brick};border-radius:4px;">
        <a href="${esc(ctaHref)}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">${esc(ctaLabel || "Read it on the hub")} &rarr;</a>
      </td></tr></table>
    </td></tr>` : `<tr><td style="padding:0 40px 30px;"></td></tr>`}

    <tr><td class="px" style="background:${C.grey};padding:26px 40px;">
      <p style="margin:0 0 8px;font-family:${FONT};font-size:13px;line-height:1.6;color:#ffffff;font-weight:bold;letter-spacing:1px;">VOX LONDON</p>
      <p style="margin:0 0 10px;font-family:${FONT};font-size:12px;line-height:1.6;color:rgba(255,255,255,0.7);">
        A charity-led workspace for London's civil society.<br>${ADDRESS}</p>
      <p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:rgba(255,255,255,0.55);">
        You are receiving this because your organisation is part of the VOX London founding group.
        If you would rather not receive these updates, just reply and let us know.</p>
    </td></tr>

  </table>
</td></tr></table>
</body></html>`;
}
