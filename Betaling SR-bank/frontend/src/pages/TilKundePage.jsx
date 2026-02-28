import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { formatAmount, parseAmountInput, parseCustomerNoteFields } from "../utils";

export default function TilKundePage() {
  const { foringId } = useParams();
  const [statusText, setStatusText] = useState("");
  const [cloNumber, setCloNumber] = useState("");
  const [rows, setRows] = useState([]);
  const [kraftBankHonorar, setKraftBankHonorar] = useState("");

  useEffect(() => {
    let active = true;

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
        const entries = Array.isArray(payload.entries) ? payload.entries : [];
        setRows(entries);
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
          owner: noteInfo.owner,
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

  async function saveKraftBankHonorar() {
    try {
      const response = await fetch(`/api/foringer/${foringId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ etableringshonorar: kraftBankHonorar }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Ukjent feil." }));
        throw new Error(body.error || "Kunne ikke lagre Kraft Bank honorar.");
      }

      setStatusText("Kraft Bank honorar lagret.");
    } catch (error) {
      setStatusText(error.message || "Ukjent feil.");
    }
  }

  async function copyListToClipboard() {
    const header = ["Kreditorer", "Kontonr", "KID", "Beløp", "Saksnr/referanse", "Eier:"];
    const lines = [
      header.join("\t"),
      ...listRows.map((row) =>
        [row.creditor, row.accountNumber, row.kid, row.amount, row.reference, row.owner].join("\t")
      ),
    ];
    const text = lines.join("\n");

    try {
      await navigator.clipboard.writeText(text);
      setStatusText("Del 2-listen er kopiert.");
    } catch {
      setStatusText("Kunne ikke kopiere automatisk. Marker og kopier tabellen manuelt.");
    }
  }

  return (
    <>
      <h1>Til kunde</h1>
      <p>Foring CLO {cloNumber || ""}.</p>
      <p><Link className="download-link" to={`/foring/${foringId}`}>Tilbake til foring</Link></p>

      <section className="customer-section">
        <h2>Del 1: Tekst for sletting av pant</h2>
        <p className="customer-text">
          Vi har i dag overført xxx1- på konto xx2 for innfrielse. Beløpet oversendes under
          forutsetning av at tilknyttet pantedokument blir slettet omgående. Dersom beløpet ikke er
          korrekt eller at pantedokumentet av andre årsaker ikke kan slettes, imøteser vi omgående
          tilbakemelding om dette. I de tilfellene det er overskytende på konto, vennligst returner
          dette til konto 3207.22.78835 og benytt KID xxx3
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
            <label htmlFor="kraftBankHonorar">Kraft Bank honorar</label>
            <div className="honorar-actions">
              <input
                id="kraftBankHonorar"
                name="kraftBankHonorar"
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                value={kraftBankHonorar}
                onChange={(event) => setKraftBankHonorar(event.target.value)}
              />
              <button type="button" className="secondary-btn" onClick={saveKraftBankHonorar}>
                Lagre honorar
              </button>
            </div>
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
