import { useAuth0 } from "@auth0/auth0-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createApiClient } from "../apiClient";

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "";
  return date.toLocaleString("nb-NO");
}

export default function DashboardPage() {
  const { getAccessTokenSilently, user } = useAuth0();
  const { authFetch } = useMemo(() => createApiClient(getAccessTokenSilently), [getAccessTokenSilently]);
  const [foringer, setForinger] = useState([]);
  const [cloNumber, setCloNumber] = useState("");
  const [caseHandler, setCaseHandler] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [statusFilter, setStatusFilter] = useState("Pågående");
  const navigate = useNavigate();

  async function loadForinger() {
    try {
      const response = await authFetch("/api/foringer");
      if (!response.ok) throw new Error("Kunne ikke hente foringsliste.");
      const payload = await response.json();
      setForinger(Array.isArray(payload) ? payload : []);
    } catch (error) {
      setStatusText(error.message || "Ukjent feil.");
    }
  }

  useEffect(() => {
    loadForinger();
  }, []);

  async function createForing() {
    if (!cloNumber.trim() || !caseHandler.trim()) {
      setStatusText("CLO nummer og saksbehandler ma fylles ut.");
      return;
    }

    setStatusText("Oppretter foring...");
    try {
      const response = await authFetch("/api/foringer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cloNumber: cloNumber.trim(),
          caseHandler: caseHandler.trim(),
          createdByEmail: String(user?.email || "").trim(),
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: "Ukjent feil." }));
        throw new Error(body.error || "Kunne ikke opprette foring.");
      }

      const created = await response.json();
      setStatusText("Foring opprettet.");
      setShowCreateModal(false);
      navigate(`/foring/${created.id}`);
    } catch (error) {
      setStatusText(error.message || "Ukjent feil.");
    }
  }

  function openCreateModal() {
    setStatusText("");
    setShowCreateModal(true);
  }

  function closeCreateModal() {
    setShowCreateModal(false);
  }

  async function handleCreateSubmit(event) {
    event.preventDefault();
    await createForing();
  }

  const filteredForinger = useMemo(
    () => foringer.filter((item) => String(item.status || "Pågående") === statusFilter),
    [foringer, statusFilter]
  );

  return (
    <>
      <h1>Oversikt</h1>
      <p>Liste over alle foringer.</p>

      <div className="actions actions-left">
        <button type="button" onClick={openCreateModal}>Opprett ny kreditorliste</button>
        <button type="button" className="secondary-btn" onClick={loadForinger}>
          Oppdater liste
        </button>
      </div>

      <div className="actions actions-left">
        <button
          type="button"
          className={statusFilter === "Pågående" ? "" : "secondary-btn"}
          onClick={() => setStatusFilter("Pågående")}
        >
          Pågående saker
        </button>
        <button
          type="button"
          className={statusFilter === "Utbetalt" ? "" : "secondary-btn"}
          onClick={() => setStatusFilter("Utbetalt")}
        >
          Utbetalte saker
        </button>
        <button
          type="button"
          className={statusFilter === "Avsluttet" ? "" : "secondary-btn"}
          onClick={() => setStatusFilter("Avsluttet")}
        >
          Avsluttede saker
        </button>
      </div>

      {showCreateModal ? (
        <div className="modal-backdrop" role="presentation" onClick={closeCreateModal}>
          <section
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-foring-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="new-foring-title">Opprett ny kreditorliste</h2>
            <form onSubmit={handleCreateSubmit}>
              <section className="meta-grid">
                <label htmlFor="newCloNumber">Nytt CLO nummer</label>
                <input
                  id="newCloNumber"
                  name="newCloNumber"
                  type="text"
                  required
                  value={cloNumber}
                  onChange={(event) => setCloNumber(event.target.value)}
                />

                <label htmlFor="newCaseHandler">Saksbehandler</label>
                <input
                  id="newCaseHandler"
                  name="newCaseHandler"
                  type="text"
                  required
                  value={caseHandler}
                  onChange={(event) => setCaseHandler(event.target.value)}
                />
              </section>

              <div className="actions actions-left modal-actions">
                <button type="submit">Opprett</button>
                <button type="button" className="secondary-btn" onClick={closeCreateModal}>
                  Avbryt
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Handling</th>
              <th>CLO nummer</th>
              <th>Saksbehandler</th>
              <th>Opprettet</th>
              <th>Status</th>
              <th>Opprettet av</th>
            </tr>
          </thead>
          <tbody>
            {filteredForinger.length === 0 ? (
              <tr>
                <td colSpan={6}>Ingen saker funnet for valgt status.</td>
              </tr>
            ) : (
              filteredForinger.map((item, index) => (
                <tr key={item.id || `foring-${index}`}>
                  <td>
                    <Link className="table-action-btn" to={`/foring/${item.id}`}>
                      Åpne kreditorliste
                    </Link>
                  </td>
                  <td>{item.cloNumber || ""}</td>
                  <td>{item.caseHandler || ""}</td>
                  <td>{formatDate(item.createdAt)}</td>
                  <td>{item.status || "Pågående"}</td>
                  <td>{item.createdByEmail || ""}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p id="status">{statusText}</p>
    </>
  );
}

