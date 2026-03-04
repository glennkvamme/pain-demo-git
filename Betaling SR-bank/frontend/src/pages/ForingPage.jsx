import { useAuth0 } from "@auth0/auth0-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  extractFilenameFromDisposition,
  formatAmount,
  getTodayIsoDate,
  hasAllowedCustomerNoteChars,
  isValidAccountNumber,
  isValidKid,
  parseCustomerNoteFields,
  parseAmountInput,
} from "../utils";
import { createApiClient } from "../apiClient";

const INITIAL_ROWS = 5;
const STEP_ROWS = 5;
const AUTOSAVE_DELAY_MS = 1500;

function nowIsoTimestamp() {
  return new Date().toISOString();
}

function formatMetaAmountValue(rawValue) {
  const parsed = parseAmountInput(rawValue);
  if (!parsed) return String(rawValue || "");
  return formatAmount(parsed);
}

function formatRowTimestamp(value) {
  const iso = String(value || "").trim();
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("nb-NO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function rowHasUserContent(row) {
  return Boolean(
    String(row?.creditor || "").trim() ||
      String(row?.kid || "").trim() ||
      String(row?.customerNote || "").trim() ||
      String(row?.internalNote || "").trim() ||
      String(row?.kommentar || "").trim() ||
      String(row?.accountNumber || "").trim() ||
      String(row?.amount || "").trim() ||
      String(row?.owner || "").trim() ||
      String(row?.dueDate || "").trim() ||
      String(row?.typeKrav || "").trim() ||
      String(row?.source || "").trim()
  );
}

function createEmptyRow(hovedlantaker = "") {
  return {
    creditor: "",
    kid: "",
    owner: "",
    source: "",
    customerNote: "",
    internalNote: "",
    kommentar: "",
    accountNumber: "",
    amount: "",
    dueDate: "",
    lineNumber: null,
    infridd: true,
    typeKrav: "",
    rowUpdatedAt: "",
    boligLaan: false,
  };
}

function normalizeIncomingRow(row, hovedlantaker = "") {
  const parsedNote = parseCustomerNoteFields(row?.customerNote);
  const normalizedSource = String(row?.source || "").trim();
  const hasUserContent = rowHasUserContent(row);
  const source = ["Inkassoregister", "Rammelån Gjeldsregister", "Nedbetalingslån Gjeldsregister", "annet"].includes(normalizedSource)
    ? normalizedSource
    : (hasUserContent ? "annet" : "");
  return {
    creditor: String(row?.creditor || ""),
    kid: String(row?.kid || ""),
    owner: String(row?.owner || (hasUserContent ? parsedNote.owner || hovedlantaker || "" : "")),
    source,
    customerNote: String(row?.customerNote || ""),
    internalNote: String(row?.internalNote || ""),
    kommentar: String(row?.kommentar || ""),
    accountNumber: String(row?.accountNumber || ""),
    amount: String(row?.amount || ""),
    dueDate: String(row?.dueDate || (hasUserContent ? getTodayIsoDate() : "")),
    lineNumber: Number.isInteger(row?.lineNumber) && row.lineNumber > 0 ? row.lineNumber : null,
    infridd: typeof row?.infridd === "boolean" ? row.infridd : true,
    typeKrav: ["Pant", "Utlegg", "Inkasso", "Annet"].includes(String(row?.typeKrav || ""))
      ? String(row.typeKrav)
      : (hasUserContent ? "Annet" : ""),
    rowUpdatedAt: String(row?.rowUpdatedAt || (hasUserContent ? nowIsoTimestamp() : "")),
    boligLaan: Boolean(row?.boligLaan),
  };
}

function ensureLockedLineNumbers(rows, nextLineNumberRef) {
  const nextRows = rows.map((row) => ({ ...row }));
  let nextLineNumber = Number(nextLineNumberRef?.current || 1);
  if (!Number.isInteger(nextLineNumber) || nextLineNumber < 1) {
    nextLineNumber = 1;
  }

  for (const row of nextRows) {
    const existingLineNumber = Number(row?.lineNumber || 0);
    if (Number.isInteger(existingLineNumber) && existingLineNumber >= nextLineNumber) {
      nextLineNumber = existingLineNumber + 1;
    }
  }

  for (let i = 0; i < nextRows.length; i += 1) {
    const row = nextRows[i];
    const hasLineNumber = Number.isInteger(row.lineNumber) && row.lineNumber > 0;
    if (hasLineNumber) continue;
    if (!rowHasUserContent(row)) continue;
    row.lineNumber = nextLineNumber;
    nextLineNumber += 1;
  }

  if (nextLineNumberRef) {
    nextLineNumberRef.current = nextLineNumber;
  }

  return nextRows;
}

export default function ForingPage() {
  const { getAccessTokenSilently } = useAuth0();
  const { authFetch } = useMemo(() => createApiClient(getAccessTokenSilently), [getAccessTokenSilently]);
  const { foringId } = useParams();
  const [entries, setEntries] = useState(() =>
    Array.from({ length: INITIAL_ROWS }, (_, index) => ({ ...createEmptyRow(""), boligLaan: index === 0 }))
  );
  const [caseHandler, setCaseHandler] = useState("");
  const [cloNumber, setCloNumber] = useState("");
  const [hovedlantaker, setHovedlantaker] = useState("");
  const [lantakere, setLantakere] = useState([]);
  const [innvilgetLaanMedPant, setInnvilgetLaanMedPant] = useState("");
  const [innvilgetUsikretLaan, setInnvilgetUsikretLaan] = useState("");
  const [etableringshonorar, setEtableringshonorar] = useState("");
  const [foringStatus, setForingStatus] = useState("Pågående");
  const [statusText, setStatusText] = useState("");
  const [showImportModal, setShowImportModal] = useState(false);
  const [importMode, setImportMode] = useState("inkasso");
  const [importText, setImportText] = useState("");
  const [importPreviewRows, setImportPreviewRows] = useState([]);
  const [importPreviewError, setImportPreviewError] = useState("");
  const [creditors, setCreditors] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoaded, setIsLoaded] = useState(false);
  const [metaSaveTrigger, setMetaSaveTrigger] = useState(0);
  const [entrySaveTrigger, setEntrySaveTrigger] = useState(0);
  const lastSavedMetaSignatureRef = useRef("");
  const lastSavedForingSignatureRef = useRef("");
  const blurMetaSaveRequestedRef = useRef(false);
  const blurEntrySaveRequestedRef = useRef(false);
  const nextLineNumberRef = useRef(1);

  useEffect(() => {
    let active = true;
    setIsLoaded(false);

    async function loadPageData() {
      setIsLoading(true);

      try {
        const [creditorsResponse, foringResponse] = await Promise.all([
          authFetch("/api/creditors"),
          authFetch(`/api/foringer/${foringId}`),
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
        const loadedHovedlantaker = String(foringPayload.hovedlantaker || "");
        setHovedlantaker(loadedHovedlantaker);
        setLantakere(
          Array.isArray(foringPayload.lantakere)
            ? foringPayload.lantakere.map((value) => String(value || "")).filter((value) => value.trim())
            : []
        );
        setInnvilgetLaanMedPant(formatMetaAmountValue(foringPayload.innvilgetLaanMedPant));
        setInnvilgetUsikretLaan(formatMetaAmountValue(foringPayload.innvilgetUsikretLaan));
        setEtableringshonorar(formatMetaAmountValue(foringPayload.etableringshonorar));
        setForingStatus(String(foringPayload.status || "Pågående"));

        const incomingEntries = Array.isArray(foringPayload.entries)
          ? foringPayload.entries.map((row) => normalizeIncomingRow(row, loadedHovedlantaker))
          : [];

        let rows = incomingEntries.length > 0
          ? incomingEntries
          : Array.from({ length: INITIAL_ROWS }, (_, index) => ({
              ...createEmptyRow(loadedHovedlantaker),
              boligLaan: index === 0,
            }));

        if (rows.length > 0) {
          const selectedIndex = rows.findIndex((row) => row.boligLaan);
          const normalizedIndex = selectedIndex >= 0 ? selectedIndex : 0;
          rows = rows.map((row, index) => ({ ...row, boligLaan: index === normalizedIndex }));
        }

        const maxLoadedLineNumber = rows.reduce((max, row) => {
          const value = Number(row?.lineNumber || 0);
          return Number.isInteger(value) && value > max ? value : max;
        }, 0);
        const persistedLastAssigned = Number(foringPayload?.lastAssignedLineNumber || 0);
        const lastAssigned = Math.max(maxLoadedLineNumber, Number.isInteger(persistedLastAssigned) ? persistedLastAssigned : 0);
        nextLineNumberRef.current = Math.max(1, lastAssigned + 1);
        setEntries(ensureLockedLineNumbers(rows, nextLineNumberRef));
        setIsLoaded(true);
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

  const creditorAccountsByName = useMemo(() => {
    const map = new Map();
    for (const creditor of creditors) {
      const name = String(creditor?.name || "").trim().toLowerCase();
      if (!name) continue;
      map.set(name, String(creditor?.accountNumber || "").replace(/\s+/g, ""));
    }
    return map;
  }, [creditors]);

  const ownerOptions = useMemo(() => {
    const raw = [hovedlantaker, ...lantakere]
      .map((value) => String(value || "").trim())
      .filter((value) => value.length > 0);
    return Array.from(new Set(raw));
  }, [hovedlantaker, lantakere]);

  const summary = useMemo(() => {
    let usedLines = 0;
    let plannedAmount = 0;

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
      if (parsed && row.infridd) plannedAmount += parsed;
    }

    const pantAmount = parseAmountInput(innvilgetLaanMedPant) || 0;
    const usikretAmount = parseAmountInput(innvilgetUsikretLaan) || 0;
    const remainingLoanFrame = pantAmount + usikretAmount - plannedAmount;

    return { usedLines, plannedAmount, remainingLoanFrame };
  }, [entries, innvilgetLaanMedPant, innvilgetUsikretLaan]);

  const liveValidation = useMemo(() => {
    const invalidByRow = new Map();
    const messages = [];

    entries.forEach((row, index) => {
      const rowInvalid = { kid: false, accountNumber: false };
      const kid = String(row.kid || "").replace(/\s+/g, "").trim();
      const accountNumber = String(row.accountNumber || "").replace(/\s+/g, "").trim();

      if (kid && !isValidKid(kid)) {
        rowInvalid.kid = true;
        messages.push(`Linje ${index + 1}: Ugyldig KID.`);
      }

      if (accountNumber && !isValidAccountNumber(accountNumber)) {
        rowInvalid.accountNumber = true;
        messages.push(`Linje ${index + 1}: Ugyldig kontonummer.`);
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

  function buildMetaPayload(nextStatus) {
    const effectiveStatus = nextStatus || foringStatus;
    return {
      cloNumber: cloNumber.trim(),
      caseHandler: caseHandler.trim(),
      hovedlantaker: hovedlantaker.trim(),
      lantakere: lantakere.map((value) => String(value || "").trim()).filter((value) => value.length > 0),
      innvilgetLaanMedPant: innvilgetLaanMedPant.trim(),
      innvilgetUsikretLaan: innvilgetUsikretLaan.trim(),
      etableringshonorar: etableringshonorar.trim(),
      lastAssignedLineNumber: Math.max(0, Number(nextLineNumberRef.current || 1) - 1),
      status: effectiveStatus,
    };
  }

  function buildForingPayload(nextStatus) {
    return {
      ...buildMetaPayload(nextStatus),
      entries,
    };
  }

  function markCurrentPayloadsAsSaved() {
    lastSavedMetaSignatureRef.current = JSON.stringify(buildMetaPayload());
    lastSavedForingSignatureRef.current = JSON.stringify(buildForingPayload());
  }

  function requestMetaSave() {
    blurMetaSaveRequestedRef.current = true;
    setMetaSaveTrigger((value) => value + 1);
  }

  function requestEntrySave() {
    blurEntrySaveRequestedRef.current = true;
    setEntrySaveTrigger((value) => value + 1);
  }

  useEffect(() => {
    if (!isLoaded) return;
    markCurrentPayloadsAsSaved();
  }, [isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!caseHandler.trim() || !cloNumber.trim() || !hovedlantaker.trim()) return;
    const immediate = blurMetaSaveRequestedRef.current;
    blurMetaSaveRequestedRef.current = false;

    const timer = window.setTimeout(async () => {
      try {
        await saveForingMeta();
      } catch (error) {
        setStatusText(error.message || "Ukjent feil.");
      }
    }, immediate ? 0 : AUTOSAVE_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    isLoaded,
    caseHandler,
    cloNumber,
    hovedlantaker,
    lantakere,
    innvilgetLaanMedPant,
    innvilgetUsikretLaan,
    etableringshonorar,
    foringStatus,
    metaSaveTrigger,
  ]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!caseHandler.trim() || !cloNumber.trim() || !hovedlantaker.trim()) return;
    if (liveValidation.hasInvalid) return;
    const immediate = blurEntrySaveRequestedRef.current;
    blurEntrySaveRequestedRef.current = false;

    const timer = window.setTimeout(async () => {
      try {
        await saveForing();
      } catch (error) {
        setStatusText(error.message || "Ukjent feil.");
      }
    }, immediate ? 0 : AUTOSAVE_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    isLoaded,
    entries,
    caseHandler,
    cloNumber,
    hovedlantaker,
    liveValidation.hasInvalid,
    entrySaveTrigger,
  ]);

  function withTouchedRow(row, patch) {
    const next = { ...row, ...patch };
    const used = rowHasUserContent(next);

    if (used) {
      if (!String(next.owner || "").trim() && String(hovedlantaker || "").trim()) {
        next.owner = hovedlantaker;
      }
      if (!String(next.source || "").trim()) {
        next.source = "annet";
      }
      if (!String(next.typeKrav || "").trim()) {
        next.typeKrav = "Annet";
      }
      if (!String(next.dueDate || "").trim()) {
        next.dueDate = getTodayIsoDate();
      }
      next.rowUpdatedAt = nowIsoTimestamp();
      return next;
    }

    return {
      ...next,
      owner: "",
      source: "",
      typeKrav: "",
      dueDate: "",
      infridd: true,
      rowUpdatedAt: "",
    };
  }

  function updateRow(index, patch) {
    setEntries((prev) => ensureLockedLineNumbers(prev.map((row, rowIndex) => (rowIndex === index ? withTouchedRow(row, patch) : row)), nextLineNumberRef));
  }

  function handleHovedlantakerChange(value) {
    const nextValue = value;
    setEntries((prev) =>
      ensureLockedLineNumbers(prev.map((row) => {
        if (!rowHasUserContent(row)) {
          return row;
        }

        const ownerRaw = String(row.owner || "");
        if (!ownerRaw.trim() || ownerRaw === hovedlantaker) {
          return withTouchedRow(row, { owner: nextValue });
        }
        return row;
      }), nextLineNumberRef)
    );
    setHovedlantaker(nextValue);
  }

  function addLantakerField() {
    setLantakere((prev) => [...prev, ""]);
  }

  function updateLantaker(index, value) {
    setLantakere((prev) => prev.map((item, itemIndex) => (itemIndex === index ? value : item)));
  }

  function updateBoligLaan(index, value) {
    setEntries((prev) => {
      if (!value) {
        // Prevent zero selected: at least one row must be marked as boliglan.
        return prev;
      }
      return ensureLockedLineNumbers(prev.map((row, rowIndex) => {
        const shouldBeBoligLaan = rowIndex === index;
        if (row.boligLaan === shouldBeBoligLaan) return row;
        return withTouchedRow(row, { boligLaan: shouldBeBoligLaan });
      }), nextLineNumberRef);
    });
  }

  function removeRow(index) {
    setEntries((prev) => {
      const next = prev.filter((_, rowIndex) => rowIndex !== index);
      if (next.length === 0) {
        return [{ ...createEmptyRow(hovedlantaker), boligLaan: true }];
      }

      if (!next.some((row) => row.boligLaan)) {
        next[0] = { ...next[0], boligLaan: true };
      }

      return ensureLockedLineNumbers(next, nextLineNumberRef);
    });
  }

  function handleCreditorChange(index, value) {
    const key = value.trim().toLowerCase();
    const predefinedAccountNumber = creditorAccountsByName.get(key);
    updateRow(index, {
      creditor: value,
      ...(predefinedAccountNumber ? { accountNumber: predefinedAccountNumber } : {}),
    });
  }

  function handleAmountBlur(index) {
    setEntries((prev) => {
      const row = prev[index];
      const parsed = parseAmountInput(row.amount);
      if (!parsed) return prev;

      const next = [...prev];
      next[index] = withTouchedRow(row, { amount: formatAmount(parsed) });
      return ensureLockedLineNumbers(next, nextLineNumberRef);
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

  function handleCustomerNoteChange(index, value) {
    const kid = String(entries[index]?.kid || "").replace(/\s+/g, "").trim();
    if (kid && String(value || "").trim()) {
      window.alert("Kan ikke bruke notat til kunde når man har KID");
      return;
    }

    if (!hasAllowedCustomerNoteChars(value)) {
      window.alert("Notat til kunde inneholder ugyldige tegn. Bruk bokstaver, tall og vanlig tegnsetting.");
      return;
    }

    updateRow(index, { customerNote: value });
  }

  function addRows() {
    setEntries((prev) => ensureLockedLineNumbers([...prev, ...Array.from({ length: STEP_ROWS }, () => createEmptyRow(hovedlantaker))], nextLineNumberRef));
    setStatusText(`La til ${STEP_ROWS} nye linjer.`);
  }

  function setTodayOnAllRows() {
    const today = getTodayIsoDate();
    const updatedAt = nowIsoTimestamp();

    setEntries((prev) => prev.map((row) => ({
      ...row,
      dueDate: today,
      rowUpdatedAt: rowHasUserContent(row) ? updatedAt : row.rowUpdatedAt,
    })));
    setStatusText("Satte dagens dato på alle linjer.");
  }

  function isImportTargetEmpty(row) {
    return !(
      String(row.creditor || "").trim() ||
      String(row.kid || "").trim() ||
      String(row.customerNote || "").trim() ||
      String(row.internalNote || "").trim() ||
      String(row.kommentar || "").trim() ||
      String(row.accountNumber || "").trim() ||
      String(row.amount || "").trim()
    );
  }

  function isLikelyHeaderLine(line) {
    return /^kreditor\s*\t\s*kontonummer\s*\t\s*kid/i.test(line);
  }

  function isLikelyAccountNumber(value) {
    const account = String(value || "").replace(/\s+/g, "");
    return /^\d{11}$/.test(account);
  }

  function extractParsedRowFromParts(parts, creditorContext = "") {
    if (!Array.isArray(parts) || parts.length < 3) return null;

    const cleanParts = parts.map((part) => String(part || "").trim());
    const first = cleanParts[0] || "";
    const second = cleanParts[1] || "";
    const third = cleanParts[2] || "";
    const fourth = cleanParts[3] || "";

    // Case 1: one-line row with creditor in first column.
    // Kreditor | Kontonummer | KID | Belop | ...
    if (!isLikelyAccountNumber(first) && isLikelyAccountNumber(second) && cleanParts.length >= 4) {
      const creditor = first.replace(/^[\u25B6\u25B8\u25BA\u25CF\u2022]\s*/, "").trim();
      const accountNumber = second.replace(/\s+/g, "");
      const kid = third.replace(/\s+/g, "");
      const parsedAmount = parseAmountInput(fourth.replace(/\s+/g, ""));
      if (creditor && accountNumber && kid && parsedAmount) {
        return {
          creditor,
          accountNumber,
          kid,
          amount: formatAmount(parsedAmount),
        };
      }
      return null;
    }

    // Case 2: two-line row where creditor is on previous line.
    // <Kreditor line>
    // Kontonummer | KID | Belop | ...
    if (isLikelyAccountNumber(first) && creditorContext) {
      const creditor = creditorContext.replace(/^[\u25B6\u25B8\u25BA\u25CF\u2022]\s*/, "").trim();
      const accountNumber = first.replace(/\s+/g, "");
      const kid = second.replace(/\s+/g, "");
      const parsedAmount = parseAmountInput(third.replace(/\s+/g, ""));
      if (creditor && accountNumber && kid && parsedAmount) {
        return {
          creditor,
          accountNumber,
          kid,
          amount: formatAmount(parsedAmount),
        };
      }
      return null;
    }

    return null;
  }

  function parseGjeldsregisterRows(rawText) {
    const rawLines = String(rawText || "")
      .split(/\r?\n/)
      .map((line) => String(line || "").trim())
      .filter((line) => line.length > 0);

    if (rawLines.length === 0) return [];

    let headerLineIndex = -1;
    let headerParts = [];
    for (let i = 0; i < rawLines.length; i += 1) {
      if (!rawLines[i].includes("\t")) continue;
      const parts = rawLines[i].split("\t").map((part) => String(part || "").trim().toLowerCase());
      if (parts.includes("kreditor") && parts.some((part) => part.includes("rentebærende saldo") || part.includes("rentebaerende saldo"))) {
        headerLineIndex = i;
        headerParts = parts;
        break;
      }
    }

    if (headerLineIndex < 0) return [];

    const creditorIndex = headerParts.findIndex((part) => part === "kreditor");
    const saldoIndex = headerParts.findIndex((part) => part.includes("rentebærende saldo") || part.includes("rentebaerende saldo"));

    if (creditorIndex < 0 || saldoIndex < 0) return [];

    const rows = [];
    for (let i = headerLineIndex + 1; i < rawLines.length; i += 1) {
      if (!rawLines[i].includes("\t")) continue;
      const parts = rawLines[i].split("\t").map((part) => String(part || "").trim());
      const creditor = String(parts[creditorIndex] || "").trim();
      const saldoRaw = String(parts[saldoIndex] || "").replace(/kr/gi, "").trim();
      const parsedAmount = parseAmountInput(saldoRaw);

      if (!creditor || !parsedAmount) continue;
      rows.push({
        creditor,
        accountNumber: "",
        kid: "",
        amount: formatAmount(parsedAmount),
        source: "Rammelån Gjeldsregister",
      });
    }

    return rows;
  }

  function handleMetaAmountBlur(field) {
    if (field === "innvilgetLaanMedPant") {
      setInnvilgetLaanMedPant((prev) => formatMetaAmountValue(prev));
      return;
    }

    if (field === "innvilgetUsikretLaan") {
      setInnvilgetUsikretLaan((prev) => formatMetaAmountValue(prev));
      return;
    }

    setEtableringshonorar((prev) => formatMetaAmountValue(prev));
  }

  function parseNedbetalingslanRows(rawText) {
    const rawLines = String(rawText || "")
      .split(/\r?\n/)
      .map((line) => String(line || "").trim())
      .filter((line) => line.length > 0);

    if (rawLines.length === 0) return [];

    let headerLineIndex = -1;
    let headerParts = [];
    for (let i = 0; i < rawLines.length; i += 1) {
      if (!rawLines[i].includes("\t")) continue;
      const parts = rawLines[i].split("\t").map((part) => String(part || "").trim().toLowerCase());
      if (parts.includes("kreditor") && parts.includes("saldo")) {
        headerLineIndex = i;
        headerParts = parts;
        break;
      }
    }

    if (headerLineIndex < 0) return [];

    const creditorIndex = headerParts.findIndex((part) => part === "kreditor");
    const saldoIndex = headerParts.findIndex((part) => part === "saldo");

    if (creditorIndex < 0 || saldoIndex < 0) return [];

    const rows = [];
    for (let i = headerLineIndex + 1; i < rawLines.length; i += 1) {
      if (!rawLines[i].includes("\t")) continue;
      const parts = rawLines[i].split("\t").map((part) => String(part || "").trim());
      const creditor = String(parts[creditorIndex] || "").trim();
      const saldoRaw = String(parts[saldoIndex] || "").replace(/kr/gi, "").trim();
      const parsedAmount = parseAmountInput(saldoRaw);

      if (!creditor || !parsedAmount) continue;
      rows.push({
        creditor,
        accountNumber: "",
        kid: "",
        amount: formatAmount(parsedAmount),
        source: "Nedbetalingslån Gjeldsregister",
      });
    }

    return rows;
  }

  function parseImportRows(rawText) {
    const rawLines = String(rawText || "").split(/\r?\n/);
    const rows = [];
    let pendingCreditor = "";

    for (const rawLine of rawLines) {
      const line = String(rawLine || "").replace(/^"+|"+$/g, "").trim();
      if (!line) continue;
      if (isLikelyHeaderLine(line)) continue;

      if (line.includes("\t")) {
        const tabParts = line
          .split(/\t+/)
          .map((part) => String(part || "").trim())
          .filter((part) => part.length > 0);

        const parsedFromTabs = extractParsedRowFromParts(tabParts, pendingCreditor);
        if (parsedFromTabs) {
          rows.push(parsedFromTabs);
          continue;
        }

        // If line is not parseable as data, treat first column as potential creditor context.
        if (tabParts[0] && !isLikelyAccountNumber(tabParts[0])) {
          pendingCreditor = tabParts[0];
        }
        continue;
      }

      // Non-tab line: likely creditor context or fully unstructured single-line fallback.
      const fallbackSingleLine = line.match(
        /^\s*[\u25B6\u25B8\u25BA\u25CF\u2022]?\s*(.*?)\s+(\d{11})\s+(\S+)\s+(\d[\d\s.]*[.,]\d{1,2}|\d+)\b/
      );

      if (fallbackSingleLine) {
        const parsed = extractParsedRowFromParts(
          [
            fallbackSingleLine[1],
            fallbackSingleLine[2],
            fallbackSingleLine[3],
            fallbackSingleLine[4],
          ],
          pendingCreditor
        );
        if (parsed) {
          rows.push(parsed);
          continue;
        }
      }

      pendingCreditor = line;
    }

    return rows;
  }

  function buildImportPreview() {
    if (!String(importText || "").trim()) {
      return { error: "Lim inn minst en linje for import.", rows: [] };
    }

    const parsedRows =
      importMode === "gjeld"
        ? parseGjeldsregisterRows(importText)
        : importMode === "nedbetaling"
          ? parseNedbetalingslanRows(importText)
          : parseImportRows(importText);

    if (parsedRows.length === 0) {
      return {
        error:
          importMode === "gjeld"
            ? "Ingen gyldige linjer funnet. Sjekk at linjene inneholder kolonnene Kreditor og Rentebærende saldo."
            : importMode === "nedbetaling"
              ? "Ingen gyldige linjer funnet. Sjekk at linjene inneholder kolonnene Kreditor og Saldo."
            : "Ingen gyldige linjer funnet. Sjekk at linjene inneholder Kreditor, Kontonummer, KID og Belop.",
        rows: [],
      };
    }

    return { error: "", rows: parsedRows };
  }

  function handlePreviewImportFromInkasso() {
    const preview = buildImportPreview();
    setImportPreviewRows(preview.rows);
    setImportPreviewError(preview.error);
  }

  function handleConfirmImportFromInkasso() {
    const previewRows = importPreviewRows.length > 0 ? importPreviewRows : buildImportPreview().rows;
    if (previewRows.length === 0) {
      setImportPreviewError("Ingen gyldige linjer klare for import.");
      return;
    }

    setEntries((prev) => {
      const next = [...prev];

      for (const parsed of previewRows) {
        let targetIndex = next.findIndex((row) => isImportTargetEmpty(row));
        if (targetIndex < 0) {
          next.push(createEmptyRow(hovedlantaker));
          targetIndex = next.length - 1;
        }

        const existing = next[targetIndex];
        const matchedAccount = String(
          creditorAccountsByName.get(String(parsed.creditor || "").trim().toLowerCase()) || ""
        );
        const importedAccountNumber = importMode === "gjeld" || importMode === "nedbetaling"
          ? matchedAccount
          : (parsed.accountNumber || matchedAccount);
        const importedKid = importMode === "gjeld"
          ? ""
          : (importMode === "nedbetaling" ? "" : (parsed.kid || ""));
        next[targetIndex] = {
          ...existing,
          creditor: parsed.creditor,
          accountNumber: importedAccountNumber,
          kid: importedKid,
          source:
            importMode === "gjeld"
              ? "Rammelån Gjeldsregister"
              : (importMode === "nedbetaling" ? "Nedbetalingslån Gjeldsregister" : "Inkassoregister"),
          customerNote: "",
          amount: parsed.amount,
          owner: String(existing.owner || "").trim() || hovedlantaker,
          dueDate: String(existing.dueDate || "").trim() || getTodayIsoDate(),
          infridd: true,
          typeKrav: existing.typeKrav || "Annet",
          rowUpdatedAt: nowIsoTimestamp(),
        };
      }

      return ensureLockedLineNumbers(next, nextLineNumberRef);
    });

    setShowImportModal(false);
    setImportText("");
    setImportPreviewRows([]);
    setImportPreviewError("");
    setStatusText(
      importMode === "gjeld"
        ? `Importert ${previewRows.length} linjer fra Rammelån Gjeldsregister.`
        : importMode === "nedbetaling"
          ? `Importert ${previewRows.length} linjer fra Nedbetalingslån Gjeldsregister.`
        : `Importert ${previewRows.length} linjer fra Inkassoregister.`
    );
  }

  async function saveForing(nextStatus) {
    const payload = buildForingPayload(nextStatus);
    const signature = JSON.stringify(payload);
    if (signature === lastSavedForingSignatureRef.current) {
      return;
    }

    const response = await authFetch(`/api/foringer/${foringId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: "Ukjent feil." }));
      throw new Error(body.error || "Kunne ikke lagre foring.");
    }

    lastSavedForingSignatureRef.current = signature;
    lastSavedMetaSignatureRef.current = JSON.stringify(buildMetaPayload(nextStatus));
  }

  async function saveForingMeta(nextStatus) {
    const payload = buildMetaPayload(nextStatus);
    const signature = JSON.stringify(payload);
    if (signature === lastSavedMetaSignatureRef.current) {
      return;
    }

    const response = await authFetch(`/api/foringer/${foringId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: "Ukjent feil." }));
      throw new Error(body.error || "Kunne ikke lagre foring.");
    }

    lastSavedMetaSignatureRef.current = signature;
  }

  async function handleSave() {
    if (!caseHandler.trim() || !cloNumber.trim() || !hovedlantaker.trim()) {
      setStatusText("Saksbehandler, CLO nummer og hovedlantaker ma fylles ut.");
      return;
    }

    if (liveValidation.hasInvalid) {
      setStatusText("Rett ugyldig KID/kontonummer før lagring.");
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

    if (!caseHandler.trim() || !cloNumber.trim() || !hovedlantaker.trim()) {
      setStatusText("Saksbehandler, CLO nummer og hovedlantaker ma fylles ut.");
      return;
    }

    if (liveValidation.hasInvalid) {
      setStatusText("Rett ugyldig KID/kontonummer før XML-generering.");
      return;
    }

    const filteredEntries = entries.filter((row) => row.creditor.trim() && row.infridd);

    if (filteredEntries.length === 0) {
      setStatusText("Fyll ut minst en linje for a generere XML.");
      return;
    }

    setStatusText(`Genererer XML for ${filteredEntries.length} foringer...`);

    try {
      await saveForing();

      const response = await authFetch("/api/pain001", {
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

  const rowsToInfris = useMemo(
    () => entries.map((row, index) => ({ row, index })).filter((item) => item.row.infridd),
    [entries]
  );

  const rowsNotToInfris = useMemo(
    () => entries.map((row, index) => ({ row, index })).filter((item) => !item.row.infridd),
    [entries]
  );
  const displayLineNumbers = useMemo(() => {
    const usedNumbers = new Set(
      entries
        .map((row) => Number(row?.lineNumber || 0))
        .filter((value) => Number.isInteger(value) && value > 0)
    );

    const numbersByIndex = new Map();
    let nextNumber = usedNumbers.size > 0 ? Math.max(...usedNumbers) + 1 : 1;

    entries.forEach((row, index) => {
      const locked = Number(row?.lineNumber || 0);
      if (Number.isInteger(locked) && locked > 0) {
        numbersByIndex.set(index, locked);
        return;
      }

      while (usedNumbers.has(nextNumber)) {
        nextNumber += 1;
      }

      numbersByIndex.set(index, nextNumber);
      usedNumbers.add(nextNumber);
      nextNumber += 1;
    });

    return numbersByIndex;
  }, [entries]);
  const isReadOnlyStatus = foringStatus === "Avsluttet" || foringStatus === "Utbetalt";

  function renderEntryRow(index, row) {
    const displayLineNumber = displayLineNumbers.get(index) ?? "";

    return (
      <tr
        key={`row-${index}`}
        className={`${row.boligLaan ? "row-boliglaan " : ""}${!row.infridd ? "row-not-infridd " : ""}${!row.creditor.trim() ? "row-empty-creditor" : ""}`.trim()}
      >
        <td>
          <button type="button" className="delete-row-btn" onClick={() => removeRow(index)} disabled={isReadOnlyStatus}>
            Slett
          </button>
        </td>
        <td>
          <select
            value={row.boligLaan ? "Ja" : "Nei"}
            onChange={(event) => updateBoligLaan(index, event.target.value === "Ja")}
            onBlur={requestEntrySave}
            disabled={isReadOnlyStatus}
          >
            <option value="Ja">Ja</option>
            <option value="Nei">Nei</option>
          </select>
        </td>
          <td>{displayLineNumber}</td>
        <td>
          <input
            list="creditor-options"
            value={row.creditor}
            onChange={(event) => handleCreditorChange(index, event.target.value)}
            onBlur={requestEntrySave}
            disabled={isReadOnlyStatus}
          />
        </td>
        <td>
          <input
            className={hasInvalidField(index, "kid") ? "input-invalid" : ""}
            value={row.kid}
            inputMode="numeric"
            onChange={(event) => updateRow(index, { kid: event.target.value })}
            onBlur={() => {
              handleKidBlur(index);
              requestEntrySave();
            }}
            disabled={isReadOnlyStatus}
          />
        </td>
        <td>
          <input
            placeholder="Notat til kunde"
            value={row.customerNote}
            onChange={(event) => handleCustomerNoteChange(index, event.target.value)}
            onBlur={requestEntrySave}
            disabled={isReadOnlyStatus}
          />
        </td>
        <td>
          <input
            maxLength={140}
            value={row.internalNote}
            onChange={(event) => updateRow(index, { internalNote: event.target.value })}
            onBlur={requestEntrySave}
            disabled={isReadOnlyStatus}
          />
        </td>
        <td>
          <input
            className={hasInvalidField(index, "accountNumber") ? "input-invalid" : ""}
            value={row.accountNumber}
            inputMode="numeric"
            onChange={(event) => updateRow(index, { accountNumber: event.target.value })}
            onBlur={() => {
              handleAccountBlur(index);
              requestEntrySave();
            }}
            disabled={isReadOnlyStatus}
          />
        </td>
        <td>
          <input
            value={row.amount}
            inputMode="decimal"
            onChange={(event) => updateRow(index, { amount: event.target.value })}
            onBlur={() => {
              handleAmountBlur(index);
              requestEntrySave();
            }}
            disabled={isReadOnlyStatus}
          />
        </td>
        <td>
          <input
            type="date"
            min={getTodayIsoDate()}
            value={row.dueDate}
            onChange={(event) => updateRow(index, { dueDate: event.target.value })}
            onBlur={requestEntrySave}
            disabled={isReadOnlyStatus}
          />
        </td>
        <td>
          <select
            value={row.infridd ? "Ja" : "Nei"}
            onChange={(event) => updateRow(index, { infridd: event.target.value === "Ja" })}
            onBlur={requestEntrySave}
            disabled={isReadOnlyStatus}
          >
            <option value="Ja">Ja</option>
            <option value="Nei">Nei</option>
          </select>
        </td>
        <td>
          <select
            value={row.typeKrav}
            onChange={(event) => updateRow(index, { typeKrav: event.target.value })}
            onBlur={requestEntrySave}
            disabled={isReadOnlyStatus}
          >
            <option value="">Velg</option>
            <option value="Pant">Pant</option>
            <option value="Utlegg">Utlegg</option>
            <option value="Inkasso">Inkasso</option>
            <option value="Annet">Annet</option>
          </select>
        </td>
        <td>
          <select
            value={row.owner}
            onChange={(event) => updateRow(index, { owner: event.target.value })}
            onBlur={requestEntrySave}
            disabled={isReadOnlyStatus}
          >
            {!ownerOptions.includes(row.owner) && row.owner ? (
              <option value={row.owner}>{row.owner}</option>
            ) : null}
            {ownerOptions.map((owner) => (
              <option key={`owner-pick-${owner}`} value={owner}>{owner}</option>
            ))}
          </select>
        </td>
        <td>
          <select
            value={row.source}
            onChange={(event) => updateRow(index, { source: event.target.value })}
            onBlur={requestEntrySave}
            disabled={isReadOnlyStatus}
          >
            <option value="">Velg</option>
            <option value="Inkassoregister">Inkassoregister</option>
            <option value="Rammelån Gjeldsregister">Rammelån Gjeldsregister</option>
            <option value="Nedbetalingslån Gjeldsregister">Nedbetalingslån Gjeldsregister</option>
            <option value="annet">annet</option>
          </select>
        </td>
        <td>
          <input
            type="text"
            value={formatRowTimestamp(row.rowUpdatedAt)}
            readOnly
          />
        </td>
      </tr>
    );
  }

  if (isLoading) {
    return (
      <>
        <h1 className="page-title-frame">Kreditorliste</h1>
        <p>Laster foring...</p>
      </>
    );
  }

  return (
    <>
      <h1 className="page-title-frame">Kreditorliste CLO {cloNumber || ""}</h1>
      {liveValidation.hasInvalid ? (
        <p className="live-validation">{liveValidation.message}</p>
      ) : null}

      <form onSubmit={handleSubmit}>
        <div className="actions actions-left top-actions">
          <Link
            className={`secondary-btn action-link${isReadOnlyStatus ? " disabled-link" : ""}`}
            to={isReadOnlyStatus ? "#" : `/til-kunde/${foringId}`}
            onClick={(event) => {
              if (isReadOnlyStatus) event.preventDefault();
            }}
          >
            Epost til kunde
          </Link>
          <button type="button" className="secondary-btn" onClick={handleSave}>
            Lagre føring
          </button>
          <button type="submit">Generer XML</button>
        </div>
        {statusText ? <p id="status" className="status-alert">{statusText}</p> : null}

        <datalist id="creditor-options">
          {creditors.map((creditor) => (
            <option key={creditor.id || creditor.name} value={creditor.name || ""} />
          ))}
        </datalist>
        <section className="summary-grid">
          <div className="summary-card">
            <span className="summary-label">Planlagt utbetalt</span>
            <strong>{formatAmount(summary.plannedAmount)}</strong>
          </div>
          <div className="summary-card">
            <span className="summary-label">Antall linjer brukt</span>
            <strong>{summary.usedLines}</strong>
          </div>
          <div
            className={`summary-card ${
              summary.remainingLoanFrame < 0
                ? "remaining-negative"
                : (summary.remainingLoanFrame > 0 ? "remaining-positive" : "remaining-neutral")
            }`}
          >
            <span className="summary-label">Igjen av total låneramme</span>
            <strong>{formatAmount(summary.remainingLoanFrame)}</strong>
          </div>
        </section>

        <div className="actions actions-left">
          <button
            type="button"
            className="secondary-btn"
            disabled={isReadOnlyStatus}
            onClick={() => {
              setImportMode("inkasso");
              setImportText("");
              setImportPreviewRows([]);
              setImportPreviewError("");
              setShowImportModal(true);
            }}
          >
            Importer saker Inkassoregister
          </button>
          <button
            type="button"
            className="secondary-btn"
            disabled={isReadOnlyStatus}
            onClick={() => {
              setImportMode("gjeld");
              setImportText("");
              setImportPreviewRows([]);
              setImportPreviewError("");
              setShowImportModal(true);
            }}
          >
            Importer Rammelån fra Gjeldsregister
          </button>
          <button
            type="button"
            className="secondary-btn"
            disabled={isReadOnlyStatus}
            onClick={() => {
              setImportMode("nedbetaling");
              setImportText("");
              setImportPreviewRows([]);
              setImportPreviewError("");
              setShowImportModal(true);
            }}
          >
            Importer Nedbetalingslån fra Gjeldsregister
          </button>
        </div>

        {showImportModal ? (
          <div className="modal-backdrop" role="presentation" onClick={() => setShowImportModal(false)}>
            <section
              className="modal-card import-modal-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="inkasso-import-title"
              onClick={(event) => event.stopPropagation()}
            >
              <h2 id="inkasso-import-title">
                {importMode === "gjeld"
                  ? "Importer Rammelån fra Gjeldsregister"
                  : (importMode === "nedbetaling" ? "Importer Nedbetalingslån fra Gjeldsregister" : "Importer saker Inkassoregister")}
              </h2>
              <p>
                {importMode === "gjeld"
                  ? "Lim inn tabell fra Gjeldsregister. Vi leser kun Kreditor og Rentebærende saldo (som Belop). Kreditor med 0,- i rentebærende saldo importeres ikke."
                  : importMode === "nedbetaling"
                    ? "Lim inn tabell fra Gjeldsregister. Vi leser kun Kreditor og Saldo (som Belop), ikke Opprinnelig saldo."
                  : "Lim inn én linje per kreditor. Vi leser Kreditor, Kontonummer, KID og Belop."}
              </p>
              <textarea
                className="import-textarea"
                value={importText}
                onChange={(event) => setImportText(event.target.value)}
                placeholder="Lim inn linjer her..."
              />
              {importPreviewError ? <p className="live-validation">{importPreviewError}</p> : null}
              {importPreviewRows.length > 0 ? (
                <div className="table-wrap import-preview-table">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Kreditor</th>
                        <th>Kontonummer</th>
                        <th>KID</th>
                        <th>Belop</th>
                        <th>Kilde</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreviewRows.map((row, index) => (
                        <tr key={`import-preview-${index}`}>
                          <td>{index + 1}</td>
                          <td>{row.creditor}</td>
                          <td>{row.accountNumber}</td>
                          <td>{row.kid}</td>
                          <td>{row.amount}</td>
                          <td>
                            {row.source || (
                              importMode === "gjeld"
                                ? "Rammelån Gjeldsregister"
                                : (importMode === "nedbetaling" ? "Nedbetalingslån Gjeldsregister" : "Inkassoregister")
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              <div className="actions actions-left modal-actions">
                <button type="button" className="secondary-btn" onClick={handlePreviewImportFromInkasso}>
                  Vis forslag
                </button>
                <button
                  type="button"
                  onClick={handleConfirmImportFromInkasso}
                  disabled={importPreviewRows.length === 0}
                >
                  OK
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => {
                    setShowImportModal(false);
                    setImportPreviewRows([]);
                    setImportPreviewError("");
                  }}
                >
                  Avbryt
                </button>
              </div>
            </section>
          </div>
        ) : null}

        <section className="meta-grid">
          <label htmlFor="innvilgetLaanMedPant">Innvilget lån med pant</label>
          <input
            id="innvilgetLaanMedPant"
            name="innvilgetLaanMedPant"
            type="text"
            inputMode="decimal"
            placeholder="0,00"
            value={innvilgetLaanMedPant}
            onChange={(event) => setInnvilgetLaanMedPant(event.target.value)}
            onBlur={() => {
              handleMetaAmountBlur("innvilgetLaanMedPant");
              requestMetaSave();
            }}
            disabled={isReadOnlyStatus}
          />

          <label htmlFor="innvilgetUsikretLaan">Innvilget usikret lån</label>
          <input
            id="innvilgetUsikretLaan"
            name="innvilgetUsikretLaan"
            type="text"
            inputMode="decimal"
            placeholder="0,00"
            value={innvilgetUsikretLaan}
            onChange={(event) => setInnvilgetUsikretLaan(event.target.value)}
            onBlur={() => {
              handleMetaAmountBlur("innvilgetUsikretLaan");
              requestMetaSave();
            }}
            disabled={isReadOnlyStatus}
          />

          <label htmlFor="etableringshonorar">Etableringsgebyr</label>
          <input
            id="etableringshonorar"
            name="etableringshonorar"
            type="text"
            inputMode="decimal"
            placeholder="0,00"
            value={etableringshonorar}
            onChange={(event) => setEtableringshonorar(event.target.value)}
            onBlur={() => {
              handleMetaAmountBlur("etableringshonorar");
              requestMetaSave();
            }}
            disabled={isReadOnlyStatus}
          />

          <label htmlFor="caseHandler">Saksbehandler</label>
          <input
            id="caseHandler"
            name="caseHandler"
            type="text"
            required
            value={caseHandler}
            onChange={(event) => setCaseHandler(event.target.value)}
            onBlur={requestMetaSave}
            disabled={isReadOnlyStatus}
          />

              <label htmlFor="cloNumber">CLO nummer</label>
              <input
                id="cloNumber"
            name="cloNumber"
            type="text"
            required
            value={cloNumber}
            onChange={(event) => setCloNumber(event.target.value)}
            onBlur={requestMetaSave}
            disabled={isReadOnlyStatus}
              />

              <label htmlFor="hovedlantaker">Hovedlåntaker</label>
              <input
                id="hovedlantaker"
                name="hovedlantaker"
                type="text"
                required
                value={hovedlantaker}
                onChange={(event) => handleHovedlantakerChange(event.target.value)}
                onBlur={requestMetaSave}
                disabled={isReadOnlyStatus}
              />

              <label>Låntaker</label>
              <div className="lantaker-list">
                <button type="button" className="plus-btn" onClick={addLantakerField} aria-label="Legg til låntaker" disabled={isReadOnlyStatus}>
                  +
                </button>
                <div className="lantaker-inputs">
                  {lantakere.map((value, index) => (
                    <input
                      key={`lantaker-${index}`}
                      type="text"
                      value={value}
                      onChange={(event) => updateLantaker(index, event.target.value)}
                      onBlur={requestMetaSave}
                      disabled={isReadOnlyStatus}
                    />
                  ))}
                </div>
              </div>

              <label htmlFor="foringStatus">Status</label>
              <select
                id="foringStatus"
            name="foringStatus"
            value={foringStatus}
            onChange={(event) => setForingStatus(event.target.value)}
            onBlur={requestMetaSave}
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
                <th>Slett</th>
                <th>Boliglån</th>
                <th>#</th>
                <th>Kreditor</th>
                <th>KID</th>
                <th>Notat til kunde</th>
                <th>Internt notat</th>
                <th>Kontonummer</th>
                <th>Belop</th>
                <th>Dato for utbetaling</th>
                <th>Skal innfris</th>
                <th>Type krav</th>
                <th>Eier</th>
                <th>Kilde</th>
                <th>Sist oppdatert</th>
              </tr>
            </thead>
            <tbody>
              {rowsToInfris.map((item) => renderEntryRow(item.index, item.row))}
              {rowsNotToInfris.length > 0 ? (
                <tr className="section-divider-row">
                  <td colSpan={15}>Kreditorer som ikke skal innfries</td>
                </tr>
              ) : null}
              {rowsNotToInfris.map((item) => (
                <Fragment key={`non-infridd-${item.index}`}>
                  {renderEntryRow(item.index, item.row)}
                  <tr className="comment-row">
                    <td colSpan={15}>
                      <div className="comment-cell">
                        <label htmlFor={`kommentar-${item.index}`}>Kommentar</label>
                        <input
                          id={`kommentar-${item.index}`}
                          type="text"
                          value={item.row.kommentar || ""}
                          onChange={(event) => updateRow(item.index, { kommentar: event.target.value })}
                          onBlur={requestEntrySave}
                          disabled={isReadOnlyStatus}
                        />
                      </div>
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <div className="actions">
          <button type="button" id="add-lines" onClick={addRows} disabled={isReadOnlyStatus}>
            Flere linjer
          </button>
          <button type="button" className="secondary-btn" onClick={setTodayOnAllRows} disabled={isReadOnlyStatus}>
            Sett dagens dato på alle linjer
          </button>
        </div>
      </form>
    </>
  );
}






