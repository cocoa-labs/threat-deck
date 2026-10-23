/**
 * Renders the InfographicTemplate to a PNG buffer via Satori + @vercel/og.
 *
 * @vercel/og's ImageResponse wraps Satori (JSX → SVG) + resvg-wasm (SVG → PNG).
 * Returns a Buffer ready for sharp compositing.
 */

import { ImageResponse } from '@vercel/og';
import { createElement } from 'react';
import { loadFonts } from './fonts';
import { type InfographicProps, InfographicTemplate } from './InfographicTemplate';

const WIDTH = 1200;
const HEIGHT = 2400;

export async function renderInfographicOverlay(props: InfographicProps): Promise<Buffer> {
  const fonts = loadFonts().map((f) => ({
    name: f.name,
    data: f.data,
    weight: f.weight,
    style: f.style,
  }));

  const response = new ImageResponse(createElement(InfographicTemplate, props), {
    width: WIDTH,
    height: HEIGHT,
    fonts: fonts as never, // @vercel/og's font type is structurally compatible
  });

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
