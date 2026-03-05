import { useAuth0 } from "@auth0/auth0-react";
import { useEffect, useMemo, useState } from "react";
import { createApiClient } from "../apiClient";

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "";
  return date.toLocaleString("nb-NO");
}

function formatChanges(changes) {
  if (!Array.isArray(changes) || changes.length === 0) {
    return "";
  }

  return changes
    .map((change) => `${change.field}: "${change.oldValue ?? ""}" -> "${change.newValue ?? ""}"`)
    .join(" | ");
}

export default function LoggPage() {
  const { getAccessTokenSilently } = useAuth0();
  const { authFetch } = useMemo(() => createApiClient(getAccessTokenSilently), [getAccessTokenSilently]);
  const [items, setItems] = useState([]);
  const [statusText, setStatusText] = useState("");
  const [eventType, setEventType] = useState("");
  const [actorEmail, setActorEmail] = useState("");
  const [foringId, setForingId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  async function loadLogs() {
    setStatusText("Henter logg...");

    try {
      const query = new URLSearchParams();
      query.set("limit", "300");
      if (eventType.trim()) query.set("eventType", eventType.trim());
      if (actorEmail.trim()) query.set("actorEmail", actorEmail.trim());
      if (foringId.trim()) query.set("foringId", foringId.trim());
      if (dateFrom) query.set("dateFrom", dateFrom);
      if (dateTo) query.set("dateTo", dateTo);

      const response = await authFetch(`/api/logs?${query.toString()}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Kunne ikke hente logg." }));
        throw new Error(body.error || "Kunne ikke hente logg.");
      }

      const payload = await response.json();
      const next = Array.isArray(payload) ? payload : [];
      setItems(next);
      setStatusText(`Lastet ${next.length} logghendelser.`);
    } catch (error) {
      setStatusText(error.message || "Ukjent feil.");
    }
  }

  useEffect(() => {
    loadLogs();
  }, []);

  function handleSubmit(event) {
    event.preventDefault();
    loadLogs();
  }

  return (
    <>
      <h1>Logg</h1>
      <p>Viser sikkerhets- og endringslogg for systemet.</p>
      <h2>Søk</h2>

      <form onSubmit={handleSubmit} className="meta-grid">
        <label htmlFor="log-event-type">Hendelsestype</label>
        <input
          id="log-event-type"
          type="text"
          value={eventType}
          onChange={(event) => setEventType(event.target.value)}
          placeholder="foring_updated, login_success"
        />

        <label htmlFor="log-actor-email">E-post</label>
        <input
          id="log-actor-email"
          type="text"
          value={actorEmail}
          onChange={(event) => setActorEmail(event.target.value)}
          placeholder="bruker@domene.no"
        />

        <label htmlFor="log-foring-id">Foring-ID</label>
        <input
          id="log-foring-id"
          type="text"
          value={foringId}
          onChange={(event) => setForingId(event.target.value)}
        />

        <label htmlFor="log-date-from">Fra dato</label>
        <input
          id="log-date-from"
          type="date"
          value={dateFrom}
          onChange={(event) => setDateFrom(event.target.value)}
        />

        <label htmlFor="log-date-to">Til dato</label>
        <input
          id="log-date-to"
          type="date"
          value={dateTo}
          onChange={(event) => setDateTo(event.target.value)}
        />
      </form>

      <div className="actions actions-left">
        <button type="button" className="secondary-btn" onClick={loadLogs}>Oppdater logg</button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tidspunkt</th>
              <th>Hendelse</th>
              <th>Bruker</th>
              <th>Foring</th>
              <th>CLO</th>
              <th>Endringer</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={7}>Ingen logghendelser funnet.</td>
              </tr>
            ) : (
              items.map((item, index) => (
                <tr key={`${item.timestampUtc || "log"}-${index}`}>
                  <td>{formatDate(item.timestampUtc)}</td>
                  <td>{item.eventType || ""}</td>
                  <td>{item.actorEmail || item.actorUserId || ""}</td>
                  <td>{item.foringId || item.entityId || ""}</td>
                  <td>{item.cloNumber || ""}</td>
                  <td>{formatChanges(item.changes)}</td>
                  <td>{item.ip || ""}</td>
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
