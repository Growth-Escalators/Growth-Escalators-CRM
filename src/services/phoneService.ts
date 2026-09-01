import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

/**
 * Phone parsing for outbound WhatsApp.
 *
 * WHY THIS IS SEPARATE FROM contactService.normalizeChannelValue():
 * `normalizeChannelValue` is the dedup key for every contact-write path in the
 * CRM (cashfree, wizmatch, facebookLeadForms, agency leads). Every historical
 * row in contact_channels was written with its rule — strip non-digits, prefix
 * `91` unless the value already starts with `91`. Changing that rule would
 * fragment dedup against all existing data, so it stays exactly as it is.
 *
 * This module is the *sending* rule. It answers a different question: "is this
 * a real, dialable number, and what is its E.164 form?" It is used to validate
 * inbound leads and to build the WhatsApp `to` value. The E.164 result is
 * stored alongside the lead (lead_submissions.phone_e164) rather than replacing
 * the channel value.
 *
 * Region defaulting follows the brief: we only assume India when the caller
 * explicitly says the form targets India. An ambiguous international number
 * with no country code is rejected, never guessed.
 */

export type PhoneParseResult =
  | { ok: true; e164: string; digits: string; country: string | undefined }
  | { ok: false; reason: 'empty' | 'unparseable' | 'invalid' | 'ambiguous_no_region' };

/**
 * Parse a submitted phone number to E.164.
 *
 * @param raw          Whatever the visitor typed.
 * @param regionHint   ISO-3166 alpha-2 (e.g. 'IN'). Pass ONLY when the form is
 *                     known to target that country. Omit for international
 *                     forms so a bare national number is rejected rather than
 *                     silently assigned a country.
 */
export function parsePhone(raw: string, regionHint?: string): PhoneParseResult {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { ok: false, reason: 'empty' };

  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return { ok: false, reason: 'unparseable' };

  // 1. Explicit international form always wins — no guessing needed.
  if (hasPlus) {
    const parsed = parsePhoneNumberFromString(`+${digits}`);
    if (parsed?.isValid()) {
      return { ok: true, e164: parsed.number, digits, country: parsed.country };
    }
    return { ok: false, reason: 'invalid' };
  }

  // 2. With a region hint, try it as a national number first. This is the
  //    common case: an Indian visitor typing "9876543210" on an India form.
  if (regionHint) {
    const national = parsePhoneNumberFromString(trimmed, regionHint as CountryCode);
    if (national?.isValid()) {
      return { ok: true, e164: national.number, digits, country: national.country };
    }
  }

  // 3. No plus, but the digits may already carry a country code
  //    ("919876543210", "12025550123"). Try them as international.
  const asInternational = parsePhoneNumberFromString(`+${digits}`);
  if (asInternational?.isValid()) {
    return { ok: true, e164: asInternational.number, digits, country: asInternational.country };
  }

  // 4. Nothing worked. If we had no region to lean on, say so explicitly —
  //    the caller may want to surface "include your country code" to the user.
  if (!regionHint) return { ok: false, reason: 'ambiguous_no_region' };
  return { ok: false, reason: 'invalid' };
}

/**
 * WhatsApp Cloud API `to` value: E.164 without the leading `+`.
 */
export function toWhatsAppAddress(e164: string): string {
  return e164.replace(/^\+/, '');
}

/**
 * Log-safe rendering of a phone number. Never put a full number in logs.
 * `+919876543210` -> `+91******3210`
 */
export function redactPhone(value: string | null | undefined): string {
  if (!value) return '(none)';
  const s = String(value);
  if (s.length <= 6) return '*'.repeat(s.length);
  const keepFront = s.startsWith('+') ? 3 : 2;
  return `${s.slice(0, keepFront)}${'*'.repeat(Math.max(0, s.length - keepFront - 4))}${s.slice(-4)}`;
}
