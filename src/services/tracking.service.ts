import { createLogger } from "../utils/logger.js";
import { config } from "../config/env.js";

const log = createLogger("tracking");

interface TrackingDetail {
  dateTime: string;
  status: string;
}

interface TrackingPayload {
  courier_id: number;
  courier: string;
  consignment_number: string;
  tracking_details: TrackingDetail[];
}

interface TrackingResponse {
  status: number;
  message: string;
  payload: TrackingPayload | TrackingPayload[] | [];
}

export function extractConsignmentNumber(message: string): string | null {
  // Check explicit labels like "cn: 12345", "cn# 12345", "consignment: 12345", "tracking: 12345"
  const explicitMatch = message.match(
    /\b(?:cn|consignment(?:\s*no|\s*number)?|tracking(?:\s*no|\s*number|\s*id)?)\s*[:#=\-]?\s*([A-Z0-9\-]{6,25})\b/i
  );
  if (explicitMatch && explicitMatch[1]) {
    const raw = explicitMatch[1].replace(/^-+|-+$/g, "");
    if (raw.length >= 6 && /\d/.test(raw)) {
      return raw.toUpperCase();
    }
  }

  const cleaned = message.replace(/["""''`]/g, "").replace(/\s+/g, " ");

  const patterns = [
    /\b([A-Z]{2,5}\d{6,20})\b/i,
    /\b(\d{10,20})\b/,
    /\b([A-Z0-9]{2,5}-[A-Z0-9]{4,20})\b/i,
    /\b(\d{4}-\d{4}-\d{4,})\b/,
    /\b([A-Z]\d{9,15})\b/i,
    /\b(\d{6,9}[A-Z]{1,3})\b/i,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match) {
      let result = match[1].toUpperCase();
      if (result.startsWith("CN-") && result.length > 5) {
        result = result.substring(3);
      }
      return result;
    }
  }

  return null;
}

export function isTrackingQuery(message: string): boolean {
  const hasCN = extractConsignmentNumber(message) !== null;
  if (!hasCN) return false;

  const trimmed = message.trim();

  // If the message is short and has a CN (e.g. "KI7539148668", "CN: KI7539148668", "track KI7539148668")
  if (trimmed.length <= 40) {
    return true;
  }

  const lower = message.toLowerCase();

  // Words that strongly indicate tracking intent when a CN is present
  const trackingWordsRegex =
    /\b(cn|c\/n|track|tracking|tracked|trace|status|check|parcel|shipment|courier|consignment|delivery|deliver|delivered|order|update|updates|history|detail|details|info|location|kahan|kaha|kidhar|kidhr|kab|pohanch|pohancho|pahunch|pahuncha|pohncha|batao|batau|batayein|bataen|dikhao|dikhado|dikhayein|search|find|where)\b/i;

  if (trackingWordsRegex.test(lower)) {
    return true;
  }

  const trackingPhrases = [
    "mera order", "mera parcel", "meri shipment", "meri delivery",
    "kahan hai", "kahan ha", "kaha hai", "kaha ha",
    "kidhar hai", "kidhar ha", "kidhr hai", "kidhr ha",
    "parcel kab", "order kab", "kab deliver", "kab aye ga", "kab ayega",
    "konsa status", "kya status", "ka status",
  ];

  return trackingPhrases.some((phrase) => lower.includes(phrase));
}

async function fetchWithRetry(cn: string, retries = 2): Promise<TrackingResponse> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(config.trackingApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consignment_number: cn }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      return await res.json();
    } catch (err: any) {
      log.warn(`Tracking API attempt ${attempt}/${retries} failed`, {
        cn,
        error: err?.message,
      });

      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  throw new Error("All retries exhausted");
}

export async function trackConsignment(cn: string): Promise<string> {
  const start = Date.now();
  log.info(`Tracking consignment`, { cn });

  try {
    const data = await fetchWithRetry(cn);
    log.info(`Tracking API response`, { cn, status: data.status, duration: Date.now() - start });

    if (
      data.status === 0 ||
      !data.payload ||
      (Array.isArray(data.payload) && data.payload.length === 0)
    ) {
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
        `- Phone: 021-37293292`,
      ].join("\n");
    }

    const payload = Array.isArray(data.payload) ? data.payload[0] : data.payload;
    const details = payload.tracking_details || [];
    const latest = details[0];

    const lines: string[] = [
      `📦 **Tracking Details**`,
      ``,
      `**Courier:** ${payload.courier || "N/A"}`,
      `**CN Number:** ${payload.consignment_number || cn}`,
      `**Current Status:** ${latest?.status || "Processing"}`,
      `**Last Updated:** ${latest?.dateTime || "N/A"}`,
    ];

    if (latest?.status && /no record found/i.test(latest.status)) {
      lines.push(
        ``,
        `⚠️ *Courier system par is CN ka record abhi update nahi hua. Agar shipment abhi book hui hai to thori der baad dobara check karein, ya CN number verify kar lein.*`
      );
    }

    if (details.length > 1) {
      lines.push(``, `**Tracking History:**`);
      const shown = details.slice(0, 5);
      for (const d of shown) {
        lines.push(`• ${d.dateTime} — ${d.status}`);
      }
      if (details.length > 5) {
        lines.push(`• ... aur ${details.length - 5} purani updates`);
      }
    }

    return lines.join("\n");
  } catch (err) {
    log.error(`Tracking API failed`, { cn, duration: Date.now() - start, error: err });
    return [
      `We are currently experiencing a slight delay retrieving tracking details.`,
      `Please try again in 1-2 minutes.`,
      ``,
      `Or reach out to our support team directly:`,
      `- WhatsApp: 0318-0268894`,
      `- Phone: 021-37293292`,
      `- Email: info@getorio.com`,
    ].join("\n");
  }
}
