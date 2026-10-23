/** Shared by agent requests and the provider admission guard. */
export const AI_MAX_OUTPUT_TOKENS = 32_768;

const POLICY_MESSAGES: Record<string, string> = {
  budget_exceeded:
    'Your configured AI spending cap cannot cover this request. Adjust ANTHROPIC_DAILY_CAP_USD, or set it to 0 for no cap.',
  budget_not_configured:
    'The configured spending cap must be a non-negative number. Use 0 or leave it unset for no cap.',
  budget_unavailable: 'AI budget checks are unavailable. Check the local database before retrying.',
  provider_concurrency_exceeded:
    'Four AI requests are already running. Wait for one to finish, then retry.',
  invalid_output_budget: 'The requested AI output exceeds the application limit.',
  provider_request_too_large:
    'This request is too large. Start a new conversation or remove attachments.',
  unsupported_provider_body: 'The AI request format is unsupported.',
  'capability_disabled:ai': 'AI is disabled in this installation.',
};

/** SDK connection errors may wrap a local guard rejection in `cause`. */
export function aiPolicyMessage(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    for (const [code, message] of Object.entries(POLICY_MESSAGES)) {
      if (current.message.includes(code)) return message;
    }
    current = current.cause;
  }
  return undefined;
}

/** Tell the SDK not to retry a local admission failure as a network outage. */
export function aiPolicyResponse(code: string): Response {
  return Response.json(
    { type: 'error', error: { type: 'threat_deck_policy_error', message: code } },
    {
      status: code === 'budget_unavailable' ? 503 : 400,
      headers: { 'x-should-retry': 'false' },
    },
  );
}
