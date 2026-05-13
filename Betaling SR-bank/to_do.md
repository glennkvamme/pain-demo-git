# To-do / Fremtidige forbedringer

## 1. Reduser størrelse på JavaScript-bundle (lazy loading av jsPDF)

**Problem:**
Vite advarer om at hovedbunten (`index.js`) er ~800 kB. Årsaken er at `jsPDF` (~500 kB) lastes inn ved oppstart selv om det kun brukes når brukeren genererer en PDF.

**Praktisk konsekvens:**
Liten påvirkning så lenge appen kjører på lokalt nett, men første sidelast vil være tregere enn nødvendig.

**Mulig fix:**
Bruke dynamic import i `ForingPage.jsx` slik at jsPDF kun lastes i det brukeren trykker på PDF-knappen:

```js
// Istedenfor statisk import øverst i filen:
// import { jsPDF } from "jspdf";
// import autoTable from "jspdf-autotable";

// Last dynamisk ved behov:
async function generatePdf() {
  const { jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  // ... resten av PDF-logikken
}
```

Dette vil kutte startup-bunten med ~500 kB.
