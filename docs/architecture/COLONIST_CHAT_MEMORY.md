# Colonist Chat Memory Architecture

Post-simulation chat with colonist agents. Each colonist is a full AgentOS agent with HEXACO personality, episodic memory, and RAG retrieval over their simulation experiences.

## How It Works

### 1. Agent Creation (Lazy)

When a user sends the first chat message to a colonist, the server creates an `agent()` instance. This takes 2-3 seconds because it initializes an in-memory SQLite database and seeds it with the colonist's simulation data.

The agent is configured with:
- The colonist's HEXACO personality profile (6 traits, 0-1 scale)
- A system prompt grounding them to their identity and role
- An `AgentMemory.sqlite({ path: ':memory:' })` memory provider

Subsequent messages reuse the same agent and session. No re-initialization.

### 2. Memory Seeding

Before the first user message is processed, the colonist's simulation experiences are ingested into episodic memory via `memory.remember()`:

**Personal reactions** (per turn):
```
Turn 1 (2035): "Another day, another crisis." (mood: anxious)
Context: Perchlorate Dust in the Intake Filters
```

**Crises witnessed** (per turn):
```
Turn 2 (2043): Deferred Maintenance Oxygen Bottleneck
Category: infrastructure. Commander throttled habitat activity and prepared standard repair window.
Outcome: SAFE WIN
```

**Department reports** (for their department):
```
Turn 3 Medical Analysis: Low-gravity stress fractures detected in 7 adults and 3 children.
Recommended colony-wide countermeasure regimen. 0 tools forged, 0 citations.
```

These entries become vectors in the in-memory SQLite store. When the user asks a question, AgentOS retrieves the most semantically relevant entries and prepends them to the system prompt.

### 3. Conversation Flow

```
User message
  → agent.session.send(message)
    → memory.getContext(message)         // RAG: retrieve relevant sim memories
    → prepend context to system prompt   // "You remember: [retrieved memories]"
    → send full history + system prompt  // all prior messages included
    → LLM generates response
    → memory.observe('user', message)    // store user message in memory
    → memory.observe('assistant', reply) // store agent reply in memory
  → return reply
```

Every statement the colonist makes is stored in memory. On the next turn, if the user references something the colonist said, RAG retrieves that exact statement. The LLM sees its own prior words in the context and cannot contradict them without the context making the contradiction visible.

### 4. HEXACO Personality

The colonist's HEXACO profile is passed to `agent({ personality: { ... } })`. AgentOS uses these traits to:

- **Modulate retrieval**: High emotionality amplifies emotional memories. High openness broadens retrieval scope.
- **Shape response style**: High conscientiousness produces structured, careful responses. High extraversion produces longer, more conversational replies.
- **Influence mood adaptation**: The agent's mood shifts based on conversation context, gated by personality traits.

This means two colonists with different HEXACO profiles will remember and discuss the same events differently, consistent with their personality.

### 5. Agent Pool Management

Agents are stored in a `Map<string, { agent, session, lastUsed }>`. Pool limit is 10 concurrent agents. When the pool is full and a new colonist is requested, the least-recently-used agent is evicted (its in-memory SQLite is garbage collected).

Pool stats are returned in the `/results` API:
```json
{
  "chatAgentPool": {
    "active": 3,
    "maxSize": 10,
    "agents": ["Tariq Okafor", "Dr. Yuki Tanaka", "Erik Lindqvist"]
  }
}
```

### 6. Threads in the Dashboard

The Chat tab keeps one thread per person under their leader, and sends that thread's turns as `history` with each message. The threads belong to one run: the panel is keyed on the run's key (the `runKey` of the `active_scenario` event that opens the run), so a new run, the same scenario with the same leaders and people included, opens every thread empty with its greeting and sends no turn of the last run. A run loaded from a file or from the page's history has no key and is a run of its own too: each load opens the threads empty. A dropped connection replays the same key and keeps the threads. A run the visitor starts in another scenario, from another tab, leaves the page on the run it shows (one still running ends as interrupted), and the threads with that run's people stay. They live in the page's memory only, so a reload of the page starts them empty.

## Why This Prevents Contradictions

The previous system had three failure modes:

1. **No history**: Only 6 messages were included. The LLM forgot what it said in message 7+.
2. **No memory**: Statements weren't stored anywhere. The LLM had no way to recall prior claims.
3. **No personality grounding**: The HEXACO profile was shown as numbers but didn't influence behavior.

The new system eliminates all three:

1. **Full history**: AgentOS `session.send()` sends the complete message array every call.
2. **Episodic memory**: Every statement is stored via `memory.observe()` and retrieved via `memory.getContext()` when relevant.
3. **Personality**: HEXACO traits are passed to `agent({ personality })` and modulate retrieval bias and response generation.

## Source Files

| File | Purpose |
|------|---------|
| `src/server/server-app.ts` | `/chat` endpoint, agent pool management |
| `src/runtime/agents/chat-agents.ts` | Agent creation, memory seeding, pool |
| `src/dashboard/src/components/chat/ChatPanel.tsx` | Chat UI, one thread per person under their leader, per run |

## Dependencies

- `@framers/agentos` — `agent()`, `AgentMemory.sqlite()`, `generateText()`
- In-memory SQLite via `better-sqlite3` (already a dependency)

## References

- AgentOS `agent()` API: [docs.agentos.sh/getting-started/high-level-api](https://docs.agentos.sh/docs/getting-started/high-level-api)
- AgentOS Cognitive Memory: [docs.agentos.sh/features/cognitive-memory](https://docs.agentos.sh/docs/features/cognitive-memory)
- HEXACO Personality Model: Ashton, M. C., & Lee, K. (2007). Empirical, theoretical, and practical advantages of the HEXACO model. [hexaco.org](https://hexaco.org/)
- AgentOS HEXACO Guide: [docs.agentos.sh/features/hexaco-personality](https://docs.agentos.sh/docs/features/hexaco-personality)
