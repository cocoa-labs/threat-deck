import { NextResponse } from 'next/server';
import { dataProvenance } from './provenance';
export function feedResponse(body: object, init?: ResponseInit): NextResponse {
  return NextResponse.json({ ...body, provenance: dataProvenance(body) }, init);
}
