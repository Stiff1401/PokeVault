'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import CardDetailSheet from '@/components/CardDetailSheet';
import { Badge, CardGrid, CardSearch, CardTile, Chip, EmptyState, Icon, PageHeader, Price, Sheet, Spinner, toast } from '@/components/ui';
import { useVaultData, type CardRecord, type Category } from '@/lib/db';
import { categoryLabel, stageLabel, typeLabel, useT } from '@/lib/i18n';
import { useSettings } from '@/lib/settings';
import { getRepository } from '@/lib/storage-adapter';
import { getCard } from '@/lib/tcg-api';
import { useRole } from '@/lib/vault';

type BinderFilter = 'all' | 'vault' | 'trade';
type SortKey = 'setNumber' | 'releaseNew' | 'releaseOld' | 'dex' | 'value' | 'stage' | 'newest';

const CATEGORIES: Category[] = ['Pokémon', 'Trainer', 'Energie'];
const POWER_STAGES = ['ex', 'V', 'VMAX', 'VSTAR'];
const POWER_GROUP = 'ex / V / VMAX / VSTAR';
const STAGES_BY_CATEGORY: Record<Category, string[]> = {
  Pokémon: ['Basis', 'Phase 1', 'Phase 2', POWER_GROUP],
  Trainer: ['Item', 'Unterstützer', 'Stadion', 'Ausrüstung'],
  Energie: ['Basis-Energie', 'Spezial-Energie'],
};
const ALL_STAGES = [...STAGES_BY_CATEGORY['Pokémon'], ...STAGES_BY_CATEGORY.Trainer, ...STAGES_BY_CATEGORY.Energie];
const STAGE_ORDER = ['Basis', 'Phase 1', 'Phase 2', 'ex', 'V', 'VMAX', 'VSTAR', 'Item', 'Unterstützer', 'Stadion', 'Ausrüstung', 'Basis-Energie', 'Spezial-Energie'];
const TYPES = ['Feuer', 'Wasser', 'Pflanze', 'Elektro', 'Psycho', 'Kampf', 'Finsternis', 'Metall', 'Drache', 'Farblos'];

interface Entry {
  card: CardRecord;
  vaultQty: number;
  tradeQty: number;
  newest: string;
  /** Row ids that can give a copy to the other binder. */
  vaultRowId: string | null;
  tradeRowId: string | null;
}

function matchesStage(card: CardRecord, stage: string): boolean {
  if (stage === POWER_GROUP) return POWER_STAGES.includes(card.stage);
  if (stage === 'Basis' || stage === 'Phase 1' || stage === 'Phase 2') return card.stage === stage || card.baseStage === stage;
  return card.stage === stage;
}

function localNumber(card: CardRecord): number {
  const match = card.cardNumber.match(/\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

export default function CollectionPage() {
  const t = useT();
  const { uiLang } = useSettings();
  const role = useRole();
  const vault = useVaultData();

  const [binder, setBinder] = useState<BinderFilter>('all');
  const [text, setText] = useState('');
  const [category, setCategory] = useState<Category | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);
  const [setId, setSetId] = useState('');
  const [rarity, setRarity] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');
  const [showFilters, setShowFilters] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const entries = useMemo(() => {
    const map = new Map<string, Entry>();
    for (const { item, card } of vault.owned) {
      let entry = map.get(card.id);
      if (!entry) {
        entry = { card, vaultQty: 0, tradeQty: 0, newest: item.acquiredAt, vaultRowId: null, tradeRowId: null };
        map.set(card.id, entry);
      }
      entry.vaultQty += item.vaultQuantity;
      entry.tradeQty += item.tradeQuantity;
      if (item.acquiredAt > entry.newest) entry.newest = item.acquiredAt;
      if (item.vaultQuantity > 0 && !entry.vaultRowId) entry.vaultRowId = item.id;
      if (item.tradeQuantity > 0 && !entry.tradeRowId) entry.tradeRowId = item.id;
    }
    return Array.from(map.values());
  }, [vault.owned]);

  const setOptions = useMemo(() => {
    const sets = new Map<string, string>();
    entries.forEach((e) => sets.set(e.card.setId, e.card.setName));
    return Array.from(sets.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [entries]);

  const rarityOptions = useMemo(
    () => Array.from(new Set(entries.map((e) => e.card.rarity).filter((r): r is string => Boolean(r)))).sort(),
    [entries],
  );

  const visible = useMemo(() => {
    const needle = text.trim().toLowerCase();
    const filtered = entries.filter((e) => {
      if (binder === 'vault' && e.vaultQty <= 0) return false;
      if (binder === 'trade' && e.tradeQty <= 0) return false;
      if (category && e.card.category !== category) return false;
      if (stage && !matchesStage(e.card, stage)) return false;
      if (type && !e.card.types.includes(type)) return false;
      if (setId && e.card.setId !== setId) return false;
      if (rarity && e.card.rarity !== rarity) return false;
      if (needle && !`${e.card.name} ${e.card.setName} ${e.card.cardNumber}`.toLowerCase().includes(needle)) return false;
      return true;
    });

    const bySetNumber = (a: Entry, b: Entry) => a.card.setId.localeCompare(b.card.setId) || localNumber(a.card) - localNumber(b.card);
    const sorters: Record<SortKey, (a: Entry, b: Entry) => number> = {
      setNumber: bySetNumber,
      releaseNew: (a, b) => b.card.setReleaseDate.localeCompare(a.card.setReleaseDate) || bySetNumber(a, b),
      releaseOld: (a, b) => a.card.setReleaseDate.localeCompare(b.card.setReleaseDate) || bySetNumber(a, b),
      dex: (a, b) => (a.card.dexId[0] ?? 99999) - (b.card.dexId[0] ?? 99999) || bySetNumber(a, b),
      value: (a, b) => (b.card.cardmarketTrendEur ?? -1) - (a.card.cardmarketTrendEur ?? -1),
      stage: (a, b) => STAGE_ORDER.indexOf(a.card.stage) - STAGE_ORDER.indexOf(b.card.stage) || a.card.name.localeCompare(b.card.name),
      newest: (a, b) => b.newest.localeCompare(a.newest),
    };
    return filtered.sort(sorters[sort]);
  }, [entries, binder, category, stage, type, setId, rarity, text, sort]);

  const visibleValue = visible.reduce(
    (sum, e) => sum + (e.card.cardmarketTrendEur ?? 0) * (binder === 'trade' ? e.tradeQty : binder === 'vault' ? e.vaultQty : e.vaultQty + e.tradeQty),
    0,
  );
  const activeFilters = [category, stage, type, setId, rarity].filter(Boolean).length;
  const stageChoices = category ? STAGES_BY_CATEGORY[category] : ALL_STAGES;

  const move = async (entry: Entry, to: 'vault' | 'trade') => {
    const rowId = to === 'trade' ? entry.vaultRowId : entry.tradeRowId;
    if (!rowId) return;
    try {
      await getRepository().moveCopy(rowId, to);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'warn');
    }
  };

  const resetFilters = () => {
    setCategory(null);
    setStage(null);
    setType(null);
    setSetId('');
    setRarity('');
    setText('');
  };

  if (!vault.ready) {
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={t('Sammlung', 'Collection')}
        subtitle={t('Hauptordner und Tauschmappe im Überblick', 'Main binder and trade binder at a glance')}
        action={
          role === 'editor' ? (
            <button className="btn-primary" onClick={() => setAddOpen(true)}>
              <Icon name="plus" className="h-4 w-4" /> {t('Karte', 'Card')}
            </button>
          ) : undefined
        }
      />

      {entries.length === 0 ? (
        <EmptyState
          title={t('Noch keine Karten', 'No cards yet')}
          text={t('Scanne deine erste Karte oder importiere eine ganze Albumseite.', 'Scan your first card or import a whole binder page.')}
          action={
            role === 'editor' ? (
              <div className="flex gap-2">
                <Link href="/scan" className="btn-primary">
                  <Icon name="scan" className="h-4 w-4" /> {t('Scannen', 'Scan')}
                </Link>
                <Link href="/import" className="btn-ghost">
                  {t('Importieren', 'Import')}
                </Link>
              </div>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Binder switch + search + sort */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="flex rounded-xl bg-ink-900 p-1">
              {(
                [
                  ['all', t('Alle', 'All')],
                  ['vault', t('Hauptordner', 'Main binder')],
                  ['trade', t('Tauschmappe', 'Trade binder')],
                ] as [BinderFilter, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setBinder(id)}
                  aria-pressed={binder === id}
                  className={`min-h-[36px] rounded-lg px-3 text-xs font-semibold ${binder === id ? 'bg-volt-400 text-ink-950' : 'text-slate-400'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="relative min-w-[150px] flex-1">
              <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input className="field pl-9" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('In der Sammlung suchen', 'Search collection')} />
            </div>
            <select className="field w-auto" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label={t('Sortierung', 'Sort order')}>
              <option value="newest">{t('Neuzugänge', 'Recently added')}</option>
              <option value="value">{t('Wert (EUR absteigend)', 'Value (EUR descending)')}</option>
              <option value="setNumber">{t('Set-Nummer', 'Set number')}</option>
              <option value="releaseNew">{t('Set-Erscheinung (neueste)', 'Set release (newest)')}</option>
              <option value="releaseOld">{t('Set-Erscheinung (älteste)', 'Set release (oldest)')}</option>
              <option value="dex">{t('Pokédex-Nummer', 'Pokédex number')}</option>
              <option value="stage">{t('Entwicklungsstufe', 'Evolution stage')}</option>
            </select>
          </div>

          {/* Category row is always visible, the rest folds away on mobile. */}
          <div className="no-scrollbar mb-2 flex items-center gap-2 overflow-x-auto">
            <Chip
              active={!category}
              onClick={() => {
                setCategory(null);
                setStage(null);
              }}
            >
              {t('Alle', 'All')}
            </Chip>
            {CATEGORIES.map((c) => (
              <Chip
                key={c}
                active={category === c}
                onClick={() => {
                  setCategory(category === c ? null : c);
                  setStage(null);
                }}
              >
                {categoryLabel(c, uiLang)}
              </Chip>
            ))}
            <button className={`chip ml-auto ${showFilters || activeFilters ? 'chip-on' : ''}`} onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
              {t('Filter', 'Filters')}
              {activeFilters > 0 && <span className="tabular ml-1.5">{activeFilters}</span>}
            </button>
          </div>

          {showFilters && (
            <div className="panel animate-pop mb-3 space-y-3 p-3">
              <div>
                <p className="label">{t('Entwicklungsstufe', 'Stage')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {stageChoices.map((s) => (
                    <Chip key={s} active={stage === s} onClick={() => setStage(stage === s ? null : s)}>
                      {s === POWER_GROUP ? s : stageLabel(s, uiLang)}
                    </Chip>
                  ))}
                </div>
              </div>
              {category !== 'Trainer' && (
                <div>
                  <p className="label">{t('Typ', 'Type')}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {TYPES.map((x) => (
                      <Chip key={x} active={type === x} onClick={() => setType(type === x ? null : x)}>
                        {typeLabel(x, uiLang)}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="f-set">
                    Set
                  </label>
                  <select id="f-set" className="field" value={setId} onChange={(e) => setSetId(e.target.value)}>
                    <option value="">{t('Alle Sets', 'All sets')}</option>
                    {setOptions.map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="f-rarity">
                    {t('Seltenheit', 'Rarity')}
                  </label>
                  <select id="f-rarity" className="field" value={rarity} onChange={(e) => setRarity(e.target.value)}>
                    <option value="">{t('Alle', 'All')}</option>
                    {rarityOptions.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </div>
              </div>
              {(activeFilters > 0 || text) && (
                <button className="text-xs font-semibold text-volt-300" onClick={resetFilters}>
                  {t('Alle Filter zurücksetzen', 'Reset all filters')}
                </button>
              )}
            </div>
          )}

          <p className="mb-3 text-xs text-slate-400">
            <span className="tabular">{visible.length}</span> {t('Karten', 'cards')} · <Price value={visibleValue} className="font-semibold text-slate-200" />
          </p>

          {visible.length === 0 ? (
            <EmptyState icon="search" title={t('Keine Karte passt zu den Filtern', 'No card matches the filters')} action={<button className="btn-ghost" onClick={resetFilters}>{t('Filter zurücksetzen', 'Reset filters')}</button>} />
          ) : (
            <CardGrid>
              {visible.map((entry) => (
                <CardTile
                  key={entry.card.id}
                  card={entry.card}
                  onClick={() => setDetailId(entry.card.id)}
                  badges={
                    <>
                      {entry.vaultQty > 0 && <Badge>×{entry.vaultQty}</Badge>}
                      {entry.tradeQty > 0 && <Badge tone="volt">T ×{entry.tradeQty}</Badge>}
                      {vault.reservations.has(entry.card.id) && <Badge tone="mint">🎁</Badge>}
                    </>
                  }
                  footer={
                    role === 'editor' ? (
                      <div className="mt-1.5 flex gap-1">
                        <button
                          className="flex min-h-[32px] flex-1 items-center justify-center gap-1 rounded-lg bg-white/[0.05] text-[10px] font-semibold text-slate-300 hover:bg-white/10 disabled:opacity-25"
                          disabled={!entry.tradeRowId}
                          onClick={() => void move(entry, 'vault')}
                          aria-label={t(`${entry.card.name}: eine Kopie in den Hauptordner`, `${entry.card.name}: move one copy to main binder`)}
                        >
                          <Icon name="arrowLeft" className="h-3 w-3" /> H
                        </button>
                        <button
                          className="flex min-h-[32px] flex-1 items-center justify-center gap-1 rounded-lg bg-white/[0.05] text-[10px] font-semibold text-slate-300 hover:bg-white/10 disabled:opacity-25"
                          disabled={!entry.vaultRowId}
                          onClick={() => void move(entry, 'trade')}
                          aria-label={t(`${entry.card.name}: eine Kopie in die Tauschmappe`, `${entry.card.name}: move one copy to trade binder`)}
                        >
                          T <Icon name="arrowRight" className="h-3 w-3" />
                        </button>
                      </div>
                    ) : undefined
                  }
                />
              ))}
            </CardGrid>
          )}
        </>
      )}

      <CardDetailSheet cardId={detailId} onClose={() => setDetailId(null)} />

      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title={t('Karte hinzufügen', 'Add a card')}>
        <CardSearch
          autoFocus
          onPick={async (candidate) => {
            const card = await getCard(candidate.id);
            if (!card) {
              toast(t('Karte konnte nicht geladen werden.', 'Card could not be loaded.'), 'warn');
              return;
            }
            await getRepository().addCopy({ cardId: card.id, binder: 'vault', variant: card.availableVariants[0] });
            toast(t(`${card.name} → Hauptordner`, `${card.name} → main binder`));
            setAddOpen(false);
            setDetailId(card.id);
          }}
        />
      </Sheet>
    </>
  );
}
