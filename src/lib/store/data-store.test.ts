/**
 * Tests for the advisory / patch slice separation.
 *
 * The regression this exists to prevent: `useAdvisoryData` (CERT + vendor) and
 * `usePatchData` (vendor only) both called `setAdvisories()` wholesale, on the
 * same 5-min cadence, with both hooks mounted at once. Last-writer-wins made
 * the slice alternate between two disjoint payloads — so PATCH TRACKER rendered
 * CERT advisories under its vendor tabs, the ticker printed "VENDOR" as a
 * symbol, and the globe pinned vendor patches on the vendor's HQ.
 *
 * The invariant now: one writer per slice, and neither setter can touch the
 * other's data.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { Advisory } from '@/lib/types';
import { useDataStore } from './data-store';

function advisory(overrides: Partial<Advisory>): Advisory {
  return {
    id: 1,
    issuer: 'cisa',
    publishedAt: '2026-07-22T12:00:00Z',
    ...overrides,
  } as Advisory;
}

const CERT = [
  advisory({ id: 11, advisoryId: 'cisa-aa26-1', issuer: 'cisa', title: 'Joint advisory' }),
  advisory({ id: 12, advisoryId: 'ncsc_uk-x', issuer: 'ncsc_uk', title: 'NCSC guidance' }),
];
const VENDOR = [
  advisory({ id: 21, advisoryId: 'chrome-1', issuer: 'vendor', title: 'Chrome Stable Update' }),
];

beforeEach(() => {
  // `lastUpdated` too — the store is a module singleton, so a stamp from a
  // previous test would leak into the independence assertions below.
  useDataStore.setState({ advisories: [], patches: [], lastUpdated: {} });
});

describe('advisories / patches slice separation', () => {
  it('setPatches does not disturb the CERT advisories slice', () => {
    useDataStore.getState().setAdvisories(CERT);
    useDataStore.getState().setPatches(VENDOR);

    expect(useDataStore.getState().advisories).toEqual(CERT);
    expect(useDataStore.getState().patches).toEqual(VENDOR);
  });

  it('setAdvisories does not disturb the vendor patches slice', () => {
    useDataStore.getState().setPatches(VENDOR);
    useDataStore.getState().setAdvisories(CERT);

    expect(useDataStore.getState().patches).toEqual(VENDOR);
    expect(useDataStore.getState().advisories).toEqual(CERT);
  });

  it('survives the interleaved poll order that used to clobber — the actual bug', () => {
    // Both hooks poll on the same interval; this is the sequence that made the
    // slice thrash between disjoint payloads.
    for (let i = 0; i < 3; i++) {
      useDataStore.getState().setAdvisories(CERT);
      useDataStore.getState().setPatches(VENDOR);
    }

    const { advisories, patches } = useDataStore.getState();
    expect(advisories).toHaveLength(2);
    expect(patches).toHaveLength(1);
    // No vendor item may ever appear in the CERT slice, and vice versa.
    expect(advisories.every((a) => a.issuer !== 'vendor')).toBe(true);
    expect(patches.every((p) => p.issuer === 'vendor')).toBe(true);
  });

  it('stamps each slice independently in lastUpdated', () => {
    useDataStore.getState().setAdvisories(CERT);
    const afterCert = useDataStore.getState().lastUpdated;
    expect(afterCert.advisories).toBeTypeOf('number');
    expect(afterCert.patches).toBeUndefined();

    useDataStore.getState().setPatches(VENDOR);
    const afterVendor = useDataStore.getState().lastUpdated;
    expect(afterVendor.patches).toBeTypeOf('number');
    // The CERT stamp survives the vendor write.
    expect(afterVendor.advisories).toBe(afterCert.advisories);
  });

  it('both slices start empty', () => {
    expect(useDataStore.getState().advisories).toEqual([]);
    expect(useDataStore.getState().patches).toEqual([]);
  });
});
