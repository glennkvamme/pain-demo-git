function formatAmount(value) {
  return value.toLocaleString("nb-NO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parseAmountInput(rawValue) {
  const cleaned = String(rawValue || "").replace(/\s+/g, "").trim();
  if (!cleaned) return null;

  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  let normalized = cleaned;

  if (hasComma && hasDot) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    normalized = cleaned.replace(",", ".");
  }

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function getTodayIsoDate() {
  const today = new Date();
  today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  return today.toISOString().slice(0, 10);
}

function extractFilenameFromDisposition(contentDisposition) {
  if (!contentDisposition) return null;

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match && utf8Match[1]) return decodeURIComponent(utf8Match[1]);

  const basicMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
  if (basicMatch && basicMatch[1]) return basicMatch[1];

  return null;
}

function isValidMod11(numberString) {
  if (!/^\d+$/.test(numberString) || numberString.length < 2) return false;

  const digits = numberString.split("").map(Number);
  const controlDigit = digits[digits.length - 1];
  const payload = digits.slice(0, -1).reverse();
  let sum = 0;

  for (let i = 0; i < payload.length; i += 1) {
    const weight = (i % 6) + 2;
    sum += payload[i] * weight;
  }

  const remainder = sum % 11;
  let calculated = 11 - remainder;
  if (calculated === 11) calculated = 0;
  if (calculated === 10) return false;

  return calculated === controlDigit;
}

function isValidMod10(numberString) {
  if (!/^\d+$/.test(numberString) || numberString.length < 2) return false;

  const digits = numberString.split("").map(Number);
  const controlDigit = digits[digits.length - 1];
  const payload = digits.slice(0, -1).reverse();
  let sum = 0;

  for (let i = 0; i < payload.length; i += 1) {
    const factor = i % 2 === 0 ? 2 : 1;
    let value = payload[i] * factor;
    if (value > 9) value -= 9;
    sum += value;
  }

  const calculated = (10 - (sum % 10)) % 10;
  return calculated === controlDigit;
}

function isValidKid(value) {
  const kid = String(value || "").replace(/\s+/g, "").trim();
  if (!kid) return true;
  return /^\d{2,25}$/.test(kid) && (isValidMod10(kid) || isValidMod11(kid));
}

function isValidAccountNumber(value) {
  const account = String(value || "").replace(/\s+/g, "").trim();
  if (!account) return true;
  return /^\d{11}$/.test(account) && isValidMod11(account);
}

function parseCustomerNoteFields(value) {
  const note = String(value || "").trim();
  if (!note) return { reference: "", owner: "", valid: true };

  const match = note.match(/^Saksnr:\s*([^|]+)\s*\|\s*Eier:\s*(.+)$/i);
  if (!match) return { reference: "", owner: "", valid: false };

  const reference = (match[1] || "").trim();
  const owner = (match[2] || "").trim();
  const valid = reference.length > 0 && owner.length > 0;
  return { reference, owner, valid };
}

function isValidCustomerNoteFormat(value) {
  return parseCustomerNoteFields(value).valid;
}

export {
  extractFilenameFromDisposition,
  formatAmount,
  getTodayIsoDate,
  isValidAccountNumber,
  isValidCustomerNoteFormat,
  isValidKid,
  isValidMod10,
  isValidMod11,
  parseCustomerNoteFields,
  parseAmountInput,
};
