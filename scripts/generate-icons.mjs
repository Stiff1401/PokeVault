// Renders the PWA icons from public/icons/icon-source.jpg (2048×2048 app icon). Run with `npm run icons`.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const source = await readFile(path.join(dir, 'icon-source.jpg'));

await sharp(source).resize(192, 192).png().toFile(path.join(dir, 'icon-192.png'));
await sharp(source).resize(512, 512).png().toFile(path.join(dir, 'icon-512.png'));
// Maskable: the source artwork already fills the full square edge to edge, so it is used as-is.
await sharp(source).resize(512, 512).png().toFile(path.join(dir, 'icon-maskable-512.png'));
console.log('Icons written to', dir);
