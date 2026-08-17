// Per-card visual anchor — derives an emoji icon from a card's tag
// (preferred) or codeLanguage (fallback). Without this, every card in
// the Library / DrawResult / CardDetail surfaces looks like a text-only
// rectangle. With it, each card has a small visual signature making
// the collection feel like collecting *things*, not text snippets.

const TAG_ICONS: Record<string, string> = {
  // Programming concepts
  closure: '🔗',
  closures: '🔗',
  scope: '🔭',
  hoisting: '⬆️',
  promise: '🤝',
  promises: '🤝',
  async: '⏳',
  await: '⏳',
  callback: '↪️',
  callbacks: '↪️',
  generator: '🔄',
  generators: '🔄',
  iterator: '🧮',
  iterators: '🧮',
  // Memory / performance
  memory: '🧠',
  gc: '♻️',
  performance: '⚡',
  cache: '💾',
  caching: '💾',
  optimization: '⚡',
  // Data structures
  array: '📊',
  list: '📋',
  map: '🗺️',
  set: '🎯',
  tree: '🌳',
  graph: '🕸️',
  stack: '📚',
  queue: '🚶',
  hash: '#️⃣',
  // Patterns
  pattern: '🧩',
  patterns: '🧩',
  singleton: '☝️',
  factory: '🏭',
  observer: '👁️',
  // Database / SQL
  database: '🗄️',
  db: '🗄️',
  sql: '🗃️',
  query: '🔍',
  index: '📑',
  join: '🔗',
  transaction: '💳',
  // Network / API
  api: '🌐',
  rest: '🛤️',
  http: '📡',
  request: '📨',
  response: '📬',
  // Concurrency / threading
  thread: '🧵',
  threading: '🧵',
  lock: '🔒',
  mutex: '🔒',
  race: '🏃',
  deadlock: '🔐',
  // Cloud / infra
  aws: '☁️',
  cloud: '☁️',
  s3: '🪣',
  ec2: '🖥️',
  lambda: 'λ',
  docker: '🐳',
  kubernetes: '☸️',
  k8s: '☸️',
  // AI / ML
  ai: '🤖',
  ml: '🧬',
  model: '🧬',
  training: '🏋️',
  inference: '🔮',
  prompt: '💬',
  embedding: '📐',
  // Testing / debugging
  test: '🧪',
  testing: '🧪',
  debug: '🪲',
  bug: '🐛',
  // Security
  security: '🛡️',
  auth: '🔑',
  authentication: '🔑',
  authorization: '🪪',
  encryption: '🔐',
  // Misc common
  oop: '🧱',
  inheritance: '🧬',
  polymorphism: '🎭',
  interface: '🔌',
  abstract: '🌫️',
  function: 'ƒ',
  recursion: '🌀',
  algorithm: '⚙️',
  complexity: '📈',
  string: '🪢',
  regex: '🔣',
};

const LANGUAGE_ICONS: Record<string, string> = {
  cs: '🪟',
  csharp: '🪟',
  'c#': '🪟',
  ts: '📘',
  typescript: '📘',
  tsx: '⚛️',
  js: '📜',
  javascript: '📜',
  jsx: '⚛️',
  py: '🐍',
  python: '🐍',
  rb: '💎',
  ruby: '💎',
  go: '🐹',
  rs: '🦀',
  rust: '🦀',
  java: '☕',
  kt: '🟪',
  kotlin: '🟪',
  swift: '🐦',
  sql: '🗃️',
  sh: '🐚',
  shell: '🐚',
  bash: '🐚',
  yml: '📄',
  yaml: '📄',
  json: '📋',
  cpp: '🔧',
  'c++': '🔧',
  c: '🔠',
  php: '🐘',
};

const FALLBACK_ICON = '✦';

function normalize(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * Resolve a single emoji icon for a card. Prefers the tag (more
 * semantic — tells you what the card is *about*) and falls back to
 * the code language. If neither matches, returns a neutral sparkle.
 */
export function cardIconFor(card: { Tag?: string | null; CodeLanguage?: string | null } | null | undefined): string {
  if (!card) return FALLBACK_ICON;
  const tag = normalize(card.Tag);
  if (tag && TAG_ICONS[tag]) return TAG_ICONS[tag];
  // Tag may be multi-word (e.g. "async / await"); try first token
  if (tag) {
    const firstToken = tag.split(/[\s\/,;|]+/).filter(Boolean)[0];
    if (firstToken && TAG_ICONS[firstToken]) return TAG_ICONS[firstToken];
  }
  const lang = normalize(card.CodeLanguage);
  if (lang && LANGUAGE_ICONS[lang]) return LANGUAGE_ICONS[lang];
  return FALLBACK_ICON;
}

// Looser variant for VMs that already extracted plain string fields.
export function cardIconForFields(tag?: string | null, codeLanguage?: string | null): string {
  return cardIconFor({ Tag: tag ?? null, CodeLanguage: codeLanguage ?? null });
}
