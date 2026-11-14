import type { NextRequest } from 'next/server';
import sharp from 'sharp';
import { authorize, corsHeaders, json } from '@/server/vault-auth';

/**
 * POST /api/slice – cuts a high-resolution binder page photo into one image
 * per pocket with `sharp` (self-hosted build only).
 *
 * multipart/form-data: image (file), grid (JSON BinderGrid), width (max. px per pocket)
 * headers: x-vault-id, x-vault-token (editor role required)
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 40 * 1024 * 1024;

interface Grid {
  rows: number;
  cols: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  gapX: number;
  gapY: number;
}

function parseGrid(raw: FormDataEntryValue | null): Grid | null {
  if (typeof raw !== 'string') return null;
  try {
    const g = JSON.parse(raw) as Partial<Grid>;
    const unit = (v: unknown) => typeof v === 'number' && v >= 0 && v <= 1;
    if (![2, 3].includes(Number(g.rows)) || ![2, 3].includes(Number(g.cols))) return null;
    if (!unit(g.left) || !unit(g.top) || !unit(g.right) || !unit(g.bottom) || !unit(g.gapX) || !unit(g.gapY)) return null;
    if ((g.right as number) <= (g.left as number) || (g.bottom as number) <= (g.top as number)) return null;
    return g as Grid;
  } catch {
    return null;
  }
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
}

export async function POST(request: NextRequest): Promise<Response> {
  const origin = request.headers.get('origin');
  const session = await authorize(request.headers.get('x-vault-id') ?? '', request.headers.get('x-vault-token'));
  if (!session || session.role !== 'editor') return json({ error: 'Not authorised' }, 401, origin);

  const form = await request.formData().catch(() => null);
  const file = form?.get('image');
  const grid = parseGrid(form?.get('grid') ?? null);
  if (!form || !(file instanceof Blob) || !grid) return json({ error: 'Expected image file and grid' }, 400, origin);
  if (file.size > MAX_BYTES) return json({ error: 'Image too large (max. 40 MB)' }, 413, origin);
  const pocketWidth = Math.max(300, Math.min(2400, Math.floor(Number(form.get('width')) || 1800)));

  try {
    // `.rotate()` applies the EXIF orientation so the grid matches what the browser showed.
    const upright = await sharp(Buffer.from(await file.arrayBuffer())).rotate().toBuffer({ resolveWithObject: true });
    const width = upright.info.width;
    const height = upright.info.height;

    const areaW = (grid.right - grid.left) * width;
    const areaH = (grid.bottom - grid.top) * height;
    const gapX = grid.gapX * areaW;
    const gapY = grid.gapY * areaH;
    const cellW = (areaW - gapX * (grid.cols - 1)) / grid.cols;
    const cellH = (areaH - gapY * (grid.rows - 1)) / grid.rows;

    const slices: string[] = [];
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        // Whole pocket at (up to) photo resolution – the client locates the card inside.
        const left = Math.max(0, Math.round(grid.left * width + col * (cellW + gapX)));
        const top = Math.max(0, Math.round(grid.top * height + row * (cellH + gapY)));
        const region = {
          left,
          top,
          width: Math.max(1, Math.min(Math.round(cellW), width - left)),
          height: Math.max(1, Math.min(Math.round(cellH), height - top)),
        };
        const buffer = await sharp(upright.data)
          .extract(region)
          .resize({ width: Math.min(region.width, pocketWidth), withoutEnlargement: true })
          .jpeg({ quality: 92 })
          .toBuffer();
        slices.push(`data:image/jpeg;base64,${buffer.toString('base64')}`);
      }
    }
    return json({ slices }, 200, origin);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Image could not be processed' }, 422, origin);
  }
}
