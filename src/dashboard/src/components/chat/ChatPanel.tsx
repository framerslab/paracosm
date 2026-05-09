import { useState, useRef, useEffect, useMemo, type CSSProperties } from 'react';
import { useScenarioContext } from '../../App';
import type { GameState } from '../../hooks/useGameState';
import styles from './ChatPanel.module.scss';

interface ChatMessage {
  role: 'user' | 'agent';
  name?: string;
  text: string;
}

interface AgentMemoryInfo {
  beliefs: string[];
  stances: Array<{ topic: string; value: number }>;
  relationships: Array<{ name: string; sentiment: number }>;
  recentMemories: Array<{ time: number; content: string; valence: string }>;
}

interface AgentInfo {
  name: string;
  role: string;
  department: string;
  mood: string;
  age?: number;
  marsborn?: boolean;
  agentId?: string;
  memory?: AgentMemoryInfo | null;
  /** HEXACO profile captured from the colonist's latest agent_reaction
   *  payload. Lets the chat panel render the personality the agent is
   *  actually replying with, not a fabricated neutral one. */
  hexaco?: { O: number; C: number; E: number; A: number; Em: number; HH: number };
  psychScore?: number;
  boneDensity?: number;
  radiation?: number;
}

interface ChatPanelProps {
  state: GameState;
  /**
   * Fires after every /chat response with the per-turn usage payload
   * the server surfaced. Lifted so App can accumulate chat spend into
   * the global footer readout — previously chat calls billed silently
   * while the footer only counted simulation cost.
   */
  onChatUsage?: (usage: { totalTokens: number; costUSD: number }) => void;
}

const moodColors: Record<string, string> = {
  positive: 'var(--green)', negative: 'var(--rust)', anxious: 'var(--amber)',
  defiant: 'var(--rust)', hopeful: 'var(--green)', resigned: 'var(--text-3)', neutral: 'var(--text-2)',
};

function valenceBorderColor(valence: string): string {
  if (valence === 'positive') return 'var(--green)';
  if (valence === 'negative') return 'var(--rust)';
  return 'var(--border)';
}

function EventContext({ memory, events, scenario }: { memory: AgentMemoryInfo; events: GameState; scenario: { labels: { eventNoun?: string; eventNounSingular?: string } } }) {
  // Collect event titles from every leader's timeline, deduped by turn.
  const eventTimeline: Array<{ turn: number; time: number; title: string; category: string }> = [];
  for (const actorName of events.actorIds) {
    const sideState = events.actors[actorName];
    if (!sideState) continue;
    for (const evt of sideState.events) {
      if (evt.type === 'turn_start' && evt.data.title && evt.data.title !== 'Director generating...') {
        const turn = evt.data.turn as number;
        if (!eventTimeline.some(e => e.turn === turn)) {
          eventTimeline.push({
            turn,
            time: evt.data.time as number || 0,
            title: String(evt.data.title),
            category: String(evt.data.category || ''),
          });
        }
      }
    }
  }
  eventTimeline.sort((a, b) => a.turn - b.turn);

  const eventNoun = scenario.labels.eventNoun || 'events';
  const hasMemories = memory.recentMemories?.length > 0;
  const hasRelationships = memory.relationships?.length > 0;

  if (!eventTimeline.length && !hasMemories) return null;

  return (
    <div className={styles.eventCtx}>
      {eventTimeline.length > 0 && (
        <div className={hasMemories ? styles.eventGroup : styles.eventGroupLast}>
          <div
            className={styles.eventGroupLabel}
            style={{ '--group-color': 'var(--rust)' } as CSSProperties}
          >
            {eventNoun.toUpperCase()} EXPERIENCED
          </div>
          {eventTimeline.map(e => (
            <div key={e.turn} className={styles.eventRow}>
              <span className={styles.eventTurn}>T{e.turn} {e.time}</span>
              <span className={styles.eventTitle}>{e.title}</span>
              {e.category && <span className={styles.eventCategory}>{e.category}</span>}
            </div>
          ))}
        </div>
      )}
      {hasMemories && (
        <div className={hasRelationships ? styles.eventGroup : styles.eventGroupLast}>
          <div
            className={styles.eventGroupLabel}
            style={{ '--group-color': 'var(--amber)' } as CSSProperties}
          >
            RECENT MEMORIES
          </div>
          {memory.recentMemories.slice(0, 3).map((m, i) => (
            <div
              key={i}
              className={styles.memoryItem}
              style={{ '--valence-border': valenceBorderColor(m.valence) } as CSSProperties}
            >
              <span className={styles.memoryTime}>Y{m.time}</span> {m.content}
            </div>
          ))}
        </div>
      )}
      {hasRelationships && (
        <div>
          <div
            className={styles.eventGroupLabel}
            style={{ '--group-color': 'var(--teal)' } as CSSProperties}
          >
            RELATIONSHIPS
          </div>
          <div className={styles.relationshipsRow}>
            {memory.relationships.map((r, i) => (
              <span
                key={i}
                className={styles.relationshipChip}
                style={{ '--rel-color': r.sentiment > 0 ? 'var(--green)' : 'var(--rust)' } as CSSProperties}
              >
                {r.name} {r.sentiment > 0 ? '+' : ''}{r.sentiment.toFixed(1)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function ChatPanel({ state, onChatUsage }: ChatPanelProps) {
  const scenario = useScenarioContext();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Per-agent message threads — switching agents no longer wipes history.
  // The server-side AgentOS session also keeps its own history, so messages
  // here are kept in sync on the client for visual continuity.
  const [threads, setThreads] = useState<Map<string, ChatMessage[]>>(() => new Map());
  const [historyByAgent, setHistoryByAgent] = useState<Map<string, Array<{ role: string; content: string }>>>(() => new Map());
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  // Pin-to-bottom for the chat message stream. Release the pin if
  // the user scrolls up to re-read an earlier message so the next
  // reply does not yank them back down.
  const chatPinnedRef = useRef(true);
  const onMessagesScroll = () => {
    const el = messagesRef.current;
    if (!el) return;
    chatPinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  // Consume a preselected colonist from the URL hash. The VIZ tab
  // drilldown writes `#chat=<Name>` before switching to this tab, so
  // opening chat from there lands directly on the right agent.
  // Listens to hashchange so repeated handoffs (user goes back and
  // picks a different colonist) re-select without a hard reload.

  const messages = selectedId ? (threads.get(selectedId) ?? []) : [];
  const history = selectedId ? (historyByAgent.get(selectedId) ?? []) : [];

  const agents = useMemo(() => {
    const map = new Map<string, AgentInfo>();
    for (const actorName of state.actorIds) {
      const sideState = state.actors[actorName];
      if (!sideState) continue;
      for (const evt of sideState.events) {
        if (evt.type === 'agent_reactions') {
          const reactions = evt.data.reactions as Array<Record<string, unknown>> || [];
          for (const r of reactions) {
            if (r.name) {
              map.set(r.name as string, {
                name: r.name as string, role: r.role as string || '',
                department: r.department as string || '', mood: r.mood as string || 'neutral',
                age: r.age as number, marsborn: r.marsborn as boolean,
                agentId: r.agentId as string, memory: r.memory as AgentMemoryInfo | null,
                hexaco: r.hexaco as AgentInfo['hexaco'],
                psychScore: r.psychScore as number,
                boneDensity: r.boneDensity as number,
                radiation: r.radiation as number,
              });
            }
          }
        }
      }
    }
    return Array.from(map.values());
  }, [state]);

  const selected = agents.find(c => c.name === selectedId);

  useEffect(() => {
    if (!chatPinnedRef.current) return;
    if (messagesRef.current) messagesRef.current.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  useEffect(() => {
    const readHash = () => {
      const match = window.location.hash.match(/^#chat=([^&]+)/);
      if (!match) return;
      const name = decodeURIComponent(match[1]);
      if (name && agents.some(a => a.name === name)) {
        setSelectedId(name);
      }
    };
    readHash();
    window.addEventListener('hashchange', readHash);
    return () => window.removeEventListener('hashchange', readHash);
  }, [agents]);

  const selectAgent = (name: string) => {
    setSelectedId(name);
    // Initialize a thread the first time we open this agent. Re-selects keep
    // the existing thread intact so the user can switch agents and back
    // without losing the conversation.
    setThreads(prev => {
      if (prev.has(name)) return prev;
      const c = agents.find(a => a.name === name);
      const greeting: ChatMessage = c ? {
        role: 'agent', name: c.name,
        // Steer the user toward simulation-grounded questions instead of
        // generic chit-chat — the agent is a simulated character with a
        // specific event history, not a virtual assistant.
        text:
          `${c.role} in ${c.department}, age ${c.age || '?'}. ` +
          `I lived through this simulation — ask me about specific turns, the commander's decisions, ` +
          `crises I witnessed, people I worked with, or how my department handled what came up. ` +
          `Try: "what did you think of the commander's choice in turn 1?", ` +
          `"who do you trust on the team?", or "what was the worst moment for you?"`,
      } : { role: 'agent', text: 'Connected.' };
      const next = new Map(prev);
      next.set(name, [greeting]);
      return next;
    });
  };

  const setMessagesFor = (agentId: string, updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    setThreads(prev => {
      const next = new Map(prev);
      next.set(agentId, updater(prev.get(agentId) ?? []));
      return next;
    });
  };

  const setHistoryFor = (agentId: string, updater: (prev: Array<{ role: string; content: string }>) => Array<{ role: string; content: string }>) => {
    setHistoryByAgent(prev => {
      const next = new Map(prev);
      next.set(agentId, updater(prev.get(agentId) ?? []));
      return next;
    });
  };

  const send = async () => {
    if (!input.trim() || !selectedId || sending) return;
    const targetId = selectedId;
    const msg = input.trim();
    setInput('');
    setSending(true);
    setMessagesFor(targetId, prev => [...prev, { role: 'user', text: msg }]);
    const currentHistory = historyByAgent.get(targetId) ?? [];
    const newHistory = [...currentHistory, { role: 'user', content: msg }];
    setHistoryFor(targetId, () => newHistory);
    try {
      // Forward any locally-saved BYO API keys so chat routes to the
      // user's own provider account instead of the host's. Matches the
      // contract on /setup and /compile. localStorage is written by
      // the Settings panel on every key edit.
      const storedKeys = (() => {
        try { return JSON.parse(localStorage.getItem('paracosm:keyOverrides') || '{}') as Record<string, string>; }
        catch { return {} as Record<string, string>; }
      })();
      const res = await fetch('/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: targetId,
          message: msg,
          history: newHistory,
          ...(storedKeys.openai ? { apiKey: storedKeys.openai } : {}),
          ...(storedKeys.anthropic ? { anthropicKey: storedKeys.anthropic } : {}),
        }),
      });
      const data = await res.json();
      if (data.reply) {
        setMessagesFor(targetId, prev => [...prev, { role: 'agent', name: data.colonist || targetId, text: data.reply }]);
        setHistoryFor(targetId, prev => [...prev, { role: 'assistant', content: data.reply }]);
        // Bubble the chat turn's token/cost usage up so the footer can
        // add it to the simulation-cost total. Failure-path responses
        // (no reply, error text) don't incur server-side LLM cost so
        // they skip the callback.
        const usage = data.usage as { totalTokens?: number; costUSD?: number } | undefined;
        if (usage && onChatUsage) {
          onChatUsage({
            totalTokens: usage.totalTokens ?? 0,
            costUSD: usage.costUSD ?? 0,
          });
        }
      } else {
        setMessagesFor(targetId, prev => [...prev, { role: 'agent', text: data.error || 'No response' }]);
      }
    } catch (err) {
      setMessagesFor(targetId, prev => [...prev, { role: 'agent', text: `Chat failed: ${err}` }]);
    }
    setSending(false);
  };

  return (
    <div className={`chat-layout ${styles.layout}`} role="region" aria-label="Agent chat">
      {/* Sidebar */}
      <div className={`chat-sidebar ${styles.sidebar}`}>
        <h3 className={styles.sidebarHeading}>
          {agents.length ? `${agents.length} Agents` : 'Agent Chat'}
        </h3>
        <p className={styles.sidebarLead}>
          {agents.length
            ? `Talk to any ${scenario.labels.populationNoun.replace(/s$/, '')} from the simulation. Each agent has persistent memory, personality, and relationships shaped by the crises they experienced.`
            : `Chat becomes available after the first turn completes. Start a simulation and come back once agents have reacted to the first crisis. Each agent has persistent memory, personality, and relationships shaped by the crises they experience.`
          }
        </p>
        {agents.map(c => (
          <button
            key={c.name}
            onClick={() => selectAgent(c.name)}
            className={[styles.agentBtn, selectedId === c.name ? styles.selected : ''].filter(Boolean).join(' ')}
          >
            <span className={styles.agentName}>{c.name}</span>
            <div className={styles.agentMeta}>{c.role} {c.department}</div>
            <div
              className={styles.agentMood}
              style={{ '--mood-color': moodColors[c.mood] || 'var(--text-3)' } as CSSProperties}
            >
              {c.mood.toUpperCase()}
            </div>
          </button>
        ))}
      </div>

      {/* Chat area */}
      <div className={styles.chatArea}>
        {/* Memory bar */}
        {selected?.memory && (selected.memory.beliefs?.length > 0 || selected.memory.stances?.length > 0) && (
          <div className={styles.memoryBar}>
            <span className={styles.memoryLabel}>MEMORY </span>
            {selected.memory.beliefs?.slice(0, 2).map((b, i) => <span key={i} className={styles.memoryBelief}>{b}</span>)}
            {selected.memory.stances?.map((s, i) => (
              <span
                key={i}
                className={styles.memoryStance}
                style={{ '--stance-color': s.value > 0 ? 'var(--green)' : 'var(--rust)' } as CSSProperties}
              >
                {s.topic}: {s.value > 0.5 ? 'confident' : s.value > 0 ? 'cautious' : 'wary'}
              </span>
            ))}
          </div>
        )}

        {/* HEXACO + health strip: the personality the agent is actually
            replying with, plus the health signals that shape their tone.
            Hidden when the colonist's reactions haven't carried a full
            trait vector (older cached runs). */}
        {selectedId && selected?.hexaco && (
          <div className={styles.hexacoStrip}>
            <span className={styles.hexacoLabel}>HEXACO</span>
            {(['O', 'C', 'E', 'A', 'Em', 'HH'] as const).map(k => {
              const v = selected.hexaco![k];
              const filled = Math.round(v * 4);
              const bar = '█'.repeat(filled) + '░'.repeat(4 - filled);
              return (
                <span key={k} title={`${k}: ${v.toFixed(2)}`} className={styles.hexacoTrait}>
                  {k} <span className={styles.hexacoBar}>{bar}</span> {v.toFixed(2)}
                </span>
              );
            })}
            {typeof selected.psychScore === 'number' && (
              <span
                className={styles.healthSignal}
                style={{ '--signal-color': selected.psychScore < 0.4 ? 'var(--rust)' : 'var(--text-2)' } as CSSProperties}
              >
                psych {(selected.psychScore * 100).toFixed(0)}%
              </span>
            )}
            {typeof selected.boneDensity === 'number' && selected.boneDensity > 0 && (
              <span
                className={styles.healthSignal}
                style={{ '--signal-color': selected.boneDensity < 70 ? 'var(--rust)' : 'var(--text-3)' } as CSSProperties}
              >
                bone {selected.boneDensity.toFixed(0)}%
              </span>
            )}
            {typeof selected.radiation === 'number' && selected.radiation > 0 && (
              <span
                className={styles.healthSignal}
                style={{ '--signal-color': selected.radiation > 2000 ? 'var(--rust)' : 'var(--text-3)' } as CSSProperties}
              >
                rad {selected.radiation.toFixed(0)}mSv
              </span>
            )}
          </div>
        )}

        {/* role="log" so AT users can navigate the chat as a message
            history and hear new messages appended live (aria-live polite
            scoped to additions). */}
        <div
          ref={messagesRef}
          onScroll={onMessagesScroll}
          className={styles.messages}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label={selected?.name ? `Messages with ${selected.name}` : 'Chat messages'}
        >
          {!selectedId && (
            <div className={styles.emptyState}>
              <div className={styles.emptyTitle}>
                {agents.length ? `Select an agent to start chatting.` : 'No agents available yet.'}
              </div>
              <div className={styles.emptyCopy}>
                {agents.length
                  ? `Each agent is a simulated ${scenario.labels.populationNoun.replace(/s$/, '')} with a unique HEXACO personality, persistent memory of events they survived, evolving stances on topics, and relationships with other agents. Their responses reflect their actual simulation experience.`
                  : `Run a simulation from the Settings tab. Once the first turn completes, agents become available for conversation. The chat system uses each agent's personality profile, memory, and event history to generate authentic in-character responses.`
                }
              </div>
            </div>
          )}

          {/* Event context when agent is selected */}
          {selectedId && selected?.memory && (
            <EventContext memory={selected.memory} events={state} scenario={scenario} />
          )}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={[styles.bubbleWrap, msg.role === 'user' ? styles.fromUser : styles.fromAgent].join(' ')}
            >
              {msg.name && <div className={styles.bubbleName}>{msg.name}</div>}
              <div className={[styles.bubble, msg.role === 'user' ? styles.user : ''].filter(Boolean).join(' ')}>
                {msg.text}
              </div>
            </div>
          ))}

          {/* Typing indicator while waiting on agent response */}
          {sending && selectedId && (
            <div className={[styles.bubbleWrap, styles.fromAgent].join(' ')} aria-live="polite" aria-label={`${selected?.name || 'Agent'} is typing`}>
              <div className={styles.bubbleName}>
                {selected?.name || selectedId}
              </div>
              <div className={styles.typingBubble}>
                <span className={styles.typingLabel}>typing</span>
                <span className={styles.dot} aria-hidden="true" style={{ '--dot-delay': '0ms' } as CSSProperties}>.</span>
                <span className={styles.dot} aria-hidden="true" style={{ '--dot-delay': '160ms' } as CSSProperties}>.</span>
                <span className={styles.dot} aria-hidden="true" style={{ '--dot-delay': '320ms' } as CSSProperties}>.</span>
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className={styles.inputRow}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send()}
            disabled={!selectedId || sending}
            aria-label={selectedId ? `Message ${selected?.name || 'agent'}` : 'Select an agent first'}
            placeholder={selectedId ? `Ask ${selected?.name || 'agent'}...` : `Select a ${scenario.labels.populationNoun.replace(/s$/, '')} first`}
            className={styles.inputField}
          />
          <button
            onClick={send}
            disabled={!selectedId || sending || !input.trim()}
            className={styles.sendBtn}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
