import { useEffect, useState } from "react";
import { isValidMod11 } from "../utils";

function createCreditor() {
  return { id: "", name: "", accountNumber: "" };
}

export default function CreditorsPage() {
  const [rows, setRows] = useState([]);
  const [statusText, setStatusText] = useState("");

  async function loadCreditors() {
    setStatusText("Henter kreditorliste...");

    try {
      const response = await fetch("/api/creditors");
      if (!response.ok) throw new Error("Kunne ikke hente kreditorliste.");
      const creditors = await response.json();
      setRows(Array.isArray(creditors) && creditors.length > 0 ? creditors : [createCreditor()]);
      setStatusText(`Lastet ${Array.isArray(creditors) ? creditors.length : 0} kreditorer.`);
    } catch (error) {
      setStatusText(error.message || "Ukjent feil.");
    }
  }

  useEffect(() => {
    loadCreditors();
  }, []);

  function updateRow(index, patch) {
    setRows((prev) => prev.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((prev) => [...prev, createCreditor()]);
    setStatusText("La til ny rad.");
  }

  function removeRow(index) {
    setRows((prev) => {
      const next = prev.filter((_, rowIndex) => rowIndex !== index);
      return next.length > 0 ? next : [createCreditor()];
    });
  }

  async function saveRows() {
    const creditors = [];

    for (let i = 0; i < rows.length; i += 1) {
      const line = i + 1;
      const item = rows[i];
      const name = String(item.name || "").trim();
      const accountNumber = String(item.accountNumber || "").replace(/\s+/g, "").trim();

      if (!name && !accountNumber) continue;

      if (accountNumber && (!/^\d{11}$/.test(accountNumber) || !isValidMod11(accountNumber))) {
        setStatusText(`Linje ${line}: Ugyldig kontonummer (modulus-sjekk feilet).`);
        return;
      }

      creditors.push({
        id: item.id || "",
        name,
        accountNumber,
      });
    }

    setStatusText("Lagrer kreditorliste...");

    try {
      const response = await fetch("/api/creditors", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creditors }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Ukjent feil." }));
        throw new Error(body.error || "Kunne ikke lagre kreditorliste.");
      }

      await loadCreditors();
      setStatusText("Kreditorlisten er lagret.");
    } catch (error) {
      setStatusText(error.message || "Ukjent feil.");
    }
  }

  return (
    <>
      <h1>Vedlikehold kreditorliste</h1>
      <p>Rediger kreditorer og eventuelle forhandsdefinerte kontonummer.</p>

      <div className="actions actions-left">
        <button type="button" onClick={addRow}>Legg til kreditor</button>
        <button type="button" onClick={saveRows}>Lagre liste</button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Kreditor</th>
              <th>Kontonummer (11 sifre)</th>
              <th>Handling</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id || `new-${index}`}>
                <td>{index + 1}</td>
                <td>
                  <input
                    value={row.name || ""}
                    onChange={(event) => updateRow(index, { name: event.target.value })}
                  />
                </td>
                <td>
                  <input
                    value={row.accountNumber || ""}
                    inputMode="numeric"
                    onChange={(event) => updateRow(index, { accountNumber: event.target.value })}
                  />
                </td>
                <td>
                  <button type="button" className="delete-btn" onClick={() => removeRow(index)}>Slett</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p id="creditors-status">{statusText}</p>
    </>
  );
}
