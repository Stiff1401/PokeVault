# PokéVault – Regeln für Claude Code

## Befehle
- `npm run dev` – Dev-Server
- `npm run typecheck` – TypeScript prüfen
- `npm run build` – statischer Export (`out/`)
- `npm run build:selfhost` – Standalone-Server inkl. Sync-API
- `npm run build:index` – Bild-Index für die lokale Erkennung neu bauen (`public/image-index/`)

## Architektur
- Next.js 15 App Router, alle Seiten sind Client Components; der Standard-Build ist ein statischer Export.
- Lesen: Dexie Live Queries (`useVaultData`, `useTargetSets` in `src/lib/db.ts`).
- Schreiben: ausschließlich über `getRepository()` aus `src/lib/storage-adapter.ts`, nie direkt in `db.collection`.
- Server-Code liegt nur in `src/server/` und in `route.api.ts`-Dateien; Client-Code importiert ihn nie.
- Erkennung: `src/lib/recognition.ts` (Ablauf, Nummernlesen) und `src/lib/visual-index.ts` (Bildabgleich). Schwellenwerte dort nur mit Messung an echten Fotos ändern.
- Kanonische Werte (Kategorie, Stufe, Typ) sind deutsch gespeichert; Übersetzung über `src/lib/i18n.ts`.

## Konventionen
- UI-Texte immer als Paar `t('Deutsch', 'English')`.
- Vollständige Dateien, keine Platzhalter, keine TODO-Kommentare.
- Tailwind-Klassen aus `globals.css` wiederverwenden (`panel`, `btn-primary`, `btn-ghost`, `field`, `chip`).
- Neue synchronisierte Felder müssen in Dexie, `prisma/schema.prisma`, der Sync-Route und `supabase/schema.sql` ergänzt werden.
- Keine Pflicht-Backends, keine Pflicht-API-Keys einführen.
