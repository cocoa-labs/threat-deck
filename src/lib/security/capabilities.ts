/** Server-owned opt-ins. Supplying a credential never enables a capability. */
export const CAPABILITY_FLAGS = {
  ai: 'ENABLE_AI',
  email: 'ENABLE_OUTBOUND_EMAIL',
  x: 'ENABLE_X_PUBLISHING',
  gmail: 'ENABLE_GMAIL_ACCESS',
  media: 'ENABLE_MEDIA_GENERATION',
  automation: 'ENABLE_AUTOMATION',
  publicFeed: 'ENABLE_PUBLIC_FEED',
  officeIngestion: 'ENABLE_OFFICE_INGESTION',
  demoData: 'ENABLE_DEMO_DATA',
} as const;

export type Capability = keyof typeof CAPABILITY_FLAGS;

export function isCapabilityEnabled(capability: Capability): boolean {
  // Demonstration installations cannot publish synthetic evidence or trigger jobs.
  if (
    process.env.ENABLE_DEMO_DATA === 'true' &&
    ['email', 'x', 'automation', 'publicFeed'].includes(capability)
  )
    return false;
  return process.env[CAPABILITY_FLAGS[capability]] === 'true';
}

export function requireCapability(capability: Capability): void {
  if (!isCapabilityEnabled(capability)) throw new Error(`capability_disabled:${capability}`);
}

export function capabilityStatus(): Record<Capability, boolean> {
  return Object.fromEntries(
    (Object.keys(CAPABILITY_FLAGS) as Capability[]).map((key) => [key, isCapabilityEnabled(key)]),
  ) as Record<Capability, boolean>;
}
