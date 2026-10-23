import { query, queryOne } from '../client';

export interface AgentEventRow {
  id: string;
  trigger_type: string;
  trigger_source: string | null;
  trigger_data: unknown;
  task: string;
  tool_calls: unknown[];
  response_text: string | null;
  model: string;
  tokens_input: number | null;
  tokens_output: number | null;
  duration_ms: number | null;
  user_id: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface AgentBriefRow {
  id: string;
  agent_event_id: string | null;
  topic: string;
  format: string;
  headline: string;
  confidence: string | null;
  content: unknown;
  published: boolean;
  user_id: string | null;
  created_at: string;
}

export interface ApprovalRow {
  id: string;
  agent_event_id: string | null;
  action_type: string;
  action_input: unknown;
  agent_reasoning: string | null;
  urgency: string;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  feedback: string | null;
  created_at: string;
  expires_at: string;
}

export interface AgentMemoryRow {
  id: string;
  user_id: string | null;
  topic: string;
  content: string;
  importance: string;
  access_count: number;
  created_at: string;
  last_accessed_at: string;
}

export async function insertAgentEvent(params: {
  triggerType: string;
  triggerSource?: string;
  triggerData?: unknown;
  task: string;
  model: string;
  userId?: string;
}): Promise<string> {
  const result = await queryOne<{ id: string }>(
    `INSERT INTO agent_events (trigger_type, trigger_source, trigger_data, task, model, user_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      params.triggerType,
      params.triggerSource,
      params.triggerData,
      params.task,
      params.model,
      params.userId,
    ],
  );
  return result!.id;
}

export async function completeAgentEvent(params: {
  id: string;
  toolCalls: unknown[];
  responseText: string;
  tokensInput: number;
  tokensOutput: number;
  durationMs: number;
}): Promise<void> {
  await query(
    `UPDATE agent_events SET
       tool_calls = $2, response_text = $3, tokens_input = $4,
       tokens_output = $5, duration_ms = $6, completed_at = NOW()
     WHERE id = $1`,
    [
      params.id,
      JSON.stringify(params.toolCalls),
      params.responseText,
      params.tokensInput,
      params.tokensOutput,
      params.durationMs,
    ],
  );
}

export async function getRecentBriefs(params: {
  userId?: string;
  limit?: number;
}): Promise<AgentBriefRow[]> {
  const limit = params.limit ?? 10;
  if (params.userId) {
    const result = await query<AgentBriefRow>(
      'SELECT * FROM agent_briefs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [params.userId, limit],
    );
    return result.rows;
  }
  const result = await query<AgentBriefRow>(
    'SELECT * FROM agent_briefs ORDER BY created_at DESC LIMIT $1',
    [limit],
  );
  return result.rows;
}

export async function insertBrief(params: {
  agentEventId?: string;
  topic: string;
  format: string;
  headline: string;
  confidence?: string;
  content: unknown;
  userId?: string;
}): Promise<string> {
  const result = await queryOne<{ id: string }>(
    `INSERT INTO agent_briefs (agent_event_id, topic, format, headline, confidence, content, user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      params.agentEventId,
      params.topic,
      params.format,
      params.headline,
      params.confidence,
      params.content,
      params.userId,
    ],
  );
  return result!.id;
}

export async function getPendingApprovals(_userId?: string): Promise<ApprovalRow[]> {
  const result = await query<ApprovalRow>(
    `SELECT * FROM approval_queue WHERE status = 'pending' AND expires_at > NOW()
     ORDER BY CASE urgency WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
     created_at ASC`,
    [],
  );
  return result.rows;
}

export async function insertApproval(params: {
  agentEventId: string;
  actionType: string;
  actionInput: unknown;
  agentReasoning?: string;
  urgency: string;
}): Promise<string> {
  const result = await queryOne<{ id: string }>(
    `INSERT INTO approval_queue (agent_event_id, action_type, action_input, agent_reasoning, urgency)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      params.agentEventId,
      params.actionType,
      params.actionInput,
      params.agentReasoning,
      params.urgency,
    ],
  );
  return result!.id;
}

export async function resolveApproval(params: {
  id: string;
  status: 'approved' | 'rejected';
  decidedBy: string;
  feedback?: string;
}): Promise<ApprovalRow | null> {
  return queryOne<ApprovalRow>(
    `UPDATE approval_queue SET status = $2, decided_by = $3, decided_at = NOW(), feedback = $4
     WHERE id = $1 RETURNING *`,
    [params.id, params.status, params.decidedBy, params.feedback],
  );
}

export async function getAgentMemory(params: {
  userId?: string;
  topic?: string;
  limit?: number;
}): Promise<AgentMemoryRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (params.userId) {
    conditions.push(`(user_id = $${idx++} OR user_id IS NULL)`);
    values.push(params.userId);
  }
  if (params.topic) {
    conditions.push(`topic ILIKE $${idx++}`);
    values.push(`%${params.topic}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = params.limit ?? 20;

  const result = await query<AgentMemoryRow>(
    `SELECT * FROM agent_memory ${where} ORDER BY importance DESC, last_accessed_at DESC LIMIT $${idx}`,
    [...values, limit],
  );

  // Increment access count
  if (result.rows.length > 0) {
    const ids = result.rows.map((r) => r.id);
    await query(
      `UPDATE agent_memory SET access_count = access_count + 1, last_accessed_at = NOW()
       WHERE id = ANY($1)`,
      [ids],
    );
  }

  return result.rows;
}

export async function writeAgentMemory(params: {
  userId?: string;
  topic: string;
  content: string;
  importance?: string;
}): Promise<string> {
  const result = await queryOne<{ id: string }>(
    `INSERT INTO agent_memory (user_id, topic, content, importance)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [params.userId, params.topic, params.content, params.importance ?? 'medium'],
  );
  return result!.id;
}

// ─── Conversation Exchanges ───

export interface ConversationExchangeRow {
  id: string;
  user_id: string;
  user_message: string;
  assistant_response: string;
  tool_calls: unknown[];
  tool_count: number;
  origin: string;
  created_at: string;
}

export async function getRecentExchanges(params: {
  userId: string;
  limit?: number;
}): Promise<ConversationExchangeRow[]> {
  const limit = params.limit ?? 10;
  const result = await query<ConversationExchangeRow>(
    'SELECT * FROM conversation_exchanges WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [params.userId, limit],
  );
  return result.rows;
}

export async function insertConversationExchange(params: {
  userId: string;
  userMessage: string;
  assistantResponse: string;
  toolCalls: unknown[];
  origin: string;
}): Promise<string> {
  const result = await queryOne<{ id: string }>(
    `INSERT INTO conversation_exchanges (user_id, user_message, assistant_response, tool_calls, tool_count, origin)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      params.userId,
      params.userMessage,
      params.assistantResponse,
      JSON.stringify(params.toolCalls),
      Array.isArray(params.toolCalls) ? params.toolCalls.length : 0,
      params.origin,
    ],
  );
  return result!.id;
}

export async function clearConversationExchanges(params: { userId: string }): Promise<void> {
  await query('DELETE FROM conversation_exchanges WHERE user_id = $1', [params.userId]);
}
