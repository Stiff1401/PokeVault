# PokéVault

Local-first PWA zum Scannen, Katalogisieren, Tauschen, Verschenken und Bewerten von Pokémon-TCG-Sammlungen.
Läuft komplett im Browser (IndexedDB), ohne Pflicht-Backend, ohne Konto, ohne bezahlte API-Keys.

> Inoffizielles Fan-Projekt, keine Verbindung zu Nintendo, The Pokémon Company, Creatures oder GAME FREAK.
> Kartendaten und Preise: [TCGdex](https://tcgdex.dev) (Cardmarket Trend).

## Schnellstart (Community Edition, statisch)

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # statischer Export nach ./out
```

`out/` auf einen beliebigen statischen Host legen (GitHub Pages, Vercel, Nginx).
Bei Hosting unter einem Unterpfad vorher `NEXT_PUBLIC_BASE_PATH=/pokevault` setzen.
Kamera und PWA-Installation brauchen HTTPS (oder localhost).

## Funktionen

| Route | Inhalt |
| --- | --- |
| `/` | KPIs, Set-Fortschritt mit Restkosten, Tausch-Vorschläge (±15 %), Top 5 |
| `/scan` | 1x1-Kamera-Scanner mit Schärfe-/Spiegelungs-Prüfung und Auto-Capture |
| `/import` | 2×2 / 3×3 Albumseiten-Import, CSV- und JSON-Import/Export |
| `/collection` | Sammlung mit Filtern (Kategorie, Stufe, Typ, Set, Seltenheit) und Sortierung |
| `/trade` | Tauschmappe, Evolutions-Lücken, Live Tausch-Waage |
| `/gift` | Booster-Kaufberater, Wunschliste, diskrete Geschenk-Vormerkung |
| `/guide` | Anleitung mit SVG-Diagrammen, druckbare A4-Schablone |
| `/tutorial-stage` | 16:9-Bühne für B-Roll (← → Szene, H blendet UI aus) |
| `/settings`, `/settings/share` | Erkennung, Sprache, Sync, Backup, Einladungen per Link/QR |

## Erkennung

**Lokale Engine (Standard, ohne API-Key).** Zwei Hinweise werden kombiniert:

1. *Bildabgleich:* Das Foto wird mit Miniaturen aller Karten verglichen (`public/image-index/<sprache>.bin`, 18×24 Pixel je Karte).
   Die besten Treffer werden anschließend gegen das echte Kartenbild von TCGdex geprüft. Das funktioniert auch durch Folien
   und bei Glanzkarten, wo Texterkennung scheitert.
2. *Sammlernummer:* Die Zeile mit `XXX/YYY` wird stark vergrößert und in zwei Durchgängen mit Tesseract gelesen.

Stimmen Bild und Nummer überein, gilt die Karte als sicher ("Bild + Nummer"). Liegt nur einer der beiden Hinweise vor,
wird die Karte als "bitte prüfen" oder "unsicher" markiert. Ohne Index für die Kartensprache fällt die Engine auf reine
Texterkennung von Name und Nummer zurück.

Der Albumseiten-Import schneidet jedes Fach in Originalauflösung aus und sucht die Karte darin selbst; sie muss nicht
exakt im Fach sitzen.

**Index bauen oder aktualisieren** (neue Sets, andere Sprache):

```bash
npm run build:index
```

Optionen: `--lang en`, `--thumb 12x16` (8 MB statt 18 MB, trifft aber seltener), `--cache <ordner>`.
Der erste Lauf lädt rund 14.000 Kartenbilder (etwa 200 MB) in `.cache/`.

**Bekannte Grenzen**
- Basis-Energien der Sets MEE und SVE haben bei TCGdex keine Bilder, und ihre dünn gedruckte Nummer wird selten gelesen.
  Die Engine erkennt das Set am Code und den Typ am Motiv und bietet die passenden Nummern zur Auswahl an.
- Sehr dunkel fotografierte Reverse-Holos werden teils nur über die Nummer erkannt.
- Pro Karte dauert die Erkennung etwa 3 bis 10 Sekunden; beim ersten Mal werden Index (18 MB) und OCR-Daten geladen.

**Vision-API (optional).** Eigener Schlüssel für Gemini, OpenAI-kompatible Dienste oder Ollama; bei Fehlern greift die lokale Engine.

## Optionaler Sync

Schreibzugriffe landen immer zuerst in IndexedDB und werden danach repliziert (Last-Write-Wins).
Synchronisiert werden `collection` und `targetSets`; Kartendaten, Preisverlauf und eigene Scans bleiben gerätelokal.
Zugriff: Vault-ID + Rollen-PIN, der Server speichert nur Hashes. Viewer dürfen ausschließlich Geschenk-Vormerkungen schreiben.

### Variante A: Supabase

1. `supabase/schema.sql` im SQL-Editor des Projekts ausführen.
2. In PokéVault Projekt-URL und Anon Key eintragen (Onboarding oder Einstellungen → Familien-Sync).

### Variante B: eigener Server (Docker)

```bash
cp .env.example .env     # POSTGRES_PASSWORD setzen
docker compose up -d --build
```

Davor einen Reverse Proxy mit TLS schalten. Ohne Docker: `DATABASE_URL` setzen, `npx prisma db push`,
`npm run build:selfhost`, `npm run start:selfhost`.

Die API-Routen heißen `route.api.ts` und werden nur im Selfhost-Build (`BUILD_TARGET=selfhost`) zu Routen;
der statische Export enthält sie nicht.

## Stand der Verifikation

Geprüft:
- Typecheck, statischer Build und Selfhost-Build (die Warnung "Failed to copy traced files … route_client-reference-manifest.js" beim Selfhost-Build ist harmlos, die Routen funktionieren).
- Alle Seiten im Browser geöffnet; Sammlung, Übersicht und Scan zusätzlich bei 375 px Breite.
- Sync-API des eigenen Servers (Rollen, Last-Write-Wins, Löschen, CORS, Slicing mit sharp) und `supabase/schema.sql`, jeweils gegen PGlite (Postgres als WASM).
- Zwei Geräte gegen den eigenen Server: Beitritt per Einladungslink als Viewer, Geschenk-Vormerkung, Hinweis beim Bearbeiter.
- Albumseiten-Import mit der lokalen Engine an 17 echten 2×2-Albumfotos (67 Karten in Folien, viele Reverse-Holos), verglichen mit einer von Hand geprüften Liste: 73 % auf Platz 1 richtig. Nach Sicherheitsstufe: "Bild + Nummer" 27 von 29, "bitte prüfen" 16 von 20, "unsicher" 6 von 18 (wird nicht automatisch übernommen). Die zwei Fehler der sicheren Stufe sind behoben; ein kürzerer Nachtest (24 Karten) ergab 15 von 15.

Noch nicht geprüft:
- Kamera-Scan (1x1) mit der neuen Engine: mangels Kamera in der Testumgebung nicht geprüft. Die Schwellen für Schärfe und Spiegelung sind Startwerte.
- 3×3-Albumseiten mit echten Fotos und das Server-Slicing nach der Umstellung auf ganze Fächer.
- Docker-Image und `docker compose`, ein echtes Supabase-Projekt (PostgREST), PWA-Installation und Offline-Betrieb über HTTPS.
- CSV- und JSON-Import/Export sowie der Druck der A4-Schablone.
- Vision-API-Anbindung (Gemini, OpenAI-kompatibel, Ollama) mit echten Schlüsseln.

## Lizenz

MIT
