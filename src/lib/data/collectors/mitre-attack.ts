/**
 * MITRE ATT&CK collector — downloads the enterprise STIX 2.1 bundle from
 * the MITRE CTI GitHub repo and extracts tactics, techniques, and groups.
 *
 * Source: https://raw.githubusercontent.com/mitre/cti/master/enterprise-attack/enterprise-attack.json
 *
 * The bundle is ~10 MB; we cache aggressively (24h) and rate-limit heavily.
 * Returns DEMO data on any failure — never throws.
 *
 * `MitreTactic` and `MitreTechnique` are not in src/lib/types.ts (per Phase 2
 * scope — types.ts is owned by another phase), so we export them inline here.
 */

import type { ThreatActor } from '@/lib/types';
import { fetchWithTimeout } from '../fetch-with-timeout';
import { checkRateLimit, getCached, isBackedOff, setBackoff, setCache } from '../rate-limiter';

const MITRE_BUNDLE_URL =
  'https://raw.githubusercontent.com/mitre/cti/master/enterprise-attack/enterprise-attack.json';
const USER_AGENT =
  'Mozilla/5.0 (compatible; CocoaThreatDeck/1.0; +https://github.com/cocoa-labs/threat-deck)';

// ─── Inline type exports (not in src/lib/types.ts) ───

export interface MitreTactic {
  tacticId: string; // e.g. 'TA0001'
  stixId: string;
  name: string;
  shortName?: string;
  description?: string;
  url?: string;
}

export interface MitreTechnique {
  techniqueId: string; // e.g. 'T1059'
  stixId: string;
  name: string;
  description?: string;
  isSubtechnique: boolean;
  parentTechniqueId?: string;
  tactics?: string[]; // kill-chain phase shortnames
  platforms?: string[];
  url?: string;
  references?: string[];
}

// ─── STIX 2.1 minimal shapes ───

interface StixExternalReference {
  source_name?: string;
  external_id?: string;
  url?: string;
  description?: string;
}

interface StixKillChainPhase {
  kill_chain_name?: string;
  phase_name?: string;
}

interface StixObject {
  id?: string;
  type?: string;
  name?: string;
  description?: string;
  revoked?: boolean;
  x_mitre_deprecated?: boolean;
  x_mitre_is_subtechnique?: boolean;
  x_mitre_shortname?: string;
  x_mitre_platforms?: string[];
  aliases?: string[];
  external_references?: StixExternalReference[];
  kill_chain_phases?: StixKillChainPhase[];
  created?: string;
  modified?: string;
}

interface StixBundle {
  objects?: StixObject[];
}

// ─── Demo data ───

const DEMO_TACTICS: MitreTactic[] = [
  {
    tacticId: 'TA0001',
    stixId: 'x-mitre-tactic--ffd5bcee-6e16-4dd2-8eca-7b3beedf33ca',
    name: 'Initial Access',
    shortName: 'initial-access',
    description:
      'The adversary is trying to get into your network. Initial Access consists of techniques that use various entry vectors to gain their initial foothold within a network.',
    url: 'https://attack.mitre.org/tactics/TA0001/',
  },
  {
    tacticId: 'TA0002',
    stixId: 'x-mitre-tactic--4ca45d45-df4d-4613-8980-bac22d278fa5',
    name: 'Execution',
    shortName: 'execution',
    description:
      'The adversary is trying to run malicious code. Execution consists of techniques that result in adversary-controlled code running on a local or remote system.',
    url: 'https://attack.mitre.org/tactics/TA0002/',
  },
  {
    tacticId: 'TA0010',
    stixId: 'x-mitre-tactic--9a4e74ab-5008-408c-84bf-a10dfbc53462',
    name: 'Exfiltration',
    shortName: 'exfiltration',
    description:
      'The adversary is trying to steal data. Exfiltration consists of techniques that adversaries may use to steal data from your network.',
    url: 'https://attack.mitre.org/tactics/TA0010/',
  },
];

const DEMO_TECHNIQUES: MitreTechnique[] = [
  {
    techniqueId: 'T1566',
    stixId: 'attack-pattern--a62a8db3-f23a-4d8f-afd6-9dbc77e7813b',
    name: 'Phishing',
    description: 'Adversaries may send phishing messages to gain access to victim systems.',
    isSubtechnique: false,
    tactics: ['initial-access'],
    platforms: ['Linux', 'macOS', 'Windows', 'SaaS', 'Office 365', 'Google Workspace'],
    url: 'https://attack.mitre.org/techniques/T1566/',
  },
  {
    techniqueId: 'T1059',
    stixId: 'attack-pattern--7385dfaf-6886-4229-9ecd-6fd678040830',
    name: 'Command and Scripting Interpreter',
    description:
      'Adversaries may abuse command and script interpreters to execute commands, scripts, or binaries.',
    isSubtechnique: false,
    tactics: ['execution'],
    platforms: ['Linux', 'macOS', 'Windows', 'Network'],
    url: 'https://attack.mitre.org/techniques/T1059/',
  },
  {
    techniqueId: 'T1486',
    stixId: 'attack-pattern--b80d107d-fa0d-4b60-9684-b0433e8bdba0',
    name: 'Data Encrypted for Impact',
    description:
      'Adversaries may encrypt data on target systems or on large numbers of systems in a network to interrupt availability to system and network resources.',
    isSubtechnique: false,
    tactics: ['impact'],
    platforms: ['Linux', 'macOS', 'Windows'],
    url: 'https://attack.mitre.org/techniques/T1486/',
  },
  {
    techniqueId: 'T1078',
    stixId: 'attack-pattern--b17a1a56-e99c-403c-8948-561df0cffe81',
    name: 'Valid Accounts',
    description:
      'Adversaries may obtain and abuse credentials of existing accounts as a means of gaining Initial Access, Persistence, Privilege Escalation, or Defense Evasion.',
    isSubtechnique: false,
    tactics: ['defense-evasion', 'persistence', 'privilege-escalation', 'initial-access'],
    platforms: ['Windows', 'Linux', 'macOS', 'SaaS'],
    url: 'https://attack.mitre.org/techniques/T1078/',
  },
  {
    techniqueId: 'T1190',
    stixId: 'attack-pattern--3f886f2a-874f-4333-b794-aa6075009b1c',
    name: 'Exploit Public-Facing Application',
    description:
      'Adversaries may attempt to exploit a weakness in an Internet-facing host or system to initially access a network.',
    isSubtechnique: false,
    tactics: ['initial-access'],
    platforms: ['Linux', 'macOS', 'Windows', 'Network'],
    url: 'https://attack.mitre.org/techniques/T1190/',
  },
];

const DEMO_GROUPS: ThreatActor[] = [
  {
    actorId: 'G0032',
    displayName: 'LockBit',
    aliases: ['LockBit Gang', 'ITG23 (subset)'],
    actorType: 'ransomware',
    attributionCountry: 'RU',
    firstObservedAt: '2019-09-01',
    lastActiveAt: '2026-05-15',
    motivation: 'Financial',
    sophistication: 'high',
    summary:
      'LockBit is a prolific Ransomware-as-a-Service operator responsible for thousands of incidents worldwide. Affiliates leverage data exfiltration to compel ransom payment.',
    mitreGroupId: 'G0032',
    references: ['https://attack.mitre.org/groups/G0032/'],
  },
  {
    actorId: 'G0016',
    displayName: 'APT29',
    aliases: ['Cozy Bear', 'NOBELIUM', 'The Dukes'],
    actorType: 'apt',
    attributionCountry: 'RU',
    firstObservedAt: '2008-01-01',
    lastActiveAt: '2026-04-30',
    motivation: 'Espionage',
    sophistication: 'expert',
    summary:
      'APT29 is a Russian SVR-linked espionage group targeting government, diplomatic, think tank, and IT supply chain organizations.',
    mitreGroupId: 'G0016',
    references: ['https://attack.mitre.org/groups/G0016/'],
  },
  {
    actorId: 'G0046',
    displayName: 'FIN7',
    aliases: ['Carbon Spider', 'GOLD NIAGARA'],
    actorType: 'criminal',
    attributionCountry: 'unknown',
    firstObservedAt: '2013-01-01',
    lastActiveAt: '2026-04-12',
    motivation: 'Financial',
    sophistication: 'high',
    summary:
      'FIN7 is a financially motivated threat group active since at least 2013, primarily targeting the retail, hospitality, and financial sectors with point-of-sale malware and ransomware.',
    mitreGroupId: 'G0046',
    references: ['https://attack.mitre.org/groups/G0046/'],
  },
];

// ─── Internal: download + cache the raw STIX bundle ───

async function fetchBundle(): Promise<StixBundle | null> {
  const cacheKey = 'mitre:bundle:v1';
  const cached = await getCached<StixBundle>(cacheKey);
  if (cached) return cached;

  if (isBackedOff('mitre')) return null;
  if (!checkRateLimit('mitre')) return null;

  try {
    const res = await fetchWithTimeout(
      MITRE_BUNDLE_URL,
      { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, cache: 'no-store' },
      // ~10 MB STIX bundle — a generous but bounded cap (default 8s is too tight).
      30_000,
      64 * 1024 * 1024,
    );

    if (res.status === 429) {
      setBackoff('mitre', 15 * 60_000);
      return null;
    }
    if (!res.ok) {
      console.warn(`[MITRE] Bundle fetch returned ${res.status}`);
      return null;
    }

    const data = (await res.json()) as StixBundle;
    if (!data.objects?.length) {
      console.warn('[MITRE] Bundle returned no objects');
      return null;
    }

    await setCache(cacheKey, data, 86400);
    return data;
  } catch (err) {
    console.warn('[MITRE] Bundle fetch failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

function isActive(obj: StixObject): boolean {
  return !obj.revoked && !obj.x_mitre_deprecated;
}

function findMitreExternalRef(
  refs: StixExternalReference[] | undefined,
): StixExternalReference | undefined {
  return refs?.find((r) => r.source_name === 'mitre-attack');
}

// ─── Public API ───

/**
 * Fetch ATT&CK tactics (TA0001 etc.). Returns DEMO on failure.
 */
export async function fetchMitreAttackTactics(): Promise<MitreTactic[]> {
  const bundle = await fetchBundle();
  if (!bundle?.objects) return DEMO_TACTICS;

  const tactics: MitreTactic[] = [];
  for (const obj of bundle.objects) {
    if (obj.type !== 'x-mitre-tactic' || !isActive(obj)) continue;
    const ref = findMitreExternalRef(obj.external_references);
    if (!ref?.external_id) continue;
    tactics.push({
      tacticId: ref.external_id,
      stixId: obj.id ?? '',
      name: obj.name ?? '',
      shortName: obj.x_mitre_shortname,
      description: obj.description,
      url: ref.url,
    });
  }

  if (tactics.length === 0) return DEMO_TACTICS;

  tactics.sort((a, b) => a.tacticId.localeCompare(b.tacticId));
  return tactics;
}

/**
 * Fetch ATT&CK techniques (T1059 etc.). Returns DEMO on failure.
 * Includes sub-techniques; consumers can filter by `isSubtechnique`.
 */
export async function fetchMitreAttackTechniques(): Promise<MitreTechnique[]> {
  const bundle = await fetchBundle();
  if (!bundle?.objects) return DEMO_TECHNIQUES;

  const techniques: MitreTechnique[] = [];
  for (const obj of bundle.objects) {
    if (obj.type !== 'attack-pattern' || !isActive(obj)) continue;
    const ref = findMitreExternalRef(obj.external_references);
    if (!ref?.external_id) continue;

    const techniqueId = ref.external_id;
    const isSubtechnique = obj.x_mitre_is_subtechnique === true || techniqueId.includes('.');
    const parentTechniqueId = isSubtechnique ? techniqueId.split('.')[0] : undefined;

    const tactics = (obj.kill_chain_phases ?? [])
      .filter((p) => p.kill_chain_name === 'mitre-attack')
      .map((p) => p.phase_name)
      .filter((p): p is string => Boolean(p));

    const references = (obj.external_references ?? [])
      .map((r) => r.url)
      .filter((u): u is string => Boolean(u));

    techniques.push({
      techniqueId,
      stixId: obj.id ?? '',
      name: obj.name ?? '',
      description: obj.description,
      isSubtechnique,
      parentTechniqueId,
      tactics,
      platforms: obj.x_mitre_platforms,
      url: ref.url,
      references,
    });
  }

  if (techniques.length === 0) return DEMO_TECHNIQUES;

  techniques.sort((a, b) => a.techniqueId.localeCompare(b.techniqueId));
  return techniques;
}

/**
 * Fetch ATT&CK intrusion sets and map them to ThreatActor.
 * Returns DEMO on failure.
 */
export async function fetchMitreAttackGroups(): Promise<ThreatActor[]> {
  const bundle = await fetchBundle();
  if (!bundle?.objects) return DEMO_GROUPS;

  const groups: ThreatActor[] = [];
  for (const obj of bundle.objects) {
    if (obj.type !== 'intrusion-set' || !isActive(obj)) continue;
    const ref = findMitreExternalRef(obj.external_references);
    if (!ref?.external_id) continue;

    const externalUrls = (obj.external_references ?? [])
      .map((r) => r.url)
      .filter((u): u is string => Boolean(u));

    groups.push({
      actorId: ref.external_id,
      displayName: obj.name ?? ref.external_id,
      aliases: obj.aliases?.filter((a) => a !== obj.name),
      // Default to 'apt' for ATT&CK groups; callers can re-classify.
      actorType: 'apt',
      attributionCountry: undefined,
      firstObservedAt: obj.created,
      lastActiveAt: obj.modified,
      summary: obj.description?.slice(0, 1000),
      mitreGroupId: ref.external_id,
      references: externalUrls,
    });
  }

  if (groups.length === 0) return DEMO_GROUPS;

  groups.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return groups;
}
