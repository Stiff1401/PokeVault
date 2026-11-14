'use client';

import { useEffect, useRef, useState } from 'react';
import BinderGridCalibrator from '@/components/BinderGridCalibrator';
import { CardImage, CardSearch, Icon, PageHeader, Price, Section, Sheet, Spinner, Tabs, toast } from '@/components/ui';
import { db, type CardRecord } from '@/lib/db';
import {
  downloadTextFile,
  exportBackupJson,
  exportCollectionCsv,
  importBackupJson,
  importCollectionCsv,
  type ImportReport,
} from '@/lib/csv';
import { useT } from '@/lib/i18n';
import {
  canvasToDataUrl,
  cropBox,
  defaultGrid,
  loadImage,
  recognizeCard,
  sliceBinderPage,
  sliceBinderPageOnServer,
  type BinderGrid,
} from '@/lib/recognition';
import { useSettings } from '@/lib/settings';
import { getRepository, type Binder } from '@/lib/storage-adapter';
import { getCard, getSet, type MatchCandidate } from '@/lib/tcg-api';
import { accessToken, useVaultConfig } from '@/lib/vault';

type TabId = 'binder' | 'files';

interface SliceResult {
  index: number;
  thumb: string;
  status: 'pending' | 'working' | 'done';
  card: CardRecord | null;
  candidates: MatchCandidate[];
  include: boolean;
  binder: Binder;
  readText: string;
  /** Match score of the chosen card (0..1). */
  score: number;
}

/** From this score a card is ticked for import automatically. */
const INCLUDE_SCORE = 0.6;
/** Artwork and collector number agree. */
const CERTAIN_SCORE = 0.9;

export default function ImportPage() {
  const t = useT();
  const settings = useSettings();
  const config = useVaultConfig();
  const [tab, setTab] = useState<TabId>('binder');

  /* ---------------- binder slicer ---------------- */
  const [size, setSize] = useState<2 | 3>(3);
  const [queue, setQueue] = useState<File[]>([]);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [grid, setGrid] = useState<BinderGrid>(defaultGrid(3));
  const [slices, setSlices] = useState<SliceResult[] | null>(null);
  const [processing, setProcessing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const runId = useRef(0);

  const currentFile = queue[0] ?? null;

  useEffect(() => {
    if (!currentFile) {
      setImageUrl(null);
      return;
    }
    const url = URL.createObjectURL(currentFile);
    setImageUrl(url);
    setSlices(null);
    return () => URL.revokeObjectURL(url);
  }, [currentFile]);

  const changeSize = (next: 2 | 3) => {
    setSize(next);
    setGrid((g) => ({ ...g, rows: next, cols: next }));
    setSlices(null);
  };

  const patchSlice = (index: number, patch: Partial<SliceResult>) => {
    setSlices((list) => (list ? list.map((s) => (s.index === index ? { ...s, ...patch } : s)) : list));
  };

  const recognizeAll = async () => {
    if (!currentFile || !imageUrl) return;
    const id = ++runId.current;
    setProcessing(true);
    try {
      let canvases: HTMLCanvasElement[];
      const useServer = settings.serverSlicing && config?.driver === 'selfhosted' && Boolean(config.endpoint);
      if (useServer && config) {
        try {
          canvases = await sliceBinderPageOnServer(currentFile, grid, config.endpoint, {
            vaultId: config.vaultId,
            token: await accessToken(config.vaultId, config.pin),
          });
        } catch {
          canvases = sliceBinderPage(await loadImage(imageUrl), grid);
          toast(t('Server-Slicing nicht erreichbar – lokal geschnitten.', 'Server slicing unreachable – sliced locally.'), 'warn');
        }
      } else {
        canvases = sliceBinderPage(await loadImage(imageUrl), grid);
      }
      if (id !== runId.current) return;

      const owned = new Set((await db.collection.toArray()).filter((i) => i.vaultQuantity > 0).map((i) => i.cardId));
      setSlices(
        canvases.map((canvas, index) => ({
          index,
          thumb: canvasToDataUrl(canvas, 220, 0.7),
          status: 'pending',
          card: null,
          candidates: [],
          include: false,
          binder: 'vault',
          readText: '',
          score: 0,
        })),
      );

      const picks: { index: number; card: CardRecord | null; candidates: MatchCandidate[]; score: number }[] = [];

      // Sequential: one OCR worker / gentle on vision API rate limits.
      // Each canvas is a whole pocket at photo resolution; the engine finds the card inside.
      for (let index = 0; index < canvases.length; index++) {
        if (id !== runId.current) return;
        patchSlice(index, { status: 'working' });
        try {
          const result = await recognizeCard(canvases[index], 'pocket');
          const best = result.candidates[0];
          const card = best ? await getCard(best.id) : null;
          if (id !== runId.current) return;
          patchSlice(index, {
            status: 'done',
            card,
            candidates: result.candidates,
            score: best?.score ?? 0,
            // Show exactly the rectangle in which the card was found.
            ...(result.box ? { thumb: canvasToDataUrl(cropBox(canvases[index], result.box), 220, 0.7) } : {}),
            include: Boolean(card) && (best?.score ?? 0) >= INCLUDE_SCORE,
            // Smart routing: cards already in the main binder go to the trade binder.
            binder: card && owned.has(card.id) ? 'trade' : 'vault',
            readText: [result.extraction.name, result.extraction.cardNumber].filter(Boolean).join(' · '),
          });
          picks.push({ index, card, candidates: result.candidates, score: best?.score ?? 0 });
          if (card) owned.add(card.id);
        } catch {
          patchSlice(index, { status: 'done' });
        }
      }

      // A binder page usually holds one set. When most pockets agree on a set,
      // an outlier switches to its candidate from that set (e.g. unreadable number).
      const perSet = new Map<string, number>();
      for (const pick of picks) if (pick.card) perSet.set(pick.card.setId, (perSet.get(pick.card.setId) ?? 0) + 1);
      const [majoritySet, majorityCount] = Array.from(perSet.entries()).sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
      if (majorityCount > canvases.length / 2) {
        const plainName = (name: string) => name.replace(/[\s-]+(ex|EX|GX|V|VMAX|VSTAR)$/, '').trim().toLowerCase();
        const majorityCards = await getSet(majoritySet)
          .then((set) => set.cards)
          .catch(() => []);
        for (const pick of picks) {
          if (id !== runId.current) return;
          // Cards confirmed by artwork and number stay as they are.
          if (!pick.card || pick.card.setId === majoritySet || pick.score >= CERTAIN_SCORE) continue;
          const top = pick.candidates[0]?.score ?? 0;
          // Same Pokémon printed in the page's set, or a close-scoring candidate from it.
          const sameName = majorityCards.filter((c) => plainName(c.name) === plainName(pick.card?.name ?? ''));
          const alternativeId =
            (sameName.length === 1 ? sameName[0].id : undefined) ??
            pick.candidates.find((c) => c.setId === majoritySet && c.score >= top - 0.3)?.id;
          const card = alternativeId ? await getCard(alternativeId) : null;
          if (card) patchSlice(pick.index, { card, binder: owned.has(card.id) ? 'trade' : 'vault' });
        }
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'warn');
    } finally {
      if (id === runId.current) setProcessing(false);
    }
  };

  const commit = async () => {
    if (!slices) return;
    const chosen = slices.filter((s) => s.include && s.card);
    setCommitting(true);
    try {
      const repo = getRepository();
      for (const slice of chosen) {
        if (!slice.card) continue;
        await repo.addCopy({ cardId: slice.card.id, binder: slice.binder, variant: slice.card.availableVariants[0] });
      }
      toast(t(`${chosen.length} Karten übernommen`, `${chosen.length} cards added`));
      runId.current += 1;
      setSlices(null);
      setQueue((q) => q.slice(1));
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'warn');
    } finally {
      setCommitting(false);
    }
  };

  const skipPhoto = () => {
    runId.current += 1;
    setProcessing(false);
    setSlices(null);
    setQueue((q) => q.slice(1));
  };

  /* ---------------- CSV / JSON ---------------- */
  const [report, setReport] = useState<ImportReport | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const csvInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);

  const stamp = () => new Date().toISOString().slice(0, 10);

  const runImport = async (file: File | undefined, kind: 'csv' | 'json') => {
    if (!file) return;
    setFileBusy(true);
    setReport(null);
    try {
      const text = await file.text();
      setReport(kind === 'csv' ? await importCollectionCsv(text) : await importBackupJson(text));
    } catch (err) {
      setReport({ imported: 0, skipped: 0, errors: [err instanceof Error ? err.message : String(err)] });
    } finally {
      setFileBusy(false);
    }
  };

  const includedCount = slices?.filter((s) => s.include && s.card).length ?? 0;
  const editing = editIndex !== null ? (slices?.find((s) => s.index === editIndex) ?? null) : null;

  return (
    <>
      <PageHeader title={t('Import & Export', 'Import & export')} subtitle={t('Ganze Albumseiten einlesen oder Daten sichern', 'Read whole binder pages or back up your data')} />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'binder', label: t('Albumseite (2×2 / 3×3)', 'Binder page (2×2 / 3×3)') },
          { id: 'files', label: 'CSV & JSON' },
        ]}
      />

      {tab === 'binder' && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="flex rounded-xl bg-ink-900 p-1">
              {([2, 3] as const).map((n) => (
                <button
                  key={n}
                  className={`min-h-[38px] rounded-lg px-4 text-sm font-semibold ${size === n ? 'bg-volt-400 text-ink-950' : 'text-slate-400'}`}
                  onClick={() => changeSize(n)}
                  aria-pressed={size === n}
                >
                  {n}×{n} <span className="font-normal opacity-70">({n * n} {t('Fächer', 'pockets')})</span>
                </button>
              ))}
            </div>
            <button className="btn-primary" onClick={() => photoInput.current?.click()}>
              <Icon name="upload" className="h-4 w-4" /> {t('Fotos wählen', 'Choose photos')}
            </button>
            {queue.length > 1 && (
              <span className="tabular text-xs text-slate-400">
                {t(`noch ${queue.length - 1} weitere in der Warteschlange`, `${queue.length - 1} more in the queue`)}
              </span>
            )}
            <input
              ref={photoInput}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                setQueue((q) => [...q, ...Array.from(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
          </div>

          {!imageUrl && (
            <div className="panel px-6 py-10 text-center">
              <p className="font-semibold">{t('So klappt der Bulk-Import', 'How bulk import works')}</p>
              <ol className="mx-auto mt-3 max-w-md list-decimal space-y-1.5 pl-5 text-left text-sm text-slate-400">
                <li>{t('Albumseite gerade von oben fotografieren (Stativ, indirektes Tageslicht).', 'Photograph the binder page straight from above (tripod, indirect daylight).')}</li>
                <li>{t('Gitter mit den vier Eckpunkten auf die Fächer ziehen.', 'Drag the four grid corners onto the pockets.')}</li>
                <li>{t('Erkennung starten, Treffer prüfen, übernehmen.', 'Start recognition, review the matches, commit.')}</li>
              </ol>
            </div>
          )}

          {imageUrl && !slices && (
            <>
              <BinderGridCalibrator imageUrl={imageUrl} grid={grid} onChange={setGrid} />
              <div className="mx-auto mt-4 flex max-w-xl gap-2">
                <button className="btn-primary flex-1" onClick={() => void recognizeAll()} disabled={processing}>
                  {processing ? <Spinner className="h-4 w-4" /> : <Icon name="scan" className="h-4 w-4" />}
                  {t(`${size * size} Karten erkennen`, `Recognise ${size * size} cards`)}
                </button>
                <button className="btn-ghost" onClick={skipPhoto}>
                  {t('Foto überspringen', 'Skip photo')}
                </button>
              </div>
            </>
          )}

          {slices && (
            <>
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {slices.map((slice) => (
                  <div key={slice.index} className={`panel p-3 ${slice.include ? 'border-volt-400/50' : ''}`}>
                    <div className="flex gap-3">
                      <div className="relative w-16 shrink-0">
                        <CardImage src={slice.thumb} name={`#${slice.index + 1}`} />
                        <span className="tabular absolute left-1 top-1 rounded bg-volt-400 px-1.5 text-[10px] font-bold text-ink-950">{slice.index + 1}</span>
                      </div>
                      <div className="w-16 shrink-0">
                        {slice.status !== 'done' ? (
                          <div className="flex aspect-card items-center justify-center rounded-md bg-ink-800">{slice.status === 'working' ? <Spinner /> : <span className="text-slate-600">…</span>}</div>
                        ) : slice.card ? (
                          <CardImage src={slice.card.imageUrl} name={slice.card.name} />
                        ) : (
                          <div className="flex aspect-card items-center justify-center rounded-md border border-dashed border-white/15 text-center text-[10px] text-slate-500">
                            {t('kein Treffer', 'no match')}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1 text-xs">
                        {slice.card ? (
                          <>
                            <p className="truncate text-sm font-semibold">{slice.card.name}</p>
                            <p className="truncate text-slate-400">
                              {slice.card.setName} · {slice.card.cardNumber}
                            </p>
                            <Price value={slice.card.cardmarketTrendEur} className="font-semibold text-volt-300" />
                            {slice.score > 0 && (
                              <span
                                className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                  slice.score >= CERTAIN_SCORE ? 'bg-mint-400/15 text-mint-400' : slice.score >= INCLUDE_SCORE ? 'bg-volt-400/15 text-volt-300' : 'bg-ember-500/15 text-ember-400'
                                }`}
                              >
                                {slice.score >= CERTAIN_SCORE
                                  ? t('Bild + Nummer', 'artwork + number')
                                  : slice.score >= INCLUDE_SCORE
                                    ? t('bitte prüfen', 'please check')
                                    : t('unsicher', 'uncertain')}
                              </span>
                            )}
                          </>
                        ) : (
                          <p className="text-slate-400">
                            {slice.status === 'done'
                              ? slice.readText
                                ? t(`Gelesen: ${slice.readText}`, `Read: ${slice.readText}`)
                                : t('Leeres Fach oder nicht lesbar', 'Empty pocket or unreadable')
                              : t('Wird erkannt …', 'Recognising …')}
                          </p>
                        )}
                        {slice.status === 'done' && (
                          <button className="mt-1 font-semibold text-slate-200 underline underline-offset-4" onClick={() => setEditIndex(slice.index)}>
                            {slice.card ? t('Ändern', 'Change') : t('Karte suchen', 'Find card')}
                          </button>
                        )}
                      </div>
                    </div>
                    {slice.card && (
                      <div className="mt-2.5 flex items-center gap-2">
                        <label className="flex flex-1 items-center gap-2 text-xs">
                          <input type="checkbox" className="h-4 w-4 accent-volt-400" checked={slice.include} onChange={(e) => patchSlice(slice.index, { include: e.target.checked })} />
                          {t('Übernehmen', 'Include')}
                        </label>
                        <div className="flex rounded-lg bg-ink-800 p-0.5">
                          {(['vault', 'trade'] as Binder[]).map((b) => (
                            <button
                              key={b}
                              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${slice.binder === b ? 'bg-white/15 text-white' : 'text-slate-500'}`}
                              onClick={() => patchSlice(slice.index, { binder: b })}
                              aria-pressed={slice.binder === b}
                            >
                              {b === 'vault' ? t('Hauptordner', 'Main') : t('Tauschmappe', 'Trade')}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="sticky bottom-20 z-10 mt-4 flex gap-2 md:bottom-4">
                <button className="btn-primary flex-1 shadow-xl" onClick={() => void commit()} disabled={processing || committing || includedCount === 0}>
                  {committing ? <Spinner className="h-4 w-4" /> : <Icon name="check" className="h-4 w-4" />}
                  {processing ? t('Erkennung läuft …', 'Recognition running …') : t(`${includedCount} Karten übernehmen`, `Add ${includedCount} cards`)}
                </button>
                <button className="btn-ghost bg-ink-900" onClick={() => { runId.current += 1; setProcessing(false); setSlices(null); }}>
                  {t('Gitter anpassen', 'Adjust grid')}
                </button>
                <button className="btn-ghost bg-ink-900" onClick={skipPhoto}>
                  {t('Verwerfen', 'Discard')}
                </button>
              </div>
            </>
          )}
        </>
      )}

      {tab === 'files' && (
        <>
          <Section title={t('Export', 'Export')}>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <button className="panel flex items-center gap-3 p-4 text-left hover:border-volt-400/40" onClick={async () => downloadTextFile(`pokevault-${stamp()}.csv`, await exportCollectionCsv(), 'text/csv')}>
                <Icon name="download" className="h-6 w-6 shrink-0 text-volt-300" />
                <span>
                  <span className="block font-semibold">{t('Sammlung als CSV', 'Collection as CSV')}</span>
                  <span className="text-xs text-slate-400">{t('Für Excel, Numbers oder Google Sheets', 'For Excel, Numbers or Google Sheets')}</span>
                </span>
              </button>
              <button className="panel flex items-center gap-3 p-4 text-left hover:border-volt-400/40" onClick={async () => downloadTextFile(`pokevault-backup-${stamp()}.json`, await exportBackupJson(), 'application/json')}>
                <Icon name="download" className="h-6 w-6 shrink-0 text-volt-300" />
                <span>
                  <span className="block font-semibold">{t('Vollständiges JSON-Backup', 'Full JSON backup')}</span>
                  <span className="text-xs text-slate-400">{t('Sammlung, Ziel-Sets, Preisverlauf, eigene Scans', 'Collection, target sets, price history, own scans')}</span>
                </span>
              </button>
            </div>
          </Section>

          <Section title={t('Import', 'Import')}>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <button className="panel flex items-center gap-3 p-4 text-left hover:border-volt-400/40" onClick={() => csvInput.current?.click()} disabled={fileBusy}>
                <Icon name="upload" className="h-6 w-6 shrink-0 text-slate-300" />
                <span>
                  <span className="block font-semibold">{t('CSV importieren', 'Import CSV')}</span>
                  <span className="text-xs text-slate-400">
                    {t('Pflichtspalte: cardId (z. B. sv03.5-199). Optional: variant, condition, vaultQuantity, tradeQuantity.', 'Required column: cardId (e.g. sv03.5-199). Optional: variant, condition, vaultQuantity, tradeQuantity.')}
                  </span>
                </span>
              </button>
              <button className="panel flex items-center gap-3 p-4 text-left hover:border-volt-400/40" onClick={() => jsonInput.current?.click()} disabled={fileBusy}>
                <Icon name="upload" className="h-6 w-6 shrink-0 text-slate-300" />
                <span>
                  <span className="block font-semibold">{t('JSON-Backup wiederherstellen', 'Restore JSON backup')}</span>
                  <span className="text-xs text-slate-400">{t('Führt das Backup mit dem aktuellen Vault zusammen.', 'Merges the backup into the current vault.')}</span>
                </span>
              </button>
            </div>
            <input ref={csvInput} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { void runImport(e.target.files?.[0], 'csv'); e.target.value = ''; }} />
            <input ref={jsonInput} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { void runImport(e.target.files?.[0], 'json'); e.target.value = ''; }} />

            {fileBusy && (
              <p className="mt-4 flex items-center gap-2 text-sm text-slate-400">
                <Spinner className="h-4 w-4" /> {t('Import läuft – Karten werden bei TCGdex geprüft …', 'Importing – verifying cards with TCGdex …')}
              </p>
            )}
            {report && (
              <div className={`mt-4 rounded-xl p-4 text-sm ${report.imported > 0 ? 'bg-mint-400/10 text-mint-400' : 'bg-ember-500/10 text-ember-400'}`} role="status">
                <p className="font-semibold">
                  {t(`${report.imported} Einträge importiert, ${report.skipped} übersprungen.`, `${report.imported} entries imported, ${report.skipped} skipped.`)}
                </p>
                {report.errors.length > 0 && (
                  <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate-300">
                    {report.errors.slice(0, 12).map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                    {report.errors.length > 12 && <li>… +{report.errors.length - 12}</li>}
                  </ul>
                )}
              </div>
            )}
          </Section>
        </>
      )}

      <Sheet open={editing !== null} onClose={() => setEditIndex(null)} title={t(`Fach ${(editIndex ?? 0) + 1}: Karte wählen`, `Pocket ${(editIndex ?? 0) + 1}: pick a card`)}>
        {editing && (
          <>
            {editing.candidates.length > 0 && (
              <div className="mb-5">
                <p className="eyebrow mb-2">{t('Erkannte Treffer', 'Recognised matches')}</p>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {editing.candidates.map((c) => (
                    <button
                      key={c.id}
                      className="min-w-0 text-left"
                      onClick={async () => {
                        const card = await getCard(c.id);
                        if (card) patchSlice(editing.index, { card, include: true });
                        setEditIndex(null);
                      }}
                    >
                      <CardImage src={c.image} name={c.name} />
                      <p className="mt-1 truncate text-[11px] font-semibold">{c.name}</p>
                      <p className="truncate text-[10px] text-slate-500">{c.setName}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <CardSearch
              onPick={async (c) => {
                const card = await getCard(c.id);
                if (card) patchSlice(editing.index, { card, include: true });
                setEditIndex(null);
              }}
            />
          </>
        )}
      </Sheet>
    </>
  );
}
