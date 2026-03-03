# Betaling SR-bank

App for a generere ISO 20022 `pain.001` XML fra:
- KID-nummer
- Kontonummer
- Belop
- Dato

## Kjor lokalt (.NET 8)

1. Installer .NET 8 SDK
2. `cd "Betaling SR-bank"`
3. `dotnet run`
4. Applikasjonen starter pa `http://localhost:3200`

## Frontend (React)

- React-kildekode ligger i `frontend/`.
- Bygg frontend til `public/` med:
  1. `cd "Betaling SR-bank\\frontend"`
  2. `npm install`
  3. `npm run build`
- For lokal frontend-utvikling:
  1. `cd "Betaling SR-bank\\frontend"`
  2. `npm run dev`

## Pre-flight validering (pain.001)

Ved kall til `POST /api/pain001` kjorer appen en pre-flight sjekk for a stoppe ugyldig XML for filen returneres.

Sjekkene inkluderer:
- `GrpHdr/NbOfTxs` matcher faktisk antall `CdtTrfTxInf`.
- `GrpHdr/CtrlSum` matcher sum av `InstdAmt`.
- `PmtInf` ma ikke inneholde `NbOfTxs`, `CtrlSum` eller `ChrgBr` (bankprofil).
- `PmtTpInf/SvcLvl/Cd` ma vaere `NURG`.
- `PmtTpInf/CtgyPurp/Cd` ma vaere `SUPP`.
- `CdtrAgt` skal ikke sendes uten gyldig innhold.
- Per transaksjon ma `RmtInf/Strd` vaere satt.
- `RmtInf/Strd/AddtlRmtInf` ma vaere satt (1-3 forekomster, 1-140 tegn hver).
- Hvis `CdtrRefInf` er satt, ma den bruke `SCOR` + numerisk KID (2-25 sifre).

Hvis en sjekk feiler, returnerer API-et `400` med konkret feilmelding.

### Kort regressjons-sjekkliste

1. Kjor `dotnet build -c Release`.
2. Generer en testfil med miks av KID- og meldingslinjer.
3. Verifiser at XML ikke har `PmtInf/NbOfTxs`, `PmtInf/CtrlSum`, `PmtInf/ChrgBr`.
4. Verifiser at `SvcLvl=NURG` og `CtgyPurp=SUPP` ligger under `PmtTpInf`.
5. Test opplasting i bankvalidering ved endringer i generatoren.

## Deploy pa Render

- Repoet inneholder `render.yaml` + `Dockerfile` for .NET 8 + React build.
- Importer repoet i Render som `Blueprint`.
- Tjenesten bruker persistent disk pa `/var/data` via `APP_STORAGE_ROOT`.
