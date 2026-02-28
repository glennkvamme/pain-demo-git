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
