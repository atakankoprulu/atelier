// Director: turns Claude Code hook events into behavior in the scene.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const short = (s, n = 38) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const base = (p) => String(p ?? '').split('/').filter(Boolean).pop() || '';
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return short(u, 24); } };
const code = (s) => `<code>${esc(s)}</code>`;

// Tool → where to go, what to do, what to say.
function activityFor(tool, input = {}) {
  switch (tool) {
    case 'Edit': case 'MultiEdit': case 'Write': case 'NotebookEdit':
      return { spot: 'claudeSeat', pose: 'type', text: `✏️ ${code(base(input.file_path || input.notebook_path))}` };
    case 'Read':
      return { spot: 'claudeSeat', pose: 'think', text: `📖 ${code(base(input.file_path))}` };
    case 'Grep': case 'Glob': case 'LS':
      return { spot: 'claudeSeat', pose: 'think', text: `🔍 ${code(short(input.pattern || input.path, 28))}` };
    case 'Bash': case 'BashOutput': case 'KillShell': case 'Monitor':
      return { spot: 'rack', pose: 'tinker', text: `${code('$ ' + short(input.command || input.description || tool, 32))}` };
    case 'WebSearch':
      return { spot: 'shelf', pose: 'read', text: `🌐 ${esc(short(input.query, 30))}` };
    case 'WebFetch':
      return { spot: 'shelf', pose: 'read', text: `🌐 ${esc(host(input.url))}` };
    case 'Skill':
      return { spot: 'shelf', pose: 'read', text: `📚 ${esc(short(input.skill || input.command, 28))}` };
    case 'Agent': case 'Task':
      return { spot: 'claudeSeat', pose: 'type', text: `📣 ${esc(short(input.description || 'Calling in the team', 30))}` };
    case 'TodoWrite': case 'TaskCreate': case 'TaskUpdate':
      return { spot: 'claudeSeat', pose: 'type', text: '📋 Making a plan' };
    case 'AskUserQuestion':
      return { spot: 'claudeSeat', pose: 'raise', text: 'I have a question for you!', variant: 'ask', ask: true };
    default:
      if (tool?.startsWith('mcp__')) {
        const [, server, name] = tool.split('__');
        return { spot: 'claudeSeat', pose: 'type', text: `🔌 ${esc(short(`${server} · ${name}`, 30))}` };
      }
      return { spot: 'claudeSeat', pose: 'type', text: esc(tool || '…') };
  }
}

export class Director {
  constructor(world, { onStatus } = {}) {
    this.world = world;
    this.onStatus = onStatus || (() => {});
    this.claude = null;
    this.agents = new Map();
    this.agentSeq = 0;
    this.timers = [];
    world.onTick((_dt, t) => {
      const due = this.timers.filter((x) => t >= x.at);
      this.timers = this.timers.filter((x) => t < x.at);
      due.forEach((x) => x.fn());
    });

    this.user = world.addCharacter({ id: 'user', kind: 'user' });
    this.user.placeAt('userSeat');
    this.user.pose = 'sit';
    this.status('out', 'Claude is out');
  }

  later(sec, fn) { this.timers.push({ at: this.world.time + sec, fn }); }

  status(kind, text) { this.onStatus(kind, text); }

  userTyped() { this.user.typingUntil = this.world.time + 0.35; }

  // --- Claude ---------------------------------------------------------------

  ensureClaude() {
    if (this.claude) return this.claude;
    const c = this.world.addCharacter({ id: 'claude', kind: 'claude', scale: 1.1 });
    this.world.claude = c;
    this.claude = c;
    c.seq = 0;
    c.placeAt('outside');
    c.goTo('claudeSide', 'wave', {
      onArrive: () => {
        c.look(this.user, 2.2);
        this.user.look(c, 2.2);
        c.say('Hi there! 👋', 2.6);
        this.later(1.8, () => { if (c.spot === 'claudeSide') c.goTo('claudeSeat', 'sit'); });
      },
    });
    this.status('here', 'Claude is coming…');
    return c;
  }

  // Give Claude a new task. Cancels any previously scheduled follow-up steps.
  act(spot, pose, { text, variant = '', seconds = 3.2, dwell = 2.2, onArrive } = {}) {
    const c = this.ensureClaude();
    const seq = ++c.seq;
    c.goTo(spot, pose, { dwell, onArrive: onArrive && ((ch) => { if (c.seq === seq) onArrive(ch); }) });
    if (text) c.say(text, seconds, variant);
    return seq;
  }

  // --- agents -----------------------------------------------------------------

  spawnAgent(ev) {
    const id = ev.agent_id || `anon-${++this.agentSeq}`;
    if (this.agents.has(id)) return this.agents.get(id);
    const desks = this.world.agentDesks;
    const slot = desks.findIndex((d) => !d.occupant);
    const type = ev.agent_type || 'agent';
    const a = this.world.addCharacter({
      id, kind: 'agent', scale: 0.62,
      color: this.world.agentColor(type),
      label: short(type, 18),
    });
    a.slot = slot;
    a.type = type;
    a.placeAt('outside');
    if (slot >= 0) {
      desks[slot].occupant = a;
      a.goTo(`agent${slot}`, 'type', { onArrive: () => a.say('Ready!', 1.6) });
    } else {
      a.goTo('coffee', 'stand'); // no free desk: wait in the coffee corner
    }
    this.agents.set(id, a);
    this.updateAgentStatus();
    return a;
  }

  dismissAgent(ev) {
    let a = ev.agent_id && this.agents.get(ev.agent_id);
    if (!a) a = [...this.agents.values()].find((x) => !x.leaving && (!ev.agent_type || x.type === ev.agent_type));
    if (!a || a.leaving) return;
    a.leaving = true;
    const desk = this.world.agentDesks[a.slot];
    const exit = () => a.goTo('outside', 'stand', {
      onArrive: () => {
        this.world.removeCharacter(a);
        this.agents.delete(a.id);
        this.updateAgentStatus();
      },
    });
    // Report back: walk up to Claude if present, hand over the report, then leave.
    const c = this.claude;
    a.goTo(a.slot >= 0 ? `agentReport${a.slot}` : 'coffee', 'report', {
      onArrive: () => {
        if (desk) desk.occupant = null;
        a.say('Report ready! 📄', 2.2);
        if (c) { a.look(c, 2.2); c.look(a, 2.2); this.later(0.9, () => c.say('Nice work 🙌', 1.6)); }
        this.later(2.0, exit);
      },
    });
  }

  updateAgentStatus() {
    if (!this.claude) return;
    const n = [...this.agents.values()].filter((a) => !a.leaving).length;
    this.status('busy', n ? `Claude is working · ${n} agent${n > 1 ? 's' : ''}` : 'Claude is working');
  }

  agentTool(ev) {
    const a = this.agents.get(ev.agent_id) || this.spawnAgent(ev);
    if (a.leaving) return;
    const act = activityFor(ev.tool_name, ev.tool_input);
    if (a.slot >= 0) a.goTo(`agent${a.slot}`, act.pose === 'think' ? 'think' : 'type');
    a.say(act.text, 2.0);
  }

  // --- events ---------------------------------------------------------------

  handle(ev) {
    const name = ev.hook_event_name;
    const c = this.claude;
    switch (name) {
      case 'SessionStart': {
        const fresh = !this.claude;
        const cl = this.ensureClaude();
        if (!fresh) {
          const msg = { clear: 'Fresh start ✨', compact: 'Notes ready 🗒️', resume: 'Picking up where we left off!' }[ev.source];
          if (msg) cl.say(msg, 2.5);
        }
        break;
      }

      case 'UserPromptSubmit': {
        // A background agent's completion notice to Claude also arrives as this event; you didn't type it.
        if (/^\s*<task-notification>/.test(ev.prompt || '')) {
          if (c && !c.walking) c.say('📬 Word from an agent', 2.2);
          return;
        }
        const cl = this.ensureClaude();
        if (ev.prompt) this.user.say(esc(short(ev.prompt, 44)), 3);
        this.user.look(cl, 1.5);
        const seq = this.act('claudeSeat', 'listen', { dwell: 0 });
        cl.look(this.user, 2.2);
        this.later(2.2, () => { if (cl.seq === seq && cl.pose === 'listen') cl.pose = 'think'; });
        this.updateAgentStatus();
        break;
      }

      case 'PreToolUse': {
        if (ev.agent_id) return this.agentTool(ev);
        const act = activityFor(ev.tool_name, ev.tool_input);
        this.act(act.spot, act.pose, { text: act.text, variant: act.variant });
        if (act.ask) {
          this.claude.look(this.user, 6);
          this.user.look(this.claude, 2);
          this.status('ask', 'Claude has a question');
        } else {
          this.updateAgentStatus();
        }
        break;
      }

      case 'PostToolUseFailure': {
        if (ev.agent_id) {
          const a = this.agents.get(ev.agent_id);
          if (a) a.say('Hmm, no luck…', 1.8, 'err');
          return;
        }
        if (!c) return;
        c.say('Hmm, no luck… trying again 🤔', 2.4, 'err');
        if (!c.walking && c.spot === 'claudeSeat') {
          const seq = ++c.seq;
          c.pose = 'scratch';
          this.later(1.6, () => { if (c.seq === seq) c.pose = 'think'; });
        }
        break;
      }

      case 'PermissionRequest':
      case 'Notification': {
        if (name === 'Notification' && ev.notification_type === 'idle_prompt') {
          if (c && !c.walking) { c.look(this.user, 3); c.say('Your turn 👀', 3); }
          return;
        }
        if (name === 'Notification' && ev.notification_type && ev.notification_type !== 'permission_prompt') return;
        const tool = ev.tool_name ? ` (${esc(ev.tool_name)})` : '';
        this.act('claudeSeat', 'raise', { text: `✋ Need your permission${tool}`, variant: 'ask', seconds: 6, dwell: 0 });
        this.claude.look(this.user, 8);
        this.user.look(this.claude, 2.5);
        this.status('ask', 'Claude needs permission');
        break;
      }

      case 'Stop': {
        if (!c) return;
        this.act('coffee', 'drink', {
          text: 'Done ✓', dwell: 1.2,
          onArrive: () => {
            const seq = c.seq;
            this.later(3.2, () => { if (c.seq === seq) c.goTo('claudeSeat', 'lean'); });
          },
        });
        this.status('here', 'Claude is waiting for you');
        break;
      }

      case 'PreCompact':
        this.act('shelf', 'read', { text: '🗒️ Tidying up my notes', seconds: 4 });
        break;

      case 'SubagentStart': {
        this.spawnAgent(ev);
        if (c && !c.walking) c.say(`📣 ${esc(short(ev.agent_type || 'Agent', 20))} is coming`, 2.2);
        break;
      }

      case 'SubagentStop':
        this.dismissAgent(ev);
        break;

      case 'SessionEnd': {
        for (const a of this.agents.values()) this.dismissAgent({ agent_id: a.id });
        if (!c) return;
        this.act('claudeSide', 'wave', {
          text: 'See you! 👋', dwell: 0,
          onArrive: () => {
            c.look(this.user, 2);
            const seq = c.seq;
            this.later(1.6, () => c.seq === seq && c.goTo('outside', 'stand', {
              onArrive: () => {
                if (c.seq !== seq) return; // a new session started in the meantime: come back
                this.world.removeCharacter(c);
                if (this.claude === c) { this.claude = null; this.world.claude = null; }
              },
            }));
          },
        });
        this.status('out', 'Claude is out');
        break;
      }

      default:
        break;
    }
  }
}
