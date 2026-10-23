import { useAgentStore } from '@/lib/store/agent-store';

export interface PanelContext {
  sourcePanel: string;
  dataType: string;
  relatedItems?: Record<string, unknown>[];
  trendData?: Record<string, unknown>;
  timestamp?: string;
}

/**
 * Prefill the agent command bar with a contextual prompt.
 * Opens the agent drawer and populates the input — user hits Enter to send.
 *
 * Optionally accepts structured context that gets appended to the prompt
 * as a JSON block for the agent to consume alongside the natural language prompt.
 *
 * All panel clicks use concise mode — short, sourced insight with option to expand.
 */
export function prefillAgent(prompt: string, context?: PanelContext) {
  if (context?.trendData) {
    const td = context.trendData;
    // Normalize URL keys so both url and sourceUrl are available for correlation
    if (td.url && !td.sourceUrl) td.sourceUrl = td.url;
    else if (td.sourceUrl && !td.url) td.url = td.sourceUrl;
  }
  if (context && !context.timestamp) {
    context.timestamp = new Date().toISOString();
  }
  const enrichedPrompt = context
    ? `${prompt}\n\n<context>${JSON.stringify(context)}</context>`
    : prompt;
  useAgentStore.getState().setPrefill(enrichedPrompt);
}
