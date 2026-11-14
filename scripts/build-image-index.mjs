// Builds the visual card index used by the offline recognition engine.
//
//   npm run build:index                 (German cards, default)
//   node scripts/build-image-index.mjs --lang en --cache .cache/card-images --thumb 18x24
//
// Output (per language):
//   public/image-index/<lang>.json  catalogue: sets + every card (id, number, name)
//   public/image-index/<lang>.bin   one 18x24 RGB thumbnail (1296 bytes) per card that has artwork
//
// The app compares a photographed card against these thumbnails, so cards are
// recognised by their artwork instead of relying on OCR through sleeves and foil.
// Source of all data and images: TCGdex (https://tcgdex.dev).
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const lang = option('lang', 'de');
const cacheDir = path.resolve(option('cache', path.join(root, '.cache', 'card-images', lang)));
const outDir = path.join(root, 'public', 'image-index');
// Thumbnail size; the app needs 36 and 48 to be multiples of it (18x24 default, 12x16 for a smaller download).
const [THUMB_W, THUMB_H] = option('thumb', '18x24').split('x').map(Number);
const FINE_W = 36;
const FINE_H = 48;
if (FINE_W % THUMB_W !== 0 || FINE_H % THUMB_H !== 0) throw new Error('Thumbnail size must divide 36x48, e.g. 12x16 or 18x24');

function blockMean(fine) {
  const bx = FINE_W / THUMB_W;
  const by = FINE_H / THUMB_H;
  const out = Buffer.alloc(THUMB_W * THUMB_H * 3);
  for (let y = 0; y < THUMB_H; y++) {
    for (let x = 0; x < THUMB_W; x++) {
      for (let k = 0; k < 3; k++) {
        let sum = 0;
        for (let yy = 0; yy < by; yy++) for (let xx = 0; xx < bx; xx++) sum += fine[((y * by + yy) * FINE_W + x * bx + xx) * 3 + k];
        out[(y * THUMB_W + x) * 3 + k] = Math.round(sum / (bx * by));
      }
    }
  }
  return out;
}

// Digital-only TCG Pocket sets are not physical cards.
const isPhysical = (setId) => !/^(A\d|B\d|P-A)/.test(setId);

mkdirSync(cacheDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

async function getJson(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      if (res.status === 404) return null;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
  }
  return null;
}

async function pool(items, size, worker) {
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) await worker(items[next++]);
    }),
  );
}

console.log(`Loading ${lang} catalogue from TCGdex …`);
const setList = (await getJson(`https://api.tcgdex.net/v2/${lang}/sets`)) ?? [];
const sets = [];
await pool(setList.filter((s) => isPhysical(s.id)), 8, async (summary) => {
  const detail = await getJson(`https://api.tcgdex.net/v2/${lang}/sets/${encodeURIComponent(summary.id)}`);
  if (detail) sets.push(detail);
});
sets.sort((a, b) => (a.releaseDate ?? '').localeCompare(b.releaseDate ?? '') || a.id.localeCompare(b.id));

const cards = [];
for (const set of sets) for (const card of set.cards ?? []) cards.push({ id: card.id, localId: card.localId, name: card.name, image: card.image ?? '' });
console.log(`${sets.length} sets, ${cards.length} cards, ${cards.filter((c) => c.image).length} with artwork`);

const thumbs = new Map();
let done = 0;
await pool(cards.filter((c) => c.image), 20, async (card) => {
  const file = path.join(cacheDir, card.id.replace(/[^\w.-]/g, '_') + '.webp');
  let buffer = existsSync(file) ? readFileSync(file) : null;
  for (let attempt = 0; attempt < 3 && !buffer; attempt++) {
    try {
      const res = await fetch(`${card.image}/low.webp`);
      if (res.ok) {
        buffer = Buffer.from(await res.arrayBuffer());
        writeFileSync(file, buffer);
      } else if (res.status === 404) break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (buffer) {
    try {
      // Same pooling as the app applies to the photo: 36x48 pixels, averaged in blocks.
      const fine = await sharp(buffer).resize(FINE_W, FINE_H, { fit: 'fill' }).removeAlpha().raw().toBuffer();
      thumbs.set(card.id, blockMean(fine));
    } catch {
      /* unreadable image – card stays text-only */
    }
  }
  if (++done % 2000 === 0) console.log(`  ${done} images`);
});

// All artwork of a set lives under one URL prefix: <imageBase>/<localId>/low.webp
function imageBaseOf(set) {
  const first = (set.cards ?? []).find((c) => c.image);
  if (!first) return '';
  const base = first.image.slice(0, first.image.lastIndexOf('/'));
  const odd = (set.cards ?? []).filter((c) => c.image && c.image !== base + '/' + c.localId).length;
  if (odd) console.warn('  ' + set.id + ': ' + odd + ' cards with a non-standard image URL');
  return base;
}

// Cards with a thumbnail come first, in the same order as the rows of the .bin file.
const withThumb = cards.filter((c) => thumbs.has(c.id));
const withoutThumb = cards.filter((c) => !thumbs.has(c.id));
const catalogue = {
  version: 1,
  lang,
  builtAt: new Date().toISOString(),
  thumb: { width: THUMB_W, height: THUMB_H, count: withThumb.length },
  sets: sets.map((s) => ({
    id: s.id,
    name: s.name,
    code: s.abbreviation?.official ?? '',
    official: s.cardCount?.official ?? 0,
    releaseDate: s.releaseDate ?? '',
    imageBase: imageBaseOf(s),
  })),
  // [id, localId, name]
  cards: [...withThumb, ...withoutThumb].map((c) => [c.id, c.localId, c.name]),
};
writeFileSync(path.join(outDir, `${lang}.bin`), Buffer.concat(withThumb.map((c) => thumbs.get(c.id))));
writeFileSync(path.join(outDir, `${lang}.json`), JSON.stringify(catalogue));
console.log(`Wrote ${withThumb.length} thumbnails (${((withThumb.length * THUMB_W * THUMB_H * 3) / 1e6).toFixed(1)} MB) and ${cards.length} catalogue entries to ${outDir}`);
