const GRAMMAR = /^\/memory\s+(status|query|capture|reconcile|extract)(\s+.*)?$/;

export function interceptMemoryCommand(input: string):
  | { intercepted: false }
  | { intercepted: true; action: string; command?: string; user_message: string } {
  const trimmed = input.trim();
  const match = trimmed.match(GRAMMAR);
  if (!match) return { intercepted: false };

  const action = match[1];
  const rest = (match[2] || '').trim();

  if (action === 'status') {
    return { intercepted: true, action, command: 'ai-memory status --json', user_message: 'Running memory status...' };
  }
  if (action === 'query') {
    return { intercepted: true, action, command: `ai-memory query \"${rest}\" --json`, user_message: 'Running memory query...' };
  }
  if (action === 'reconcile') {
    return { intercepted: true, action, command: 'ai-memory sweep --json', user_message: 'Running memory reconciliation...' };
  }
  if (action === 'capture') {
    return {
      intercepted: true,
      action,
      user_message: `Command blocked. Type: Remember that ${rest}`
    };
  }
  return {
    intercepted: true,
    action,
    user_message:
      'Command blocked. Type: Extract key memories from the last turns as decision/correction/pattern/learning/preference/fact and call ai-memory-capture.'
  };
}
