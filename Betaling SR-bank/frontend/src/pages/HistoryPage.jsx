import { useEffect, useState } from "react";

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("nb-NO");
}

export default function HistoryPage() {
  const [historyItems, setHistoryItems] = useState([]);
  const [statusText, setStatusText] = useState("");

  useEffect(() => {
    let active = true;

    async function loadHistory() {
      setStatusText("Henter historikk...");

      try {
        const response = await fetch("/api/history");
        if (!response.ok) throw new Error("Kunne ikke hente historikk.");
        const items = await response.json();

        if (!active) return;
        setHistoryItems(Array.isArray(items) ? items : []);
        setStatusText(`Lastet ${Array.isArray(items) ? items.length : 0} historikk-oppforinger.`);
      } catch (error) {
        if (!active) return;
        setStatusText(error.message || "Ukjent feil.");
      }
    }

    loadHistory();
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <h1>Historikk og backup</h1>
      <p>Viser genererte filer med saksbehandler og CLO nummer.</p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Opprettet</th>
              <th>Saksbehandler</th>
              <th>CLO nummer</th>
              <th>Antall linjer</th>
              <th>Fil</th>
              <th>Backup</th>
            </tr>
          </thead>
          <tbody>
            {historyItems.length === 0 ? (
              <tr>
                <td colSpan={7}>Ingen historikk funnet.</td>
              </tr>
            ) : (
              historyItems.map((item, index) => (
                <tr key={item.id || `history-${index}`}>
                  <td>{index + 1}</td>
                  <td>{formatDate(item.createdAt)}</td>
                  <td>{item.caseHandler || ""}</td>
                  <td>{item.cloNumber || ""}</td>
                  <td>{item.transactionsCount || 0}</td>
                  <td>{item.generatedFileName || ""}</td>
                  <td>
                    <a className="download-link" href={`/api/history/${item.id}/download`}>
                      Last ned
                    </a>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p id="history-status">{statusText}</p>
    </>
  );
}
