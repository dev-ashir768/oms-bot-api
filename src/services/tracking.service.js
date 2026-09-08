import { createLogger } from "../utils/logger.js";
import { config } from "../config/env.js";
const log = createLogger("tracking");
function extractConsignmentNumber(message) {
  const cleaned = message.replace(/["""''`]/g, "").replace(/\s+/g, " ");
  const patterns = [
    /\b([A-Z]{2,5}\d{6,20})\b/i,
    /\b(\d{10,20})\b/,
    /\b([A-Z0-9]{2,5}-[A-Z0-9]{4,20})\b/i,
    /\b(\d{4}-\d{4}-\d{4,})\b/,
    /\b([A-Z]\d{9,15})\b/i,
    /\b(\d{6,9}[A-Z]{1,3})\b/i
  ];
  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match) return match[1].toUpperCase();
  }
  return null;
}
function isTrackingQuery(message) {
  const lower = message.toLowerCase().replace(/[^\w\s]/g, " ");
  const trackingKeywords = [
    "track",
    "tracking",
    "parcel",
    "shipment",
    "courier",
    "consignment",
    "cn number",
    "cn no",
    "order track",
    "delivery status",
    "delivery update",
    "where is my",
    "track my",
    "check my",
    "find my",
    "mera order",
    "mera parcel",
    "meri shipment",
    "meri delivery",
    "kahan hai",
    "kahan ha",
    "kaha hai",
    "kaha ha",
    "kidhar hai",
    "kidhar ha",
    "kidhr hai",
    "kidhr ha",
    "parcel kab",
    "order kab",
    "kab deliver",
    "kab aye ga",
    "kab ayega",
    "konsa status",
    "kya status"
  ];
  const hasKeyword = trackingKeywords.some((k) => lower.includes(k));
  const hasCN = extractConsignmentNumber(message) !== null;
  if (hasKeyword && hasCN) return true;
  const trimmed = message.trim();
  if (hasCN && trimmed.replace(/[\s\-]/g, "").length <= 25) return true;
  return false;
}
async function fetchWithRetry(cn, retries = 2) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8e3);
      const res = await fetch(config.trackingApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consignment_number: cn }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      log.warn(`Tracking API attempt ${attempt}/${retries} failed`, {
        cn,
        error: err?.message
      });
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("All retries exhausted");
}
async function trackConsignment(cn) {
  const start = Date.now();
  log.info(`Tracking consignment`, { cn });
  try {
    const data = await fetchWithRetry(cn);
    log.info(`Tracking API response`, { cn, status: data.status, duration: Date.now() - start });
    if (data.status === 0 || !data.payload || Array.isArray(data.payload) && data.payload.length === 0) {
      return [
        `Consignment number "${cn}" se koi shipment record nahi mila.`,
        ``,
        `Yeh check karein:`,
        `- Kya CN number bilkul sahi hai?`,
        `- Agar abhi order diya hai to thori der baad try karein.`,
        ``,
        `Mazeed madad ke liye hamari team se rabta karein:`,
        `- WhatsApp: 0318-0268894`,
        `- Email: info@getorio.com`,
        `- Phone: 021-37293292`
      ].join("\n");
    }
    const payload = Array.isArray(data.payload) ? data.payload[0] : data.payload;
    const details = payload.tracking_details || [];
    const latest = details[0];
    const lines = [
      `\u{1F4E6} **Tracking Details**`,
      ``,
      `**Courier:** ${payload.courier}`,
      `**CN Number:** ${payload.consignment_number}`,
      `**Current Status:** ${latest?.status || "Processing"}`,
      `**Last Updated:** ${latest?.dateTime || "N/A"}`
    ];
    if (details.length > 1) {
      lines.push(``, `**Tracking History:**`);
      const shown = details.slice(0, 5);
      for (const d of shown) {
        lines.push(`\u2022 ${d.dateTime} \u2014 ${d.status}`);
      }
      if (details.length > 5) {
        lines.push(`\u2022 ... aur ${details.length - 5} purani updates`);
      }
    }
    lines.push(
      ``,
      `Koi aur sawaal ho to poochein! \u{1F60A}`
    );
    return lines.join("\n");
  } catch (err) {
    log.error(`Tracking API failed`, { cn, duration: Date.now() - start, error: err });
    return [
      `Abhi tracking system se response lene mein thora waqt lag raha hai.`,
      `Please 1-2 minute baad dobara try karein.`,
      ``,
      `Ya hamari team se direct rabta karein:`,
      `- WhatsApp: 0318-0268894`,
      `- Phone: 021-37293292`,
      `- Email: info@getorio.com`
    ].join("\n");
  }
}
export {
  extractConsignmentNumber,
  isTrackingQuery,
  trackConsignment
};

//# sourceMappingURL=tracking.service.js.map
