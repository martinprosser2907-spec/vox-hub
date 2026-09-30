// ---------------------------------------------------------------------------
// One place for everything that says VOX. Change it here and it changes in the
// sign-in email, the help assistant's manner, and anything added later.
// ---------------------------------------------------------------------------

export const BRAND = {
  name:      "VOX London",
  product:   "VOX London Hub",

  // VOX palette. Grey is the ground, brick is the accent. VOX is always capitals.
  grey:      "#3c3c3c",
  brick:     "#f28d65",
  brick25:   "#fce2d9",
  ink:       "#1c1c1c",
  paper:     "#ffffff",
  wash:      "#f6f6f6",
  line:      "#d2d2d2",
  muted:     "#646464",

  hubUrl:    process.env.VOX_HUB_URL    || "https://voxlondon.uk",
  // Needs voxlondon.uk verified in Resend first — until then this bounces,
  // so keep the env override handy while DNS propagates.
  from:      process.env.VOX_FROM_EMAIL || "VOX London <hub@voxlondon.uk>",
  support:   "martin@voxhouses.global",

  // The logo is drawn as text rather than fetched, so the email needs no
  // external image and cannot break if a file moves.
  wordmark:  "VOX"
};
