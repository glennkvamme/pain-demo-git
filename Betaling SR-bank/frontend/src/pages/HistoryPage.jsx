import { useAuth0 } from "@auth0/auth0-react";
import { useEffect, useMemo, useState } from "react";
import { createApiClient } from "../apiClient";
import { extractFilenameFromDisposition } from "../utils";

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("nb-NO");
}

export default function HistoryPage() {
  const { getAccessTokenSilently } = useAuth0();
  const { authFetch } = useMemo(() => createApiClient(getAccessTokenSilently), [getAccessTokenSilently]);
  const [historyItems, setHistoryItems] = useState([]);
  const [statusText, setStatusText] = useState("");

  useEffect(() => {
    let active = true;

    async function loadHistory() {
      setStatusText("Henter historikk...");

      try {
        const response = await authFetch("/api/history");
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

  async function downloadHistoryFile(item) {
    setStatusText("Laster ned backup...");

    try {
      const response = await authFetch(`/api/history/${item.id}/download`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Kunne ikke laste ned fil." }));
        throw new Error(body.error || "Kunne ikke laste ned fil.");
      }

      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition");
      const filename = extractFilenameFromDisposition(disposition) || item.generatedFileName || "backup.xml";

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      setStatusText(`Lastet ned ${filename}.`);
    } catch (error) {
      setStatusText(error.message || "Ukjent feil.");
    }
  }

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
                    <button type="button" className="secondary-btn" onClick={() => downloadHistoryFile(item)}>
                      Last ned
                    </button>
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

