import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { formatAmount, isValidKid, parseAmountInput, parseCustomerNoteFields } from "../utils";

const FIRST_PAYMENT_ACCOUNT = "3207 22 78835";
const AUTOSAVE_DELAY_MS = 1500;

function getDefaultFirstPaymentDate() {
  const now = new Date();
  const currentMonthDate = new Date(now.getFullYear(), now.getMonth(), 25);
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysUntilCurrentMonth25 = Math.floor((currentMonthDate.getTime() - now.getTime()) / msPerDay);

  const selectedDate =
    daysUntilCurrentMonth25 >= 0 && daysUntilCurrentMonth25 < 14
      ? currentMonthDate
      : new Date(now.getFullYear(), now.getMonth() + 1, 25);

  const tzOffsetMs = selectedDate.getTimezoneOffset() * 60 * 1000;
  return new Date(selectedDate.getTime() - tzOffsetMs).toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export default function TilKundePage() {
  const { foringId } = useParams();
  const [statusText, setStatusText] = useState("");
  const [isLoaded, setIsLoaded] = useState(false);
  const [cloNumber, setCloNumber] = useState("");
  const [rows, setRows] = useState([]);
  const [kraftBankHonorar, setKraftBankHonorar] = useState("");
  const [firstPaymentDate, setFirstPaymentDate] = useState(() => getDefaultFirstPaymentDate());
  const [firstPaymentAmount, setFirstPaymentAmount] = useState("");
  const [firstPaymentKid, setFirstPaymentKid] = useState("");
  const [saveTrigger, setSaveTrigger] = useState(0);
  const lastSavedSignatureRef = useRef("");
  const blurSaveRequestedRef = useRef(false);

  useEffect(() => {
    let active = true;
    setIsLoaded(false);

    async function loadForing() {
      try {
        const response = await fetch(`/api/foringer/${foringId}`);
        if (!response.ok) {
          const body = await response.json().catch(() => ({ error: "Kunne ikke hente foring." }));
          throw new Error(body.error || "Kunne ikke hente foring.");
        }

        const payload = await response.json();
        if (!active) return;

        setCloNumber(String(payload.cloNumber || ""));
        setKraftBankHonorar(String(payload.etableringshonorar || ""));
        setFirstPaymentDate(String(payload.firstPaymentDate || "").trim() || getDefaultFirstPaymentDate());
        setFirstPaymentAmount(String(payload.firstPaymentAmount || ""));
        setFirstPaymentKid(String(payload.firstPaymentKid || ""));
        const entries = Array.isArray(payload.entries) ? payload.entries : [];
        setRows(entries);
        setIsLoaded(true);
      } catch (error) {
        if (!active) return;
        setStatusText(error.message || "Ukjent feil.");
      }
    }

    loadForing();
    return () => {
      active = false;
    };
  }, [foringId]);

  function buildFirstPaymentPayload() {
    return {
      firstPaymentDate: String(firstPaymentDate || "").trim(),
      firstPaymentAmount: String(firstPaymentAmount || "").trim(),
      firstPaymentKid: String(firstPaymentKid || "").replace(/\s+/g, "").trim(),
    };
  }

  function requestBlurSave() {
    blurSaveRequestedRef.current = true;
    setSaveTrigger((value) => value + 1);
  }

  useEffect(() => {
    if (!isLoaded) return;
    lastSavedSignatureRef.current = JSON.stringify(buildFirstPaymentPayload());
  }, [isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    const immediate = blurSaveRequestedRef.current;
    blurSaveRequestedRef.current = false;

    const timer = window.setTimeout(async () => {
      try {
        const payload = buildFirstPaymentPayload();
        const signature = JSON.stringify(payload);
        if (signature === lastSavedSignatureRef.current) {
          return;
        }

        const response = await fetch(`/api/foringer/${foringId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({ error: "Ukjent feil." }));
          throw new Error(body.error || "Kunne ikke lagre Første innbetaling.");
        }

        lastSavedSignatureRef.current = signature;
      } catch (error) {
        setStatusText(error.message || "Ukjent feil.");
      }
    }, immediate ? 0 : AUTOSAVE_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [foringId, isLoaded, firstPaymentDate, firstPaymentAmount, firstPaymentKid, saveTrigger]);

  const listRows = useMemo(() => {
    return rows
      .filter((row) => row.creditor || row.accountNumber || row.kid || row.amount || row.customerNote)
      .map((row) => {
        const parsedAmount = parseAmountInput(row.amount);
        const amountText = parsedAmount ? formatAmount(parsedAmount) : String(row.amount || "");
        const noteInfo = parseCustomerNoteFields(row.customerNote);

        return {
          creditor: String(row.creditor || ""),
          accountNumber: String(row.accountNumber || ""),
          kid: String(row.kid || ""),
          amount: amountText,
          reference: noteInfo.reference,
          owner: String(row.owner || noteInfo.owner || ""),
        };
      });
  }, [rows]);

  const summary = useMemo(() => {
    const sumForinger = listRows.reduce((sum, row) => {
      const parsed = parseAmountInput(row.amount);
      return sum + (parsed || 0);
    }, 0);

    const parsedHonorar = parseAmountInput(kraftBankHonorar) || 0;
    return {
      sumForinger,
      kraftBankHonorar: parsedHonorar,
      total: sumForinger + parsedHonorar,
    };
  }, [listRows, kraftBankHonorar]);

  const boligLaanAmountText = useMemo(() => {
    const boligLaanRow = rows.find((row) => Boolean(row?.boligLaan));
    if (!boligLaanRow) return "xxx1";

    const parsedAmount = parseAmountInput(boligLaanRow.amount);
    if (!parsedAmount) return "xxx1";

    return formatAmount(parsedAmount);
  }, [rows]);

  const boligLaanAccountText = useMemo(() => {
    const boligLaanRow = rows.find((row) => Boolean(row?.boligLaan));
    if (!boligLaanRow) return "xx2";

    const accountNumber = String(boligLaanRow.accountNumber || "").trim();
    return accountNumber || "xx2";
  }, [rows]);
  const del1KidText = String(firstPaymentKid || "").replace(/\s+/g, "").trim();

  async function copyListToClipboard() {
    const cleanKid = String(firstPaymentKid || "").replace(/\s+/g, "").trim();
    if (cleanKid && !isValidKid(cleanKid)) {
      setStatusText("Ugyldig KID i Første innbetaling (modulus-sjekk feilet).");
      return;
    }

    const header = ["Kreditorer", "Kontonr", "KID", "Beløp", "Saksnr/referanse", "Eier:"];
    const firstPaymentLines = [
      "",
      "Første innbetaling:",
      `Dato:\t${firstPaymentDate || ""}`,
      `Beløp:\t${firstPaymentAmount || ""}`,
      `KID:\t${cleanKid}`,
      `Kontonummer:\t${FIRST_PAYMENT_ACCOUNT}`,
    ];

    const lines = [
      ...firstPaymentLines,
      "",
      header.join("\t"),
      ...listRows.map((row) =>
        [row.creditor, row.accountNumber, row.kid, row.amount, row.reference, row.owner].join("\t")
      ),
      "",
      "Lån i Kraft Bank:",
      `Sum føringer:\t${formatAmount(summary.sumForinger)}`,
      `Kraft Bank honorar:\t${formatAmount(summary.kraftBankHonorar)}`,
      `Total føring inkl. honorar:\t${formatAmount(summary.total)}`,
    ];
    const text = lines.join("\n");

    const htmlRows = listRows.length
      ? listRows.map((row) => `
        <tr>
          <td>${escapeHtml(row.creditor)}</td>
          <td>${escapeHtml(row.accountNumber)}</td>
          <td>${escapeHtml(row.kid)}</td>
          <td style="text-align:right">${escapeHtml(row.amount)}</td>
          <td>${escapeHtml(row.reference)}</td>
          <td>${escapeHtml(row.owner)}</td>
        </tr>
      `).join("")
      : `<tr><td colspan="6">Ingen linjer</td></tr>`;

    const html = `
      <div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1f2937;line-height:1.4">
        <div style="margin-bottom:12px;padding:10px;border:1px solid #cfd8e3;background:#f7f8fa;max-width:420px">
          <div><strong>Første innbetaling:</strong></div>
          <div>Dato: ${escapeHtml(firstPaymentDate)}</div>
          <div>Beløp: ${escapeHtml(firstPaymentAmount)}</div>
          <div>KID: ${escapeHtml(cleanKid)}</div>
          <div>Kontonummer: ${escapeHtml(FIRST_PAYMENT_ACCOUNT)}</div>
        </div>
        <table style="border-collapse:collapse;width:100%;max-width:980px">
          <thead>
            <tr>
              <th style="border:1px solid #cfd8e3;background:#f3f6fa;padding:6px;text-align:left">Kreditorer</th>
              <th style="border:1px solid #cfd8e3;background:#f3f6fa;padding:6px;text-align:left">Kontonr</th>
              <th style="border:1px solid #cfd8e3;background:#f3f6fa;padding:6px;text-align:left">KID</th>
              <th style="border:1px solid #cfd8e3;background:#f3f6fa;padding:6px;text-align:right">Beløp</th>
              <th style="border:1px solid #cfd8e3;background:#f3f6fa;padding:6px;text-align:left">Saksnr/referanse</th>
              <th style="border:1px solid #cfd8e3;background:#f3f6fa;padding:6px;text-align:left">Eier</th>
            </tr>
          </thead>
          <tbody>${htmlRows}</tbody>
        </table>
        <div style="margin-top:12px;padding:10px;border:1px solid #cfd8e3;background:#ffffff;max-width:420px">
          <div><strong>Lån i Kraft Bank</strong></div>
          <div>Sum føringer: ${escapeHtml(formatAmount(summary.sumForinger))}</div>
          <div>Kraft Bank honorar: ${escapeHtml(formatAmount(summary.kraftBankHonorar))}</div>
          <div>Total føring inkl. honorar: ${escapeHtml(formatAmount(summary.total))}</div>
        </div>
      </div>
    `;

    try {
      if (window.ClipboardItem && navigator.clipboard?.write) {
        const item = new window.ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        });
        await navigator.clipboard.write([item]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      setStatusText("Del 2-listen er kopiert.");
    } catch {
      setStatusText("Kunne ikke kopiere automatisk. Marker og kopier tabellen manuelt.");
    }
  }

  return (
    <>
      <h1>Til kunde</h1>
      <p>Kreditorliste for CLO {cloNumber || ""}</p>
      <div className="actions actions-left">
        <Link className="action-link secondary-btn" to={`/foring/${foringId}`}>Tilbake til kreditorliste</Link>
      </div>

      <section className="customer-section">
        <h2>Del 1: Tekst for sletting av pant</h2>
        <p className="customer-text">
          Vi har i dag overført {boligLaanAmountText}- på konto {boligLaanAccountText} for innfrielse. Beløpet oversendes under
          forutsetning av at tilknyttet pantedokument blir slettet omgående. Dersom beløpet ikke er
          korrekt eller at pantedokumentet av andre årsaker ikke kan slettes, imøteser vi omgående
          tilbakemelding om dette. I de tilfellene det er overskytende på konto, vennligst returner
          dette til konto 3207.22.78835 og benytt KID: {del1KidText}
        </p>
      </section>

      <section className="customer-section">
        <h2>Del 2: Liste til e-post</h2>
        <p>
          Kolonner: Kreditorer, Kontonr, KID, Beløp, Saksnr/referanse, Eier. Saksnr/referanse og Eier
          hentes fra Notat til kunde.
        </p>

        <div className="actions actions-left">
          <button type="button" className="secondary-btn" onClick={copyListToClipboard}>
            Kopier liste
          </button>
        </div>

        <section className="first-payment-box">
          <h3>Første innbetaling:</h3>
          <div className="first-payment-row">
            <label htmlFor="firstPaymentDate">Dato:</label>
            <input
              id="firstPaymentDate"
              type="date"
              value={firstPaymentDate}
              onChange={(event) => setFirstPaymentDate(event.target.value)}
              onBlur={requestBlurSave}
            />
          </div>
          <div className="first-payment-row">
            <label htmlFor="firstPaymentAmount">Beløp:</label>
            <input
              id="firstPaymentAmount"
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              value={firstPaymentAmount}
              onChange={(event) => setFirstPaymentAmount(event.target.value)}
              onBlur={requestBlurSave}
            />
          </div>
          <div className="first-payment-row">
            <label htmlFor="firstPaymentKid">KID:</label>
            <input
              id="firstPaymentKid"
              type="text"
              inputMode="numeric"
              value={firstPaymentKid}
              onChange={(event) => setFirstPaymentKid(event.target.value)}
              onBlur={() => {
                const kid = String(firstPaymentKid || "").replace(/\s+/g, "").trim();
                if (kid && !isValidKid(kid)) {
                  window.alert("Ugyldig KID i Første innbetaling (modulus-sjekk feilet).");
                }
                requestBlurSave();
              }}
            />
          </div>
          <p className="first-payment-account">Kontonummer: {FIRST_PAYMENT_ACCOUNT}</p>
        </section>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Kreditorer</th>
                <th>Kontonr</th>
                <th>KID</th>
                <th>Beløp</th>
                <th>Saksnr/referanse</th>
                <th>Eier:</th>
              </tr>
            </thead>
            <tbody>
              {listRows.length === 0 ? (
                <tr>
                  <td colSpan={6}>Ingen linjer funnet i føringen.</td>
                </tr>
              ) : (
                listRows.map((row, index) => (
                  <tr key={`mail-row-${index}`}>
                    <td>{row.creditor}</td>
                    <td>{row.accountNumber}</td>
                    <td>{row.kid}</td>
                    <td>{row.amount}</td>
                    <td>{row.reference}</td>
                    <td>{row.owner}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <section className="customer-summary">
          <h3>Lån i Kraft Bank</h3>
          <div className="summary-row">
            <span>Sum føringer</span>
            <strong>{formatAmount(summary.sumForinger)}</strong>
          </div>
          <div className="summary-row honorar-row">
            <span>Kraft Bank honorar</span>
            <strong>{formatAmount(summary.kraftBankHonorar)}</strong>
          </div>
          <div className="summary-row total-row">
            <span>Total føring inkl. honorar</span>
            <strong>{formatAmount(summary.total)}</strong>
          </div>
        </section>
      </section>

      <p id="til-kunde-status">{statusText}</p>
    </>
  );
}
