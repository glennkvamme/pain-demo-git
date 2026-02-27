const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3200;

const DATA_DIR = path.join(__dirname, 'data');
const CREDITORS_FILE = path.join(DATA_DIR, 'creditors.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const BACKUP_DIR = path.join(__dirname, 'backups');
const PAYER_NAME = 'Kraft Bank ASA';
const PAYER_ORG_NO = '918315446';
const PAYER_BBAN = '32072278835';

app.use(express.json());
app.use(express.static('public'));

function ensureCreditorsStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(CREDITORS_FILE)) {
    fs.writeFileSync(CREDITORS_FILE, '[]', 'utf8');
  }
}

function ensureHistoryStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  if (!fs.existsSync(HISTORY_FILE)) {
    fs.writeFileSync(HISTORY_FILE, '[]', 'utf8');
  }
}

function sanitizeCreditor(raw) {
  const name = String(raw.name || '').trim();
  const accountNumber = String(raw.accountNumber || '').replace(/\s+/g, '');
  return {
    id: String(raw.id || crypto.randomUUID()),
    name,
    accountNumber,
  };
}

function readCreditors() {
  ensureCreditorsStore();

  const fileContent = fs.readFileSync(CREDITORS_FILE, 'utf8').replace(/^\uFEFF/, '');
  const parsed = JSON.parse(fileContent);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map(sanitizeCreditor)
    .filter((creditor) => creditor.name.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'nb'));
}

function writeCreditors(creditors) {
  ensureCreditorsStore();
  fs.writeFileSync(CREDITORS_FILE, JSON.stringify(creditors, null, 2), 'utf8');
}

function readHistory() {
  ensureHistoryStore();

  const fileContent = fs.readFileSync(HISTORY_FILE, 'utf8').replace(/^\uFEFF/, '');
  const parsed = JSON.parse(fileContent);
  if (!Array.isArray(parsed)) return [];

  return parsed.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function writeHistory(historyEntries) {
  ensureHistoryStore();
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(historyEntries, null, 2), 'utf8');
}

function validateCreditorsList(rawList) {
  if (!Array.isArray(rawList)) {
    return { error: 'creditors må være en liste.' };
  }

  const normalizedNameSet = new Set();
  const result = [];

  for (let i = 0; i < rawList.length; i += 1) {
    const creditor = sanitizeCreditor(rawList[i]);
    const line = i + 1;

    if (!creditor.name) {
      return { error: `Kreditor linje ${line}: Navn må fylles ut.` };
    }

    const normalizedName = creditor.name.toLowerCase();
    if (normalizedNameSet.has(normalizedName)) {
      return { error: `Kreditor linje ${line}: Duplikat navn (${creditor.name}).` };
    }
    normalizedNameSet.add(normalizedName);

    if (creditor.accountNumber && (!/^\d{11}$/.test(creditor.accountNumber) || !isValidMod11(creditor.accountNumber))) {
      return { error: `Kreditor linje ${line}: Ugyldig kontonummer (modulus-sjekk feilet).` };
    }

    result.push(creditor);
  }

  return { value: result.sort((a, b) => a.name.localeCompare(b.name, 'nb')) };
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatAmount(rawAmount) {
  const normalized = String(rawAmount).replace(',', '.').trim();
  const parsed = Number(normalized);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed.toFixed(2);
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

function isDateTodayOrFuture(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return false;

  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return date >= today;
}

function validateEntry(entry, lineNumber) {
  const cleanCreditor = String(entry.creditor || '').trim();
  const cleanKid = String(entry.kid || '').replace(/\s+/g, '');
  const cleanCustomerNote = String(entry.customerNote || '').trim();
  const cleanInternalNote = String(entry.internalNote || '').trim();
  const cleanAccountNumber = String(entry.accountNumber || '').replace(/\s+/g, '');
  const formattedAmount = formatAmount(entry.amount);
  const dueDate = String(entry.dueDate || '').trim();
  const hasKid = cleanKid.length > 0;
  const hasCustomerNote = cleanCustomerNote.length > 0;

  if (!cleanCreditor) {
    return { error: `Linje ${lineNumber}: Kreditor må fylles ut.` };
  }

  if (hasKid && hasCustomerNote) {
    return { error: `Linje ${lineNumber}: Notat til kunde kan kun brukes nar KID-feltet er tomt.` };
  }

  if (!hasKid && !hasCustomerNote) {
    return { error: `Linje ${lineNumber}: Fyll inn enten KID eller notat til kunde.` };
  }

  if (hasKid && (!/^\d{2,25}$/.test(cleanKid) || (!isValidMod10(cleanKid) && !isValidMod11(cleanKid)))) {
    return { error: `Linje ${lineNumber}: Ugyldig KID (modulus-sjekk feilet).` };
  }

  if (hasCustomerNote && (cleanCustomerNote.length < 2 || cleanCustomerNote.length > 35)) {
    return { error: `Linje ${lineNumber}: Notat til kunde ma vaere mellom 2 og 35 tegn.` };
  }

  if (!/^\d{11}$/.test(cleanAccountNumber) || !isValidMod11(cleanAccountNumber)) {
    return { error: `Linje ${lineNumber}: Ugyldig kontonummer (modulus-sjekk feilet).` };
  }

  if (!formattedAmount) {
    return { error: `Linje ${lineNumber}: Belop ma vaere et positivt tall.` };
  }

  if (!isDateTodayOrFuture(dueDate)) {
    return { error: `Linje ${lineNumber}: Dato ma vaere i dag eller frem i tid.` };
  }

  if (cleanInternalNote.length > 140) {
    return { error: `Linje ${lineNumber}: Internt notat kan maks vaere 140 tegn.` };
  }

  return {
    value: {
      creditor: cleanCreditor,
      kid: cleanKid,
      customerNote: cleanCustomerNote,
      endToEndId: hasKid ? cleanKid : cleanCustomerNote,
      internalNote: cleanInternalNote,
      accountNumber: cleanAccountNumber,
      amount: formattedAmount,
      dueDate,
    },
  };
}

function buildTransactionXml(tx) {
  const remittanceXml = tx.kid
    ? `<RmtInf>
          <Strd>
            <CdtrRefInf>
              <Tp>
                <CdOrPrtry>
                  <Cd>SCOR</Cd>
                </CdOrPrtry>
              </Tp>
              <Ref>${escapeXml(tx.kid)}</Ref>
            </CdtrRefInf>
          </Strd>
        </RmtInf>`
    : (tx.customerNote
      ? `<RmtInf>
          <Ustrd>${escapeXml(tx.customerNote)}</Ustrd>
        </RmtInf>`
      : '');

  const supplementaryDataXml = tx.internalNote
    ? `<SplmtryData>
          <Envlp>
            <InterntNotat>${escapeXml(tx.internalNote)}</InterntNotat>
          </Envlp>
        </SplmtryData>`
    : '';

  return `<CdtTrfTxInf>
        <PmtId>
          <InstrId>${escapeXml(tx.instrId)}</InstrId>
          <EndToEndId>${escapeXml(tx.endToEndId)}</EndToEndId>
        </PmtId>
        <Amt>
          <InstdAmt Ccy="NOK">${escapeXml(tx.amount)}</InstdAmt>
        </Amt>
        <CdtrAgt>
          <FinInstnId/>
        </CdtrAgt>
        <Cdtr>
          <Nm>${escapeXml(tx.creditor)}</Nm>
          <PstlAdr>
            <Ctry>NO</Ctry>
          </PstlAdr>
        </Cdtr>
        <CdtrAcct>
          <Id>
            <Othr>
              <Id>${escapeXml(tx.accountNumber)}</Id>
              <SchmeNm>
                <Cd>BBAN</Cd>
              </SchmeNm>
            </Othr>
          </Id>
        </CdtrAcct>
        ${remittanceXml}
        ${supplementaryDataXml}
      </CdtTrfTxInf>`;
}

function buildPaymentInfoXml({ stamp, index, dueDate, transactions }) {
  const ctrlSum = transactions
    .reduce((sum, tx) => sum + Number(tx.amount), 0)
    .toFixed(2);

  const transactionsXml = transactions.map(buildTransactionXml).join('\n');

  return `<PmtInf>
      <PmtInfId>PMT${escapeXml(stamp)}_${index}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <PmtTpInf>
        <InstrPrty>NORM</InstrPrty>
      </PmtTpInf>
      <NbOfTxs>${transactions.length}</NbOfTxs>
      <CtrlSum>${escapeXml(ctrlSum)}</CtrlSum>
      <ReqdExctnDt>${escapeXml(dueDate)}</ReqdExctnDt>
      <Dbtr>
        <Nm>${escapeXml(PAYER_NAME)}</Nm>
        <PstlAdr>
          <Ctry>NO</Ctry>
        </PstlAdr>
        <Id>
          <OrgId>
            <Othr>
              <Id>${escapeXml(PAYER_ORG_NO)}</Id>
              <SchmeNm>
                <Cd>CUST</Cd>
              </SchmeNm>
            </Othr>
          </OrgId>
        </Id>
      </Dbtr>
      <DbtrAcct>
        <Id>
          <Othr>
            <Id>${escapeXml(PAYER_BBAN)}</Id>
            <SchmeNm>
              <Cd>BBAN</Cd>
            </SchmeNm>
          </Othr>
        </Id>
        <Ccy>NOK</Ccy>
      </DbtrAcct>
      <DbtrAgt>
        <FinInstnId>
          <BIC>SPRONO22</BIC>
        </FinInstnId>
      </DbtrAgt>
      <ChrgBr>SLEV</ChrgBr>
      ${transactionsXml}
    </PmtInf>`;
}

function buildPain001Xml(transactions) {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);

  const groups = new Map();
  let instructionSequence = 1;
  for (const tx of transactions) {
    const txWithInstruction = {
      ...tx,
      instrId: String(instructionSequence),
    };
    instructionSequence += 1;

    if (!groups.has(tx.dueDate)) {
      groups.set(tx.dueDate, []);
    }
    groups.get(tx.dueDate).push(txWithInstruction);
  }

  const paymentInfos = Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dueDate, txs], idx) =>
      buildPaymentInfoXml({ stamp, index: idx + 1, dueDate, transactions: txs })
    )
    .join('\n');

  const totalAmount = transactions
    .reduce((sum, tx) => sum + Number(tx.amount), 0)
    .toFixed(2);

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>MSG${escapeXml(stamp)}</MsgId>
      <CreDtTm>${escapeXml(now.toISOString().slice(0, 19))}</CreDtTm>
      <NbOfTxs>${transactions.length}</NbOfTxs>
      <CtrlSum>${escapeXml(totalAmount)}</CtrlSum>
      <InitgPty>
        <Nm>${escapeXml(PAYER_NAME)}</Nm>
        <Id>
          <OrgId>
            <Othr>
              <Id>${escapeXml(PAYER_ORG_NO)}</Id>
              <SchmeNm>
                <Cd>CUST</Cd>
              </SchmeNm>
            </Othr>
          </OrgId>
        </Id>
      </InitgPty>
    </GrpHdr>
    ${paymentInfos}
  </CstmrCdtTrfInitn>
</Document>`;
}

function buildGeneratedFileName(date) {
  const pad = (value) => String(value).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const ss = pad(date.getSeconds());

  return `pain001_KraftBankASA_${yyyy}${mm}${dd}_${hh}${mi}${ss}.xml`;
}

app.get('/api/creditors', (req, res) => {
  try {
    const creditors = readCreditors();
    res.json(creditors);
  } catch (error) {
    res.status(500).json({ error: 'Kunne ikke lese kreditorliste.' });
  }
});

app.get('/api/history', (req, res) => {
  try {
    const historyEntries = readHistory();
    res.json(historyEntries);
  } catch (error) {
    res.status(500).json({ error: 'Kunne ikke lese historikk.' });
  }
});

app.get('/api/history/:id/download', (req, res) => {
  try {
    const historyEntries = readHistory();
    const entry = historyEntries.find((item) => item.id === req.params.id);

    if (!entry) {
      return res.status(404).json({ error: 'Fant ikke historikk-oppføring.' });
    }

    const fullPath = path.join(BACKUP_DIR, entry.backupFileName);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Backup-filen finnes ikke.' });
    }

    res.download(fullPath, entry.generatedFileName || entry.backupFileName);
  } catch (error) {
    res.status(500).json({ error: 'Kunne ikke hente backup-fil.' });
  }
});

app.put('/api/creditors', (req, res) => {
  try {
    const rawCreditors = req.body.creditors;
    const validated = validateCreditorsList(rawCreditors);

    if (validated.error) {
      return res.status(400).json({ error: validated.error });
    }

    writeCreditors(validated.value);
    res.json({ ok: true, count: validated.value.length });
  } catch (error) {
    res.status(500).json({ error: 'Kunne ikke lagre kreditorliste.' });
  }
});

app.post('/api/pain001', (req, res) => {
  const entries = Array.isArray(req.body.entries) ? req.body.entries : [];
  const caseHandler = String(req.body.caseHandler || '').trim();
  const cloNumber = String(req.body.cloNumber || '').trim();

  if (entries.length === 0) {
    return res.status(400).json({ error: 'Send inn minst en linje i entries.' });
  }

  if (!caseHandler || !cloNumber) {
    return res.status(400).json({ error: 'Saksbehandler og CLO nummer ma fylles ut.' });
  }

  const validated = [];

  for (let i = 0; i < entries.length; i += 1) {
    const result = validateEntry(entries[i], i + 1);

    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    validated.push(result.value);
  }

  const xml = buildPain001Xml(validated);
  const now = new Date();
  const stamp = now.toISOString();
  const compactStamp = stamp.replace(/[-:.TZ]/g, '').slice(0, 14);
  const generatedFileName = buildGeneratedFileName(now);
  const backupFileName = `pain001_${compactStamp}_${crypto.randomUUID().slice(0, 8)}.xml`;

  ensureHistoryStore();
  fs.writeFileSync(path.join(BACKUP_DIR, backupFileName), xml, 'utf8');

  const historyEntries = readHistory();
  historyEntries.push({
    id: crypto.randomUUID(),
    createdAt: stamp,
    caseHandler,
    cloNumber,
    transactionsCount: validated.length,
    generatedFileName,
    backupFileName,
  });
  writeHistory(historyEntries);

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${generatedFileName}"`);
  res.send(xml);
});

ensureCreditorsStore();
ensureHistoryStore();

app.listen(port, () => {
  console.log(`Betaling SR-bank kjorer pa http://localhost:${port}`);
});


