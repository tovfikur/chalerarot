// Pure Bangla digit helper (no React/RN imports) so non-UI modules such as the
// printable report can use it too.
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
export const toBnDigits = (s: string) => s.replace(/[0-9]/g, d => BN_DIGITS[+d]);

// INPUT side: Bangla → English digits so a bn-locale user can type `৯৪৫০`,
// `১২,৫০০` or mixed `১2৫0` and business logic always receives plain `9450`.
// Data entry only — display formatting keeps using toBnDigits.
export const toEnDigits = (s: string) => s.replace(/[০-৯]/g, d => String(BN_DIGITS.indexOf(d)));

// Removes thousands separators (`,`), leaving digits, `.` and `-` only.
export const normalizeInput = (s: string) => toEnDigits(s).replace(/,/g, '');

// The one shared money/quantity parser used by every numeric entry point.
// Returns a normalized number (0 for garbage), never NaN — same contract the
// old `parseFloat(v) || 0` gave, but Bangla-digit aware.
export const parseNum = (v: string | number | null | undefined): number => {
  const n = parseFloat(normalizeInput(String(v ?? '')));
  return Number.isFinite(n) ? n : 0;
};
