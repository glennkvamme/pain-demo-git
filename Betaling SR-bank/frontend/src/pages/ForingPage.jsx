import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  extractFilenameFromDisposition,
  formatAmount,
  getTodayIsoDate,
  isValidAccountNumber,
  isValidCustomerNoteFormat,
  isValidKid,
  parseAmountInput,
} from "../utils";

const INITIAL_ROWS = 25;
const STEP_ROWS = 5;

function createEmptyRow() {
  return {
    creditor: "",
    kid: "",
    customerNote: "",
    internalNote: "",
    accountNumber: "",
    amount: "",
    dueDate: getTodayIsoDate(),
    boligLaan: false,
  };
}

function normalizeIncomingRow(row) {
  return {
    creditor: String(row?.creditor || ""),
    kid: String(row?.kid || ""),
    customerNote: String(row?.customerNote || ""),
    internalNote: String(row?.internalNote || ""),
    accountNumber: String(row?.accountNumber || ""),
    amount: String(row?.amount || ""),
    dueDate: String(row?.dueDate || getTodayIsoDate()),
    boligLaan: Boolean(row?.boligLaan),
  };
}

export default function ForingPage() {
  const { foringId } = useParams();
  const [entries, setEntries] = useState(() =>
    Array.from({ length: INITIAL_ROWS }, (_, index) => ({ ...createEmptyRow(), boligLaan: index === 0 }))
  );
  const [caseHandler, setCaseHandler] = useState("");
  const [cloNumber, setCloNumber] = useState("");
  const [etableringshonorar, setEtableringshonorar] = useState("");
  const [foringStatus, setForingStatus] = useState("Pågående");
  const [statusText, setStatusText] = useState("");
  const [creditors, setCreditors] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadPageData() {
      setIsLoading(true);

      try {
        const [creditorsResponse, foringResponse] = await Promise.all([
          fetch("/api/creditors"),
          fetch(`/api/foringer/${foringId}`),
        ]);

        if (!creditorsResponse.ok) throw new Error("Kunne ikke hente kreditorliste.");
        if (!foringResponse.ok) {
          const body = await foringResponse.json().catch(() => ({ error: "Kunne ikke hente foring." }));
          throw new Error(body.error || "Kunne ikke hente foring.");
        }

        const creditorsPayload = await creditorsResponse.json();
        const foringPayload = await foringResponse.json();

        if (!active) return;

        setCreditors(Array.isArray(creditorsPayload) ? creditorsPayload : []);
        setCaseHandler(String(foringPayload.caseHandler || ""));
        setCloNumber(String(foringPayload.cloNumber || ""));
        setEtableringshonorar(String(foringPayload.etableringshonorar || ""));
        setForingStatus(String(foringPayload.status || "Pågående"));

        const incomingEntries = Array.isArray(foringPayload.entries)
          ? foringPayload.entries.map(normalizeIncomingRow)
          : [];

        let rows = incomingEntries.length > 0
          ? incomingEntries
          : Array.from({ length: INITIAL_ROWS }, (_, index) => ({ ...createEmptyRow(), boligLaan: index === 0 }));

        if (rows.length > 0) {
          const selectedIndex = rows.findIndex((row) => row.boligLaan);
          const normalizedIndex = selectedIndex >= 0 ? selectedIndex : 0;
          rows = rows.map((row, index) => ({ ...row, boligLaan: index === normalizedIndex }));
        }

        setEntries(rows);
      } catch (error) {
        if (!active) return;
        setStatusText(error.message || "Ukjent feil.");
      } finally {
        if (active) setIsLoading(false);
      }
    }

    loadPageData();
    return () => {
      active = false;
    };
  }, [foringId]);

  const creditorAccountByName = useMemo(() => {
    const map = new Map();
    for (const creditor of creditors) {
      const name = String(creditor?.name || "").trim().toLowerCase();
      if (!name) continue;
      map.set(name, String(creditor?.accountNumber || "").replace(/\s+/g, ""));
    }
    return map;
  }, [creditors]);

  const summary = useMemo(() => {
    let usedLines = 0;
    let totalAmount = 0;

    for (const row of entries) {
      const hasAnyValue =
        row.creditor.trim() ||
        row.kid.trim() ||
        row.customerNote.trim() ||
        row.internalNote.trim() ||
        row.accountNumber.trim() ||
        row.amount.trim();

      if (!hasAnyValue) continue;
      usedLines += 1;

      const parsed = parseAmountInput(row.amount);
      if (parsed) totalAmount += parsed;
    }

    return { usedLines, totalAmount };
  }, [entries]);

  const liveValidation = useMemo(() => {
    const invalidByRow = new Map();
    const messages = [];

    entries.forEach((row, index) => {
      const rowInvalid = { kid: false, accountNumber: false, customerNote: false };
      const kid = String(row.kid || "").replace(/\s+/g, "").trim();
      const accountNumber = String(row.accountNumber || "").replace(/\s+/g, "").trim();
      const customerNote = String(row.customerNote || "").trim();

      if (kid && !isValidKid(kid)) {
        rowInvalid.kid = true;
        messages.push(`Linje ${index + 1}: Ugyldig KID.`);
      }

      if (accountNumber && !isValidAccountNumber(accountNumber)) {
        rowInvalid.accountNumber = true;
        messages.push(`Linje ${index + 1}: Ugyldig kontonummer.`);
      }

      if (customerNote && !isValidCustomerNoteFormat(customerNote)) {
        rowInvalid.customerNote = true;
        messages.push(`Linje ${index + 1}: Notat til kunde ma ha format "Saksnr: ... | Eier: ...".`);
      }

      if (rowInvalid.kid || rowInvalid.accountNumber) {
        invalidByRow.set(index, rowInvalid);
      }
    });

    return {
      invalidByRow,
      hasInvalid: invalidByRow.size > 0,
      message: messages.length > 0 ? messages[0] : "",
    };
  }, [entries]);

  function hasInvalidField(rowIndex, field) {
    return Boolean(liveValidation.invalidByRow.get(rowIndex)?.[field]);
  }

  function updateRow(index, patch) {
    setEntries((prev) => prev.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function updateBoligLaan(index, value) {
    setEntries((prev) => {
      if (!value) {
        // Prevent zero selected: at least one row must be marked as boliglan.
        return prev;
      }
      return prev.map((row, rowIndex) => ({ ...row, boligLaan: rowIndex === index }));
    });
  }

  function handleCreditorChange(index, value) {
    const key = value.trim().toLowerCase();
    const predefinedAccount = creditorAccountByName.get(key);
    updateRow(index, {
      creditor: value,
      ...(predefinedAccount ? { accountNumber: predefinedAccount } : {}),
    });
  }

  function handleAmountBlur(index) {
    setEntries((prev) => {
      const row = prev[index];
      const parsed = parseAmountInput(row.amount);
      if (!parsed) return prev;

      const next = [...prev];
      next[index] = { ...row, amount: formatAmount(parsed) };
      return next;
    });
  }

  function handleKidBlur(index) {
    const kid = String(entries[index]?.kid || "").replace(/\s+/g, "").trim();
    if (kid && !isValidKid(kid)) {
      window.alert("Feil format i KID");
    }
  }

  function handleAccountBlur(index) {
    const accountNumber = String(entries[index]?.accountNumber || "").replace(/\s+/g, "").trim();
    if (accountNumber && !isValidAccountNumber(accountNumber)) {
      window.alert("Feil format i kontonummer");
    }
  }

  function addRows() {
    setEntries((prev) => [...prev, ...Array.from({ length: STEP_ROWS }, () => createEmptyRow())]);
    setStatusText(`La til ${STEP_ROWS} nye linjer.`);
  }

  async function saveForing(nextStatus) {
    const effectiveStatus = nextStatus || foringStatus;
    const payload = {
      cloNumber: cloNumber.trim(),
      caseHandler: caseHandler.trim(),
      etableringshonorar: etableringshonorar.trim(),
      entries,
      status: effectiveStatus,
    };

    const response = await fetch(`/api/foringer/${foringId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: "Ukjent feil." }));
      throw new Error(body.error || "Kunne ikke lagre foring.");
    }
  }

  async function handleSave() {
    if (!caseHandler.trim() || !cloNumber.trim()) {
      setStatusText("Saksbehandler og CLO nummer ma fylles ut.");
      return;
    }

    if (liveValidation.hasInvalid) {
      setStatusText("Rett ugyldig KID/kontonummer/notat før lagring.");
      return;
    }

    setStatusText("Lagrer foring...");
    try {
      await saveForing();
      setStatusText("Foring lagret.");
    } catch (error) {
      setStatusText(error.message || "Ukjent feil.");
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!caseHandler.trim() || !cloNumber.trim()) {
      setStatusText("Saksbehandler og CLO nummer ma fylles ut.");
      return;
    }

    if (liveValidation.hasInvalid) {
      setStatusText("Rett ugyldig KID/kontonummer/notat før XML-generering.");
      return;
    }

    const filteredEntries = entries.filter((row) => {
      return (
        row.creditor.trim() ||
        row.kid.trim() ||
        row.customerNote.trim() ||
        row.internalNote.trim() ||
        row.accountNumber.trim() ||
        row.amount.trim()
      );
    });

    if (filteredEntries.length === 0) {
      setStatusText("Fyll ut minst en linje for a generere XML.");
      return;
    }

    setStatusText(`Genererer XML for ${filteredEntries.length} foringer...`);

    try {
      await saveForing();

      const response = await fetch("/api/pain001", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          foringId,
          entries: filteredEntries,
          caseHandler: caseHandler.trim(),
          cloNumber: cloNumber.trim(),
          etableringshonorar: etableringshonorar.trim(),
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Ukjent feil." }));
        throw new Error(body.error || "Kunne ikke generere XML.");
      }

      const blob = await response.blob();
      const fileName = extractFilenameFromDisposition(response.headers.get("Content-Disposition")) || "pain001.xml";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      setStatusText(`Ferdig. XML-fil for ${filteredEntries.length} foringer er lastet ned.`);
    } catch (error) {
      setStatusText(error.message || "Ukjent feil.");
    }
  }

  if (isLoading) {
    return (
      <>
        <h1>Foring</h1>
        <p>Laster foring...</p>
      </>
    );
  }

  return (
    <>
      <h1>Foring CLO {cloNumber || ""}</h1>
      <p>Arbeidsdokument for foring. Lagre underveis og generer XML ved behov.</p>
      <p><Link className="download-link" to="/">Tilbake til foringsoversikt</Link></p>
      {liveValidation.hasInvalid ? (
        <p className="live-validation">{liveValidation.message}</p>
      ) : null}

      <form onSubmit={handleSubmit}>
        <datalist id="creditor-options">
          {creditors.map((creditor) => (
            <option key={creditor.id || creditor.name} value={creditor.name || ""} />
          ))}
        </datalist>

        <section className="summary-grid">
          <div className="summary-card">
            <span className="summary-label">Totalt belop</span>
            <strong>{formatAmount(summary.totalAmount)}</strong>
          </div>
          <div className="summary-card">
            <span className="summary-label">Antall linjer brukt</span>
            <strong>{summary.usedLines}</strong>
          </div>
        </section>

        <section className="meta-grid">
          <label htmlFor="etableringshonorar">Etableringshonorar</label>
          <input
            id="etableringshonorar"
            name="etableringshonorar"
            type="text"
            inputMode="decimal"
            placeholder="0,00"
            value={etableringshonorar}
            onChange={(event) => setEtableringshonorar(event.target.value)}
          />

          <label htmlFor="caseHandler">Saksbehandler</label>
          <input
            id="caseHandler"
            name="caseHandler"
            type="text"
            required
            value={caseHandler}
            onChange={(event) => setCaseHandler(event.target.value)}
          />

          <label htmlFor="cloNumber">CLO nummer</label>
          <input
            id="cloNumber"
            name="cloNumber"
            type="text"
            required
            value={cloNumber}
            onChange={(event) => setCloNumber(event.target.value)}
          />

          <label htmlFor="foringStatus">Status</label>
          <select
            id="foringStatus"
            name="foringStatus"
            value={foringStatus}
            onChange={(event) => setForingStatus(event.target.value)}
          >
            <option value="Pågående">Pågående</option>
            <option value="Avsluttet">Avsluttet</option>
            <option value="Utbetalt">Utbetalt</option>
          </select>
        </section>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Bolig lan</th>
                <th>#</th>
                <th>Kreditor</th>
                <th>KID</th>
                <th>Notat til kunde</th>
                <th>Internt notat</th>
                <th>Kontonummer</th>
                <th>Belop</th>
                <th>Dato for utbetaling</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((row, index) => (
                <tr key={`row-${index}`} className={row.boligLaan ? "row-boliglaan" : ""}>
                  <td>
                    <select
                      value={row.boligLaan ? "Ja" : "Nei"}
                      onChange={(event) => updateBoligLaan(index, event.target.value === "Ja")}
                    >
                      <option value="Ja">Ja</option>
                      <option value="Nei">Nei</option>
                    </select>
                  </td>
                  <td>{index + 1}</td>
                  <td>
                    <input
                      list="creditor-options"
                      value={row.creditor}
                      onChange={(event) => handleCreditorChange(index, event.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className={hasInvalidField(index, "kid") ? "input-invalid" : ""}
                      value={row.kid}
                      inputMode="numeric"
                      onChange={(event) => updateRow(index, { kid: event.target.value })}
                      onBlur={() => handleKidBlur(index)}
                    />
                  </td>
                  <td>
                    <input
                      className={hasInvalidField(index, "customerNote") ? "input-invalid" : ""}
                      placeholder="Saksnr: ... | Eier: ..."
                      maxLength={35}
                      value={row.customerNote}
                      onChange={(event) => updateRow(index, { customerNote: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      maxLength={140}
                      value={row.internalNote}
                      onChange={(event) => updateRow(index, { internalNote: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className={hasInvalidField(index, "accountNumber") ? "input-invalid" : ""}
                      value={row.accountNumber}
                      inputMode="numeric"
                      onChange={(event) => updateRow(index, { accountNumber: event.target.value })}
                      onBlur={() => handleAccountBlur(index)}
                    />
                  </td>
                  <td>
                    <input
                      value={row.amount}
                      inputMode="decimal"
                      onChange={(event) => updateRow(index, { amount: event.target.value })}
                      onBlur={() => handleAmountBlur(index)}
                    />
                  </td>
                  <td>
                    <input
                      type="date"
                      min={getTodayIsoDate()}
                      value={row.dueDate}
                      onChange={(event) => updateRow(index, { dueDate: event.target.value })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="actions">
          <button type="button" className="secondary-btn" onClick={handleSave}>
            Lagre foring
          </button>
          <button type="button" id="add-lines" onClick={addRows}>
            Flere linjer
          </button>
          <button type="submit">Generer XML</button>
        </div>
      </form>

      <p id="status">{statusText}</p>
    </>
  );
}
