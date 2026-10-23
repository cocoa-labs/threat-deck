/** Shared agent suggestion chips — single source of truth for all surfaces. */
export const AGENT_SUGGESTIONS = [
  { label: 'SITREP', query: 'SITREP' },
  {
    label: 'KEV',
    query: 'What new CISA KEV entries were added and which are most urgent to patch?',
  },
  { label: 'CVEs', query: 'What are the most critical CVEs published recently?' },
  { label: 'Breaches', query: 'Summarize the latest breach disclosures and who is affected.' },
  {
    label: 'Actors',
    query: 'Which threat actors are most active right now, and who are they targeting?',
  },
  {
    label: 'Patches',
    query: 'What critical vendor patches and security advisories were released recently?',
  },
  { label: 'IOCs', query: 'Summarize the latest indicators of compromise from the threat feeds.' },
  {
    label: "What's On?",
    query:
      "What's on the live channels right now? Summarize what's playing and connect it to current cyber and threat developments.",
  },
] as const;
