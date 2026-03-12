// Tags that wrap user content — strip open/close, keep inner text
const WRAPPER_TAGS = ['user_query', 'user_message', 'system_reminder'];

// Tags whose entire block is system noise — remove the whole <tag>...</tag>
const NOISE_TAGS = ['ide_opened_file', 'local-command-caveat'];

const ALL_TAGS = [...WRAPPER_TAGS, ...NOISE_TAGS].join('|');

const OPEN_RE = new RegExp(
  `^\\s*<(?:${ALL_TAGS})(?:\\s[^>]*)?>\\s*`,
  'i'
);
const CLOSE_RE = new RegExp(
  `\\s*</(?:${ALL_TAGS})>\\s*$`,
  'i'
);

const NOISE_BLOCK_RE = new RegExp(
  `^\\s*<(${NOISE_TAGS.join('|')})(?:\\s[^>]*)?>.*?</\\1>\\s*`,
  'is'
);

export function stripPromptWrappers(text: string): string {
  let result = text;
  let prev: string;
  do {
    prev = result;
    result = result.replace(NOISE_BLOCK_RE, '');
    result = result.replace(OPEN_RE, '');
    result = result.replace(CLOSE_RE, '');
  } while (result !== prev);
  return result.trim();
}
