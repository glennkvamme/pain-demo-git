const form = document.getElementById('pain-form');
const statusText = document.getElementById('status');
const entriesBody = document.getElementById('entries-body');
const addLinesButton = document.getElementById('add-lines');
const creditorOptions = document.getElementById('creditor-options');
const summaryAmount = document.getElementById('summary-amount');
const summaryLines = document.getElementById('summary-lines');

const INITIAL_ROWS = 25;
const STEP_ROWS = 5;

let creditorAccountByName = new Map();

function normalizeCreditorName(name) {
  return String(name || '').trim().toLowerCase();
}

function getTodayIsoDate() {
  const today = new Date();
  today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  return today.toISOString().slice(0, 10);
}

function isValidMod10(numberString) {
  if (!/^\d+$/.test(numberString) || numberString.length < 2) return false;

  const digits = numberString.split('').map(Number);
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

function isValidMod11(numberString) {
  if (!/^\d+$/.test(numberString) || numberString.length < 2) return false;

  const digits = numberString.split('').map(Number);
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

function isValidKid(kid) {
  return /^\d{2,25}$/.test(kid) && (isValidMod10(kid) || isValidMod11(kid));
}

function isValidAccountNumber(accountNumber) {
  return /^\d{11}$/.test(accountNumber) && isValidMod11(accountNumber);
}

function isDateTodayOrFuture(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return false;

  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return date >= today;
}

function createCellInput({ className, type = 'text', inputMode = '', maxLength = '', min = '', step = '' }) {
  const input = document.createElement('input');
  input.className = className;
  input.type = type;

  if (inputMode) input.inputMode = inputMode;
  if (maxLength) input.maxLength = maxLength;
  if (min) input.min = min;
  if (step) input.step = step;

  return input;
}

function parseAmountInput(rawValue) {
  const cleaned = String(rawValue || '').replace(/\s+/g, '').trim();
  if (!cleaned) return null;

  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');
  let normalized = cleaned;

  if (hasComma && hasDot) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    normalized = cleaned.replace(',', '.');
  }

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function formatAmountForInput(value) {
  return value.toLocaleString('nb-NO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function updateSummary() {
  const rows = Array.from(entriesBody.querySelectorAll('tr'));
  let usedLines = 0;
  let totalAmount = 0;

  for (const row of rows) {
    const creditor = row.querySelector('.creditor').value.trim();
    const kid = row.querySelector('.kid').value.trim();
    const customerNote = row.querySelector('.customer-note').value.trim();
    const internalNote = row.querySelector('.internal-note').value.trim();
    const accountNumber = row.querySelector('.account-number').value.trim();
    const amountText = row.querySelector('.amount').value.trim();

    const hasAnyValue = creditor || kid || customerNote || internalNote || accountNumber || amountText;
    if (!hasAnyValue) continue;

    usedLines += 1;
    const parsedAmount = parseAmountInput(amountText);
    if (parsedAmount) totalAmount += parsedAmount;
  }

  summaryLines.textContent = String(usedLines);
  summaryAmount.textContent = totalAmount.toLocaleString('nb-NO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function extractFilenameFromDisposition(contentDisposition) {
  if (!contentDisposition) return null;

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match && utf8Match[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const basicMatch = contentDisposition.match(/filename=\"?([^\";]+)\"?/i);
  if (basicMatch && basicMatch[1]) {
    return basicMatch[1];
  }

  return null;
}

function applyCreditorAccount(creditorInput, accountInput) {
  const creditorKey = normalizeCreditorName(creditorInput.value);
  const predefinedAccount = creditorAccountByName.get(creditorKey);

  if (predefinedAccount) {
    accountInput.value = predefinedAccount;
  }
}

function createRow(rowNumber) {
  const tr = document.createElement('tr');

  const indexTd = document.createElement('td');
  indexTd.textContent = String(rowNumber);
  tr.appendChild(indexTd);

  const creditorTd = document.createElement('td');
  const creditorInput = createCellInput({ className: 'creditor' });
  creditorInput.setAttribute('list', 'creditor-options');
  creditorTd.appendChild(creditorInput);
  tr.appendChild(creditorTd);

  const kidTd = document.createElement('td');
  kidTd.appendChild(createCellInput({ className: 'kid', inputMode: 'numeric' }));
  tr.appendChild(kidTd);

  const customerNoteTd = document.createElement('td');
  customerNoteTd.appendChild(createCellInput({ className: 'customer-note', maxLength: '35' }));
  tr.appendChild(customerNoteTd);

  const internalNoteTd = document.createElement('td');
  internalNoteTd.appendChild(createCellInput({ className: 'internal-note', maxLength: '140' }));
  tr.appendChild(internalNoteTd);

  const accountTd = document.createElement('td');
  const accountInput = createCellInput({ className: 'account-number', inputMode: 'numeric' });
  accountTd.appendChild(accountInput);
  tr.appendChild(accountTd);

  creditorInput.addEventListener('change', () => applyCreditorAccount(creditorInput, accountInput));

  const amountTd = document.createElement('td');
  const amountInput = createCellInput({ className: 'amount', inputMode: 'decimal' });
  amountInput.addEventListener('blur', () => {
    const parsed = parseAmountInput(amountInput.value);
    if (parsed) {
      amountInput.value = formatAmountForInput(parsed);
    }
    updateSummary();
  });
  amountInput.addEventListener('input', updateSummary);
  amountTd.appendChild(amountInput);
  tr.appendChild(amountTd);

  const dueDateTd = document.createElement('td');
  const dueDateInput = createCellInput({ className: 'due-date', type: 'date' });
  const today = getTodayIsoDate();
  dueDateInput.value = today;
  dueDateInput.min = today;
  dueDateTd.appendChild(dueDateInput);
  tr.appendChild(dueDateTd);

  tr.addEventListener('input', updateSummary);
  tr.addEventListener('change', updateSummary);

  return tr;
}

function addRows(count) {
  const start = entriesBody.children.length;

  for (let i = 1; i <= count; i += 1) {
    entriesBody.appendChild(createRow(start + i));
  }
}

function readRows() {
  const rows = Array.from(entriesBody.querySelectorAll('tr'));
  const entries = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const line = i + 1;

    const creditor = row.querySelector('.creditor').value.trim();
    const kid = row.querySelector('.kid').value.trim();
    const customerNote = row.querySelector('.customer-note').value.trim();
    const internalNote = row.querySelector('.internal-note').value.trim();
    const accountNumber = row.querySelector('.account-number').value.trim();
    const amountText = row.querySelector('.amount').value.trim();
    const dueDate = row.querySelector('.due-date').value;

    const hasAnyValue = creditor || kid || customerNote || internalNote || accountNumber || amountText;

    if (!hasAnyValue) {
      continue;
    }

    if (!creditor) {
      throw new Error(`Linje ${line}: Kreditor ma fylles ut.`);
    }

    if (kid && customerNote) {
      throw new Error(`Linje ${line}: Notat til kunde kan kun brukes nar KID er tom.`);
    }

    if (!kid && !customerNote) {
      throw new Error(`Linje ${line}: Fyll inn enten KID eller notat til kunde.`);
    }

    if (kid && !isValidKid(kid)) {
      throw new Error(`Linje ${line}: Ugyldig KID (modulus-sjekk feilet).`);
    }

    if (!accountNumber || !amountText || !dueDate) {
      throw new Error(`Linje ${line}: Kontonummer, belop og dato ma fylles ut.`);
    }

    if (!isValidAccountNumber(accountNumber)) {
      throw new Error(`Linje ${line}: Ugyldig kontonummer (modulus-sjekk feilet).`);
    }

    if (!isDateTodayOrFuture(dueDate)) {
      throw new Error(`Linje ${line}: Dato ma vaere i dag eller frem i tid.`);
    }

    const parsedAmount = parseAmountInput(amountText);
    if (!parsedAmount) {
      throw new Error(`Linje ${line}: Belop er ugyldig. Bruk maks to desimaler.`);
    }

    entries.push({
      creditor,
      kid,
      customerNote,
      internalNote,
      accountNumber,
      amount: parsedAmount.toFixed(2),
      dueDate,
    });
  }

  return entries;
}

function renderCreditorOptions(creditors) {
  creditorOptions.innerHTML = '';
  creditorAccountByName = new Map();

  for (const creditor of creditors) {
    const name = String(creditor.name || '').trim();
    if (!name) continue;

    const accountNumber = String(creditor.accountNumber || '').replace(/\s+/g, '');
    const option = document.createElement('option');
    option.value = name;
    creditorOptions.appendChild(option);

    creditorAccountByName.set(normalizeCreditorName(name), accountNumber);
  }
}

async function loadCreditors() {
  try {
    const response = await fetch('/api/creditors');
    if (!response.ok) throw new Error('Kunne ikke hente kreditorliste.');
    const creditors = await response.json();
    renderCreditorOptions(creditors);
  } catch (error) {
    statusText.textContent = error.message;
  }
}

addLinesButton.addEventListener('click', () => {
  addRows(STEP_ROWS);
  statusText.textContent = `La til ${STEP_ROWS} nye linjer.`;
  updateSummary();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const caseHandler = document.getElementById('caseHandler').value.trim();
  const cloNumber = document.getElementById('cloNumber').value.trim();

  if (!caseHandler || !cloNumber) {
    statusText.textContent = 'Saksbehandler og CLO nummer ma fylles ut.';
    return;
  }

  let entries;

  try {
    entries = readRows();
  } catch (error) {
    statusText.textContent = error.message;
    return;
  }

  if (entries.length === 0) {
    statusText.textContent = 'Fyll ut minst en linje for a generere XML.';
    return;
  }

  statusText.textContent = `Genererer XML for ${entries.length} foringer...`;

  try {
    const response = await fetch('/api/pain001', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries, caseHandler, cloNumber }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Ukjent feil.' }));
      throw new Error(body.error || 'Kunne ikke generere XML.');
    }

    const blob = await response.blob();
    const contentDisposition = response.headers.get('Content-Disposition');
    const fileName = extractFilenameFromDisposition(contentDisposition) || 'pain001.xml';
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    statusText.textContent = `Ferdig. XML-fil for ${entries.length} foringer er lastet ned.`;
  } catch (error) {
    statusText.textContent = error.message;
  }
});

addRows(INITIAL_ROWS);
loadCreditors();
updateSummary();
