import { CustomField, DraftField, FieldMeta } from "../shared/types";

// ── Low-level helpers ─────────────────────────────────────────────────

function first(text: string, ...pats: RegExp[]): string {
  for (const p of pats) {
    const m = text.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return "";
}

// ── Known geographic sets for disambiguation ──────────────────────────

const KNOWN_COUNTRIES = new Set([
  "Canada", "United States", "Australia", "United Kingdom", "France",
  "Germany", "Mexico", "Japan", "India", "Brazil", "Italy", "Spain",
  "Ireland", "Sweden", "Netherlands", "Portugal", "Poland", "Switzerland",
  "Denmark", "Norway", "New Zealand", "Singapore", "South Korea"
]);

// ── Postal code extraction ────────────────────────────────────────────

function extractPostal(t: string): string {
  // Keyword-prefixed: "zip code is L6A 0B1" or "postal code is 90210"
  const kw = t.match(/(?:postal|zip)(?:\s+code)?\s*(?:is|:)?\s*(\S+)(?:\s+(\S+))?/i);
  if (kw) {
    const [, a, b = ""] = kw;
    // Two short alphanumeric tokens → likely "L6A 0B1" style Canadian code
    if (b && /^[A-Za-z0-9]{2,4}$/.test(a) && /^[A-Za-z0-9]{2,4}$/.test(b)) {
      return `${a} ${b}`.toUpperCase();
    }
    return a.toUpperCase();
  }
  // Bare Canadian postal code
  const ca = t.match(/\b([A-Z]\d[A-Z][\s-]?\d[A-Z]\d)\b/i);
  if (ca) return ca[1].toUpperCase().replace(/\s/g, " ").replace(/-/, " ");
  // Bare US ZIP
  const us = t.match(/\b(\d{5}(?:-\d{4})?)\b/);
  return us?.[1] || "";
}

// ── Location (city / province-state / country) ────────────────────────

function extractLocation(t: string): { city: string; province: string; country: string } {
  const out = { city: "", province: "", country: "" };

  // "based out of London Ontario Canada" / "from Toronto ON" / "living in Vancouver BC"
  const m = t.match(
    /(?:based\s+(?:out\s+of|in)|from|living\s+in|located\s+in|resides?\s+in|lives?\s+in|in)\s+([A-Z][a-z]+)(?:\s+([A-Z][a-z]+))?(?:\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?))?/
  );
  if (m) {
    const w1 = m[1]?.trim();
    const w2 = m[2]?.trim();
    const w3 = m[3]?.trim().split(" ")[0]; // first word of third group

    if (w1) out.city = w1;
    if (w2) {
      KNOWN_COUNTRIES.has(w2) ? (out.country = w2) : (out.province = w2);
    }
    if (w3) out.country = w3;
  }

  // Explicit country keyword: "country is Canada" / "countries of course Canada"
  if (!out.country) {
    const ck = t.match(/countr(?:y|ies)\s*(?:(?:is|are|of\s+course|:)\s*)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
    if (ck) out.country = ck[1].trim();
  }

  // Last-resort: any known country mentioned anywhere
  if (!out.country) {
    for (const c of KNOWN_COUNTRIES) {
      if (t.includes(c)) { out.country = c; break; }
    }
  }

  return out;
}

// ── Date of birth extraction ──────────────────────────────────────────

const MONTH_MAP: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04",
  may: "05", june: "06", july: "07", august: "08",
  september: "09", october: "10", november: "11", december: "12",
  jan: "01", feb: "02", mar: "03", apr: "04",
  jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12"
};

function normalizeDob(raw: string): string {
  // Already ISO: "1985-03-15"
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return raw;

  // "03/15/1985" or "03-15-1985"
  const mdy = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;

  // "15/03/85" short year — keep as-is
  return raw;
}

function extractDob(t: string): string {
  // "DOB: 03/15/1985" or "date of birth is 1985-03-15" or "born March 15, 1985"
  // Numeric formats first
  const numericKw = t.match(
    /(?:d(?:ate\s+of\s+)?o(?:f\s+)?b(?:irth)?|birth\s*date|birthday|born\s+on?)\s*[:\s]\s*(\d{1,4}[\/\-]\d{1,2}[\/\-]\d{2,4})/i
  );
  if (numericKw) return normalizeDob(numericKw[1].trim());

  // ISO in text: "born 1985-03-15"
  const isoKw = t.match(/(?:born|dob|birth)\s*[:\s]?\s*(\d{4}-\d{2}-\d{2})/i);
  if (isoKw) return isoKw[1].trim();

  // "born March 15, 1985" / "born March 15th 1985" / "born on 15 March 85"
  const monthWordAfter = t.match(
    /(?:born\s+(?:on\s+)?|birthday\s+|birthdate\s+)([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})/i
  );
  if (monthWordAfter) {
    const [, mon, day, year] = monthWordAfter;
    const mm = MONTH_MAP[mon.toLowerCase()];
    if (mm) {
      const yyyy = year.length === 2 ? `19${year}` : year;
      return `${yyyy}-${mm}-${day.padStart(2, "0")}`;
    }
  }

  // "born 15 March 1985" (day then month)
  const dayMonthYear = t.match(
    /(?:born\s+(?:on\s+)?|birthday\s+)(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{2,4})/i
  );
  if (dayMonthYear) {
    const [, day, mon, year] = dayMonthYear;
    const mm = MONTH_MAP[mon.toLowerCase()];
    if (mm) {
      const yyyy = year.length === 2 ? `19${year}` : year;
      return `${yyyy}-${mm}-${day.padStart(2, "0")}`;
    }
  }

  // Bare numeric with keyword prefix anywhere
  const bareNumeric = t.match(
    /(?:dob|date\s+of\s+birth)\s*[:\s]\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i
  );
  if (bareNumeric) return normalizeDob(bareNumeric[1].trim());

  return "";
}

// ── Gender extraction ─────────────────────────────────────────────────

function extractGender(t: string): string {
  const m = t.match(
    /(?:gender|sex)\s*(?:is|:)?\s*(male|female|non[- ]?binary|nonbinary|other|m|f)\b/i
  );
  if (m) return normalizeGender(m[1]);

  const iAm = t.match(/\bi\s+am\s+(male|female|non[- ]?binary)\b/i);
  if (iAm) return normalizeGender(iAm[1]);

  return "";
}

function normalizeGender(raw: string): string {
  const lower = raw.toLowerCase().replace(/[- ]/g, "");
  if (lower === "male" || lower === "m") return "Male";
  if (lower === "female" || lower === "f") return "Female";
  if (lower === "nonbinary") return "Non-binary";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

// ── Insurance / policy extraction ─────────────────────────────────────

function extractInsurance(t: string): string {
  return first(t,
    /(?:insured\s+(?:by|through|with)|insurance(?:\s+(?:company|provider|carrier|plan))?\s*(?:is|:)?)\s*([A-Za-z][A-Za-z0-9\s&.\-']{1,40}?)(?=\s*(?:policy|plan|number|phone|email|dob|born|allerg|medic|$|,))/i,
    /(?:insurance\s+provider|insurer|carrier|plan)\s*[:\s]\s*([A-Za-z][A-Za-z0-9\s&.\-']{1,40}?)(?=\s*(?:policy|plan|number|phone|email|dob|born|allerg|medic|$|,))/i
  );
}

function extractPolicyNumber(t: string): string {
  return first(t,
    /(?:policy\s*(?:number|#|no\.?)|member\s*(?:id|number|no\.?)|group\s*(?:number|#|no\.?)|plan\s*(?:number|#))\s*[:\s]?\s*([A-Za-z0-9][A-Za-z0-9\-]{2,20})/i
  );
}

// ── Allergies extraction ──────────────────────────────────────────────

function extractAllergies(t: string): string {
  // "no known allergies" / "NKA"
  if (/\bno\s+known\s+allerg/i.test(t) || /\bNKA\b/.test(t)) return "No known allergies";

  return first(t,
    /allergi(?:c\s+to|es?)\s*[:\s]?\s*(.+?)(?=\s*(?:medic|insurance|policy|phone|email|dob|born|emerg|$))/i,
    /allerg(?:en|y)\s*[:\s]\s*(.+?)(?=\s*(?:medic|insurance|policy|phone|email|dob|born|emerg|$))/i
  );
}

// ── Medications extraction ────────────────────────────────────────────

function extractMedications(t: string): string {
  return first(t,
    /current\s+medications?\s*[:\s]\s*(.+?)(?=\s*(?:allerg|insurance|policy|phone|email|dob|born|emerg|$))/i,
    /(?:taking|on)\s+((?:[A-Za-z]+\s*\d*\s*(?:mg|mcg|ml|g|iu)?\s*(?:daily|twice|once|and|,|\s)*)+?)(?=\s*(?:allerg|insurance|policy|phone|email|dob|born|emerg|for|$))/i,
    /medications?\s*[:\s]\s*(.+?)(?=\s*(?:allerg|insurance|policy|phone|email|dob|born|emerg|$))/i
  );
}

// ── Emergency contact extraction ──────────────────────────────────────

function extractEmergencyContactName(t: string): string {
  return first(t,
    /(?:emergency\s+contact\s+is|in\s+case\s+of\s+emergency\s*[:\s])\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
    /emergency\s+contact\s*[:\s]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
    /next\s+of\s+kin\s*[:\s]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i
  );
}

function extractEmergencyContactPhone(t: string): string {
  // Find the phone number appearing after "emergency contact" context
  const ecSection = t.match(
    /(?:emergency\s+contact|in\s+case\s+of\s+emergency|next\s+of\s+kin).{0,80}?([\d][\d\s.\-()+]{5,17}[\d])/i
  );
  if (ecSection) return ecSection[1].trim();
  return "";
}

// ── Occupation extraction ─────────────────────────────────────────────

function extractOccupation(t: string): string {
  return first(t,
    /(?:occupation|job\s+title|profession|role|position|employment)\s*[:\s]\s*([A-Za-z][A-Za-z\s\-]{1,40}?)(?=\s*(?:phone|email|dob|born|allerg|medic|insurance|$|,))/i,
    /(?:i\s+(?:work|am\s+employed)\s+as\s+(?:a\s+|an\s+)?)([A-Za-z][A-Za-z\s\-]{2,40}?)(?=\s*(?:phone|email|dob|born|allerg|medic|insurance|at\b|for\b|$|,))/i,
    /works?\s+as\s+(?:a\s+|an\s+)?([A-Za-z][A-Za-z\s\-]{2,40}?)(?=\s*(?:phone|email|dob|born|allerg|medic|insurance|at\b|for\b|$|,))/i
  );
}

// ── Main entity extractor ─────────────────────────────────────────────

function extractFromText(raw: string): Record<string, string> {
  const t = raw.replace(/\s+/g, " ").trim();

  const fullName = first(t,
    // "patient's name is John Appleseed"
    /(?:(?:patient|client|customer|person)'?s?\s+)?name\s*(?:is|:)\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/,
    // "for John Appleseed" / "about John Appleseed"
    /(?:for|about|regarding)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/,
    // "I am / I'm / this is John Appleseed"
    /(?:i(?:'m| am)|this is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i
  );

  // Split name into parts for first/middle/last
  const nameParts = splitName(fullName);
  const firstName = nameParts[0] || "";
  const middleName = nameParts.length >= 3 ? nameParts.slice(1, -1).join(" ") : "";
  const lastName = nameParts.length >= 2 ? nameParts[nameParts.length - 1] : "";

  return {
    email: first(t, /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i),

    phone: first(t,
      // "phone number is 641-1111-1293" — very permissive digit string
      /(?:phone|mobile|cell(?:ular)?|tel(?:ephone)?)(?:\s+(?:number|#))?\s*(?:is|:)?\s*([\d][\d\s.\-()+]{5,17}[\d])/i,
      // Bare 10-digit pattern
      /\b(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]\d{3,4}[-.\s]\d{3,4})\b/
    ),

    postalCode: extractPostal(t),

    fullName,
    firstName,
    middleName,
    lastName,

    streetAddress: first(t,
      // "staying at / address is / lives at …" — stops at next keyword
      /(?:staying\s+at|lives?\s+at|located\s+at|residing\s+at|address(?:\s+is)?)\s+([A-Za-z0-9][A-Za-z0-9\s,.\-#]+?)(?=\s+(?:phone|email|zip|postal|city|company|countr|and\s+(?:in\s+)?the|$))/i,
      // "123 Main Street" style
      /(\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Street|St|Drive|Dr|Avenue|Ave|Boulevard|Blvd|Road|Rd|Lane|Ln|Court|Ct|Way|Place|Pl|Crescent|Cres|Circle|Cir|Terrace|Ter)\b[A-Za-z0-9\s,.\-#]*)(?=\s+(?:phone|email|zip|postal|city|,|$))/i
    ),

    company: first(t,
      // "company is Google" — stops at known next-field keyword
      /(?:company|employer|organization)\s*(?:is\s+)?([A-Z][A-Za-z0-9\s&.\-']{1,40}?)(?=\s+(?:countr|phone|email|zip|postal|and\b|$|,))/i,
      /works?\s+(?:at|for)\s+([A-Z][A-Za-z0-9\s&.\-']{1,40}?)(?=\s+(?:countr|phone|email|zip|postal|and\b|$|,))/i
    ),

    notes: first(t,
      // "in the notes at that there is headache nausea"
      /in\s+(?:the\s+)?notes?\s+(?:at\s+that\s+)?(?:there\s+(?:is|are)\s+)?(.+?)(?=\s*$)/i,
      // "notes: headache" / "notes is headache"
      /notes?\s*(?:is|are|:)\s*(.+?)(?=\s*$)/i,
      // Medical / form contexts
      /(?:symptoms?|complaints?|chief\s+complaint|comments?|description|reason\s+for\s+visit|additional\s+info(?:rmation)?|diagnosis)\s*(?:is|are|:)?\s*(.+?)(?=\s*$)/i
    ),

    dob: extractDob(t),
    gender: extractGender(t),
    insurance: extractInsurance(t),
    policyNumber: extractPolicyNumber(t),
    allergies: extractAllergies(t),
    medications: extractMedications(t),
    emergencyContactName: extractEmergencyContactName(t),
    emergencyContactPhone: extractEmergencyContactPhone(t),
    occupation: extractOccupation(t),

    ...extractLocation(t)
  };
}

// ── Autocomplete-based direct mapping (highest priority) ─────────────
// The HTML autocomplete attribute is the most reliable semantic signal.
// Use it first before falling back to keyword matching on label text.

type Getter = (m: Record<string, string>, firstName: string, lastName: string) => string;

const AUTOCOMPLETE_MAP: Record<string, Getter> = {
  "given-name":      (m)          => m.firstName || "",
  "additional-name": (m)          => m.middleName || "",
  "family-name":     (_, _fn, ln) => ln,
  "name":            (m, fn, ln)  => m.fullName || [fn, ln].filter(Boolean).join(" "),
  "email":           (m)          => m.email || "",
  "tel":             (m)          => m.phone || "",
  "street-address":  (m)          => capitalise(m.streetAddress || m.address || ""),
  "address-line1":   (m)          => capitalise(m.streetAddress || m.address || ""),
  "address-line2":   (m)          => capitalise(m.unit || m.apt || ""),
  "address-level1":  (m)          => capitalise(m.province || m.state || ""),
  "address-level2":  (m)          => capitalise(m.city || ""),
  "postal-code":     (m)          => m.postalCode || m.postal || m.zip || "",
  "country":         (m)          => capitalise(m.country || ""),
  "country-name":    (m)          => capitalise(m.country || ""),
  "organization":    (m)          => m.company || "",
  "bday":            (m)          => m.dob || m.dateOfBirth || "",
  "sex":             (m)          => m.gender || "",
  "honorific-prefix":(m)          => m.title || m.prefix || "",
};

function capitalise(s: string): string {
  if (!s) return s;
  return s.split(" ").map((word) =>
    word ? word.charAt(0).toUpperCase() + word.slice(1) : word
  ).join(" ");
}

// ── Field-to-value map ────────────────────────────────────────────────

// Each entry: check if the field's label/id/name/aria/autocomplete haystack
// contains any of the listed keys; return the corresponding value.
// Entries are ordered: first match wins when key lengths tie; longer key = more specific.
type FieldEntry = { keys: string[]; getValue: (m: Record<string, string>, firstName: string, lastName: string) => string };

const FIELD_MAP: FieldEntry[] = [
  { keys: ["email", "e-mail", "e_mail"],       getValue: (m) => m.email || "" },
  { keys: ["phone", "mobile", "tel", "fax", "cell"], getValue: (m) => m.phone || "" },
  { keys: ["postal", "zip", "postcode"],        getValue: (m) => m.postalCode || m.postal || m.zip || "" },
  { keys: ["first name", "first", "given"],     getValue: (m) => m.firstName || "" },
  { keys: ["last name", "last", "family", "surname"], getValue: (_, _fn, ln) => ln },
  { keys: ["middle name", "middle initial", "middle"], getValue: (m) => m.middleName || "" },
  { keys: ["full name", "fullname"],            getValue: (m, fn, ln) => m.fullName || m.name || [fn, ln].filter(Boolean).join(" ") },
  { keys: ["your name", "your_name"],           getValue: (m, fn, ln) => m.fullName || m.name || [fn, ln].filter(Boolean).join(" ") },
  { keys: ["name"],                             getValue: (m, fn, ln) => m.name || m.fullName || [fn, ln].filter(Boolean).join(" ") },
  { keys: ["street", "address 1", "address line", "address_1"], getValue: (m) => m.streetAddress || m.address || "" },
  { keys: ["address"],                          getValue: (m) => m.streetAddress || m.address || "" },
  { keys: ["apt", "unit", "suite", "address 2", "address_2"], getValue: (m) => m.unit || m.apt || "" },
  { keys: ["city", "town", "municipality"],     getValue: (m) => capitalise(m.city || "") },
  { keys: ["province", "state", "region", "territory"], getValue: (m) => capitalise(m.province || m.state || "") },
  { keys: ["country", "nation"],                getValue: (m) => capitalise(m.country || "") },
  { keys: ["company", "employer", "organization", "workplace", "business"], getValue: (m) => m.company || "" },
  { keys: ["note", "comment", "message", "symptom", "complaint", "chief complaint", "reason for visit", "description", "reason", "detail", "additional info", "information"], getValue: (m) => m.notes || "" },
  { keys: ["date of birth", "dob", "birth date", "birthday", "born"], getValue: (m) => m.dob || m.dateOfBirth || "" },
  { keys: ["gender", "sex"],                    getValue: (m) => m.gender || "" },
  // Insurance — do not match "policy number" or "insurance number" (those → policyNumber)
  { keys: ["insurance provider", "insurance company", "insurance carrier", "insurance plan", "insurer", "carrier"], getValue: (m) => m.insurance || "" },
  { keys: ["insurance"],                        getValue: (m) => m.insurance || "" },
  { keys: ["policy number", "policy no", "policy #", "member id", "group number", "plan number", "policyNumber"], getValue: (m) => m.policyNumber || "" },
  { keys: ["allerg"],                           getValue: (m) => m.allergies || "" },
  { keys: ["current medication", "medication", "drug", "prescription"], getValue: (m) => m.medications || "" },
  { keys: ["emergency contact name", "emergency name", "next of kin name"], getValue: (m) => m.emergencyContactName || "" },
  { keys: ["emergency contact phone", "emergency phone", "emergency number"], getValue: (m) => m.emergencyContactPhone || "" },
  { keys: ["emergency contact", "next of kin"],  getValue: (m) => m.emergencyContactName || "" },
  { keys: ["occupation", "job title", "profession", "employment", "position", "role"], getValue: (m) => m.occupation || "" },
];

// ── Public API ────────────────────────────────────────────────────────

export function heuristicDraft(rawInput: string, fields: FieldMeta[], profile: Record<string, string>, customFields: CustomField[] = []): DraftField[] {
  const t = rawInput.replace(/\s+/g, " ").trim();
  const extracted = extractFromText(t);

  // Saved profile (user's explicit defaults) overrides text extraction for non-empty values.
  const merged: Record<string, string> = {
    ...extracted,
    ...Object.fromEntries(Object.entries(profile).filter(([, v]) => Boolean(v)))
  };

  const nameParts = splitName(merged.fullName || merged.name || "");
  const firstName = merged.firstName || nameParts[0] || "";
  const lastName  = merged.lastName  || nameParts.slice(1).join(" ") || "";

  return fields.map((field): DraftField => {
    // Build a searchable string from every label signal on the field.
    const haystack = [
      field.label, field.ariaLabel, field.placeholder,
      field.name, field.id, field.autocomplete
    ].join(" ").toLowerCase().replace(/[_\-]/g, " ");

    // Find the most specific matching FIELD_MAP entry (longest matching key wins).
    let bestEntry: FieldEntry | null = null;
    let bestKeyLen = 0;
    for (const entry of FIELD_MAP) {
      for (const key of entry.keys) {
        if (haystack.includes(key) && key.length > bestKeyLen) {
          bestEntry = entry;
          bestKeyLen = key.length;
        }
      }
    }

    // 1. Autocomplete attribute → direct high-confidence match
    const acKey = (field.autocomplete || "").trim().toLowerCase();
    const fromAutocomplete = acKey && AUTOCOMPLETE_MAP[acKey]
      ? AUTOCOMPLETE_MAP[acKey](merged, firstName, lastName).trim()
      : "";

    // 2. Label/name keyword match
    const fromMap = bestEntry?.getValue(merged, firstName, lastName).trim() || "";

    // 3. Custom field: user-defined label fuzzy-matched against the form field haystack.
    const fromCustom = customFields.find((cf) => {
      if (!cf.label.trim() || !cf.value.trim()) return false;
      const needle = cf.label.trim().toLowerCase().replace(/[_\-]/g, " ");
      return haystack.includes(needle);
    })?.value.trim() || "";

    const proposedValue = fromAutocomplete || fromCustom || fromMap || valueForSelect(t, field);
    const confidence = proposedValue
      ? fromAutocomplete ? 0.88 : fromCustom ? 0.85 : bestEntry ? 0.72 : 0.50
      : 0.1;

    return {
      uid:           field.uid,
      label:         field.label || field.placeholder || field.name || field.id || field.uid,
      proposedValue,
      confidence,
      reason:        proposedValue ? (fromAutocomplete ? "Matched via autocomplete attribute." : fromCustom ? "Matched from your custom fields." : "Extracted from your text.") : "No match found in text.",
    };
  });
}

// ── Utilities ─────────────────────────────────────────────────────────

function valueForSelect(text: string, field: FieldMeta): string {
  if (!field.options.length) return "";
  const lower = text.toLowerCase();
  return (
    field.options.find(
      (o) => lower.includes(o.label.toLowerCase()) || lower.includes(o.value.toLowerCase())
    )?.value || ""
  );
}

function splitName(name: string): string[] {
  return name.trim().split(/\s+/).filter(Boolean);
}
