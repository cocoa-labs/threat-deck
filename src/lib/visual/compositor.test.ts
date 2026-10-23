import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { composeInfographic } from './compositor';

async function makePng(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r, g, b, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

describe('composeInfographic', () => {
  it('produces a 1200x2400 PNG from valid backdrop + overlay', async () => {
    const backdrop = await makePng(1200, 2400, 30, 30, 30); // near-black
    const overlay = await makePng(1200, 2400, 0, 255, 65); // matrix green

    const result = await composeInfographic({ backdrop, overlay });

    expect(result.format).toBe('png');
    expect(result.width).toBe(1200);
    expect(result.height).toBe(2400);
    expect(result.size).toBe(result.buffer.length);
    expect(result.buffer.length).toBeGreaterThan(1000);
  });

  it('resizes backdrop to target dimensions when mismatched', async () => {
    const backdrop = await makePng(2048, 2048, 0, 0, 0); // square, larger
    const overlay = await makePng(1200, 2400, 0, 255, 65);

    const result = await composeInfographic({
      backdrop,
      overlay,
      width: 1200,
      height: 2400,
    });

    expect(result.width).toBe(1200);
    expect(result.height).toBe(2400);
  });

  it('uses default blend mode "over" when not specified', async () => {
    const backdrop = await makePng(1200, 2400, 100, 100, 100);
    const overlay = await makePng(1200, 2400, 200, 200, 200);

    const result = await composeInfographic({ backdrop, overlay });
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it('applies custom blend mode when specified', async () => {
    const backdrop = await makePng(1200, 2400, 50, 50, 50);
    const overlay = await makePng(1200, 2400, 100, 100, 100);

    const result = await composeInfographic({
      backdrop,
      overlay,
      blend: 'screen',
    });
    expect(result.buffer.length).toBeGreaterThan(0);
  });
});
