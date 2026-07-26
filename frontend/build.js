// Generates public/config.js from the RELAY_URL env var so the static frontend
// knows where the Cloud Run relay lives. Runs during `vercel build`.
const fs = require("fs");
const relay = process.env.RELAY_URL || "";
if (!relay) {
  console.warn("[build] RELAY_URL not set — frontend will fall back to same-origin io().");
}
const out = `// AUTO-GENERATED at build time. Do not edit.
window.RELAY_URL = ${JSON.stringify(relay)};
`;
fs.writeFileSync("public/config.js", out);
console.log("[build] wrote public/config.js ->", relay || "(empty)");
