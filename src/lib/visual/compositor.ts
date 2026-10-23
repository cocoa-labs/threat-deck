/**
 * Sharp compositor: layers an AI backdrop + React overlay into a final PNG.
 *
 * The backdrop comes from gpt-image-2 (atmospheric, no text). The overlay
 * comes from @vercel/og (Satori-rendered React JSX with 100% text fidelity).
 * sharp blends them with 'over' (alpha-correct) by default.
 */

import sharp from 'sharp';

export type BlendMode = 'over' | 'screen' | 'overlay' | 'multiply';

export interface CompositeRequest {
  backdrop: Buffer;
  overlay: Buffer;
  width?: number; // default 1200
  height?: number; // default 2400
  blend?: BlendMode; // default 'over'
}

export interface CompositeResult {
  buffer: Buffer;
  width: number;
  height: number;
  format: 'png';
  size: number;
}

export async function composeInfographic(req: CompositeRequest): Promise<CompositeResult> {
  const width = req.width ?? 1200;
  const height = req.height ?? 2400;
  const blend = req.blend ?? 'over';

  // 1. Resize backdrop to target dimensions (preserve aspect with cover fit)
  const backdropResized = await sharp(req.backdrop)
    .resize(width, height, { fit: 'cover', position: 'center' })
    .png()
    .toBuffer();

  // 2. Composite overlay onto backdrop
  const final = await sharp(backdropResized)
    .composite([
      {
        input: req.overlay,
        blend,
        gravity: 'center',
      },
    ])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();

  return {
    buffer: final,
    width,
    height,
    format: 'png',
    size: final.length,
  };
}
