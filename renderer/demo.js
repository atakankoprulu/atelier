// Fake hook events for trying out the scene without running Claude Code.

const S = 'demo-session';

const script = [
  [0.5, { hook_event_name: 'SessionStart', source: 'startup' }],
  [5.5, { hook_event_name: 'UserPromptSubmit', prompt: 'can you find and fix the bug on the login page?' }],
  [3.0, { hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_input: { pattern: 'handleLogin' } }],
  [2.5, { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/app/src/auth/login.ts' } }],
  [2.5, { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { description: 'Agent to review the tests' } }],
  [0.8, { hook_event_name: 'SubagentStart', agent_id: 'demo-a1', agent_type: 'Explore' }],
  [0.6, { hook_event_name: 'SubagentStart', agent_id: 'demo-a2', agent_type: 'test-runner' }],
  [2.4, { hook_event_name: 'PreToolUse', tool_name: 'WebSearch', tool_input: { query: 'oauth token refresh race condition' } }],
  [1.5, { hook_event_name: 'PreToolUse', agent_id: 'demo-a1', tool_name: 'Glob', tool_input: { pattern: '**/*.test.ts' } }],
  [1.5, { hook_event_name: 'PreToolUse', agent_id: 'demo-a2', tool_name: 'Bash', tool_input: { command: 'npm test -- auth' } }],
  [3.5, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm run build' } }],
  [1.0, { hook_event_name: 'PostToolUseFailure', tool_name: 'Bash' }],
  [3.0, { hook_event_name: 'SubagentStop', agent_id: 'demo-a1', agent_type: 'Explore' }],
  [2.0, { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/app/src/auth/login.ts' } }],
  [3.0, { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'git push' } }],
  [4.0, { hook_event_name: 'SubagentStop', agent_id: 'demo-a2', agent_type: 'test-runner' }],
  [1.5, { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/app/src/auth/session.ts' } }],
  [3.5, { hook_event_name: 'Stop' }],
];

export function runDemo(handle) {
  let t = 0;
  const timers = [];
  for (const [delay, ev] of script) {
    t += delay;
    timers.push(setTimeout(() => handle({ session_id: S, ...ev }), t * 1000));
  }
  return () => timers.forEach(clearTimeout);
}
