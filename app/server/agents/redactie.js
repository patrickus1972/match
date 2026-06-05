// Redactie layer — strips PII before sending text to LLM.
// Implements FO §4.8: anonimisering bij verkennen en extractie.
//
// Direct identificerende gegevens worden vervangen door tokens:
// - BSN → [BSN-REDACTED]
// - Namen → [NAAM-REDACTED]
// - Volledig postcode → eerste 4 cijfers behouden
// - Telefoonnummers → [TEL-REDACTED]
// - E-mailadressen → [EMAIL-REDACTED]
// - Geboortedata → leeftijd (indien berekenbaar)

import { validateBSN } from './completeness.js';

// ============ PII PATTERNS ============

const PII_PATTERNS = {
  // BSN: 9 consecutive digits (may have dots/dashes/spaces)
  bsn: /\b(\d[\s.-]?){8}\d\b/g,

  // Dutch phone numbers: 06-xxx, 0xx-xxx, +31xxx
  phone: /(?:\+31|0)[1-9][\d\s\-().]{7,12}/g,

  // Email addresses
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,

  // Full Dutch postcodes: 1234AB or 1234 AB
  postcode_full: /\b(\d{4})\s?([A-Z]{2})\b/gi,

  // Dates in various formats: dd-mm-yyyy, dd/mm/yyyy, yyyy-mm-dd
  date_dmy: /\b(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\b/g,
  date_ymd: /\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/g,

  // Names following salutations
  name_salutation: /\b((?:mevrouw|mevr\.?|de heer|dhr\.?|meneer|mw\.?|hr\.?)\s+)([A-Z][a-zéèëïöüá]+(?:\s+(?:van\s+(?:de|den|der)?|de|ten|ter)?\s*[A-Z][a-zéèëïöüá]+)*)/gi,

  // Names in "Patient: Name" or "Cliënt: Name" patterns
  name_label: /\b((?:pati[eë]nt|cli[eë]nt|naam|name|betreft)\s*[:]\s*)([A-Z][a-zéèëïöüá]+(?:\s+(?:van\s+(?:de|den|der)?|de|ten|ter)?\s*[A-Z][a-zéèëïöüá]+)*)/gi,

  // Initials patterns: J.K. or J. K. Jansen
  initials: /\b([A-Z]\.\s*)+([A-Z][a-z]+)\b/g,

  // Bank account numbers (IBAN)
  iban: /\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}([A-Z0-9]?){0,16}\b/g,

  // Address patterns: street + number
  address: /\b([A-Z][a-z]+(?:straat|laan|weg|plein|singel|kade|gracht|dreef|hof|pad|steeg))\s+(\d+[a-z]?(?:\s*[-/]\s*\d+)?)\b/gi
};

// ============ REDACTION FUNCTIONS ============

/**
 * Check if a 9-digit sequence is a valid BSN using elfproef
 */
function isValidBSN(digits) {
  const clean = digits.replace(/[\s.-]/g, '');
  if (!/^\d{9}$/.test(clean)) return false;
  return validateBSN(clean).valid;
}

/**
 * Convert a birth date to age (for redaction purposes)
 */
function dateToAge(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const monthDiff = now.getMonth() - d.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < d.getDate())) {
    age--;
  }
  return age >= 0 && age < 120 ? age : null;
}

/**
 * Parse Dutch date formats to ISO
 */
function parseDutchDate(match, g1, g2, g3) {
  // Try dd-mm-yyyy
  const day = parseInt(g1, 10);
  const month = parseInt(g2, 10);
  let year = parseInt(g3, 10);
  if (year < 100) year += year > 30 ? 1900 : 2000;
  if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
    return new Date(year, month - 1, day);
  }
  return null;
}

// ============ MAIN REDACTION FUNCTION ============

/**
 * Redact PII from text before sending to LLM
 * @param {string} text - Raw referral text
 * @param {object} options - Redaction options
 * @returns {{ text: string, warnings: array, stats: object }}
 */
export function redact(text, options = {}) {
  const {
    redactBSN = true,
    redactPhone = true,
    redactEmail = true,
    reducePostcode = true,
    redactNames = true,
    redactDates = true,
    redactAddress = true,
    redactIBAN = true,
    warnOnHighConfidencePII = true
  } = options;

  let result = text;
  const warnings = [];
  const stats = {
    bsn: 0,
    phone: 0,
    email: 0,
    postcode: 0,
    name: 0,
    date: 0,
    address: 0,
    iban: 0
  };

  // 1. BSN redaction (with elfproef validation)
  if (redactBSN) {
    result = result.replace(PII_PATTERNS.bsn, (match) => {
      if (isValidBSN(match)) {
        stats.bsn++;
        if (warnOnHighConfidencePII) {
          warnings.push({ type: 'bsn', original: match, confidence: 'high' });
        }
        return '[BSN-REDACTED]';
      }
      return match; // Not a valid BSN, leave as-is
    });
  }

  // 2. Phone number redaction
  if (redactPhone) {
    result = result.replace(PII_PATTERNS.phone, (match) => {
      stats.phone++;
      return '[TEL-REDACTED]';
    });
  }

  // 3. Email redaction
  if (redactEmail) {
    result = result.replace(PII_PATTERNS.email, (match) => {
      stats.email++;
      return '[EMAIL-REDACTED]';
    });
  }

  // 4. Postcode reduction (keep only first 4 digits)
  if (reducePostcode) {
    result = result.replace(PII_PATTERNS.postcode_full, (match, digits, letters) => {
      stats.postcode++;
      return digits; // Keep only the 4 digits, drop the letters
    });
  }

  // 5. Name redaction (salutations)
  if (redactNames) {
    result = result.replace(PII_PATTERNS.name_salutation, (match, salutation, name) => {
      stats.name++;
      return salutation + '[NAAM-REDACTED]';
    });

    result = result.replace(PII_PATTERNS.name_label, (match, label, name) => {
      stats.name++;
      return label + '[NAAM-REDACTED]';
    });
  }

  // 6. Birth date to age conversion
  if (redactDates) {
    // dd-mm-yyyy or dd/mm/yyyy
    result = result.replace(PII_PATTERNS.date_dmy, (match, day, month, year) => {
      const d = parseDutchDate(match, day, month, year);
      if (d) {
        const age = dateToAge(d);
        if (age !== null && age > 0 && age < 100) {
          stats.date++;
          return `[geb. ${age} jaar]`;
        }
      }
      return match; // Not a valid birth date, leave as-is
    });
  }

  // 7. Address redaction
  if (redactAddress) {
    result = result.replace(PII_PATTERNS.address, (match) => {
      stats.address++;
      return '[ADRES-REDACTED]';
    });
  }

  // 8. IBAN redaction
  if (redactIBAN) {
    result = result.replace(PII_PATTERNS.iban, (match) => {
      stats.iban++;
      return '[IBAN-REDACTED]';
    });
  }

  const totalRedacted = Object.values(stats).reduce((a, b) => a + b, 0);

  return {
    text: result,
    warnings,
    stats,
    totalRedacted,
    hadPII: totalRedacted > 0,
    hadHighConfidencePII: warnings.some(w => w.confidence === 'high')
  };
}

/**
 * Light redaction for exploration mode (less aggressive)
 * Only redacts BSN, phone, email, and reduces postcodes
 */
export function redactLight(text) {
  return redact(text, {
    redactBSN: true,
    redactPhone: true,
    redactEmail: true,
    reducePostcode: true,
    redactNames: false,
    redactDates: false,
    redactAddress: false,
    redactIBAN: true,
    warnOnHighConfidencePII: true
  });
}

/**
 * Full redaction for external LLM calls
 */
export function redactFull(text) {
  return redact(text, {
    redactBSN: true,
    redactPhone: true,
    redactEmail: true,
    reducePostcode: true,
    redactNames: true,
    redactDates: true,
    redactAddress: true,
    redactIBAN: true,
    warnOnHighConfidencePII: true
  });
}

/**
 * Check text for PII without redacting (for warnings)
 */
export function detectPII(text) {
  const detected = [];

  // Check BSN
  const bsnMatches = text.match(PII_PATTERNS.bsn) || [];
  for (const m of bsnMatches) {
    if (isValidBSN(m)) {
      detected.push({ type: 'bsn', value: m, confidence: 'high' });
    }
  }

  // Check phone
  const phoneMatches = text.match(PII_PATTERNS.phone) || [];
  for (const m of phoneMatches) {
    detected.push({ type: 'phone', value: m, confidence: 'medium' });
  }

  // Check email
  const emailMatches = text.match(PII_PATTERNS.email) || [];
  for (const m of emailMatches) {
    detected.push({ type: 'email', value: m, confidence: 'high' });
  }

  return {
    detected,
    hasPII: detected.length > 0,
    hasHighConfidencePII: detected.some(d => d.confidence === 'high')
  };
}
