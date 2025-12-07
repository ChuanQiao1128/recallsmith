// mobile/src/mock/jsCoreStarterMock.ts
import type { CardExport, DeckExport } from '../types/deckExport';

type CardSeed = {
  Difficulty: 1 | 2 | 3;
  CodeLanguage?: string;
  Question: string;
  Explanation: string;
  CodeSnippet: string;
  RealWorldUsage: string;
};

function code(s: string) {
  return s.trim();
}

function buildCards(slug: string, seeds: CardSeed[]): CardExport[] {
  return seeds.map((seed, idx) => ({
    StableUid: `${slug}-${idx + 1}`,
    OrderInDeck: idx + 1,
    Difficulty: seed.Difficulty,
    CodeLanguage: seed.CodeLanguage ?? 'JavaScript',
    Question: seed.Question,
    Explanation: seed.Explanation,
    CodeSnippet: seed.CodeSnippet,
    RealWorldUsage: seed.RealWorldUsage,
  }));
}

const JS_CORE_SLUG = 'js-core-basics';
const TS_REACT_SLUG = 'ts-react-essentials';
const WEB_API_SLUG = 'web-api-fundamentals';
const SYSTEM_DESIGN_PRO_SLUG = 'system-design-pro';
const CLOUD_PRO_SLUG = 'cloud-pro';

const JS_CORE_SEEDS: CardSeed[] = [
  {
    Difficulty: 1,
    CodeLanguage: 'JavaScript',
    Question: 'What is the difference between var, let, and const?',
    Explanation:
      'var is function-scoped and hoisted (initialized as undefined). let/const are block-scoped and exist in the temporal dead zone until initialized. const prevents reassignment (but objects can still be mutated).',
    CodeSnippet: code(`
function demo() {
  if (true) {
    var a = 1;
    let b = 2;
    const c = { x: 3 };
    c.x = 4; // allowed
  }
  console.log(a); // 1
  // console.log(b); // ReferenceError (TDZ)
}
`),
    RealWorldUsage:
      'Prefer const by default; use let for state that changes. Avoid var in modern codebases to reduce hoisting/scope surprises.',
  },
  {
    Difficulty: 1,
    CodeLanguage: 'JavaScript',
    Question: 'What is hoisting in JavaScript?',
    Explanation:
      'Function declarations are hoisted with their body. var declarations are hoisted but initialized to undefined. let/const are hoisted but not initialized (TDZ).',
    CodeSnippet: code(`
console.log(x); // undefined
var x = 1;

sayHi(); // works
function sayHi() {
  console.log('hi');
}

// console.log(y); // ReferenceError (TDZ)
// let y = 2;
`),
    RealWorldUsage:
      'Hoisting explains many “undefined” bugs in legacy code and is why style guides keep declarations near first use.',
  },
  {
    Difficulty: 2,
    CodeLanguage: 'JavaScript',
    Question: 'What is a closure?',
    Explanation:
      'A closure is when a function “remembers” variables from its lexical scope even after that scope has returned.',
    CodeSnippet: code(`
function makeCounter() {
  let count = 0;
  return () => {
    count += 1;
    return count;
  };
}

const counter = makeCounter();
console.log(counter()); // 1
console.log(counter()); // 2
`),
    RealWorldUsage:
      'Closures power module patterns, React hooks, and utilities like debounce/throttle by keeping state private and persistent.',
  },
  {
    Difficulty: 2,
    CodeLanguage: 'JavaScript',
    Question: 'How does this work in JavaScript?',
    Explanation:
      '`this` depends on the call site: obj.method() binds this to obj; plain calls default to undefined in strict mode; arrow functions capture lexical this.',
    CodeSnippet: code(`
'use strict';

const obj = {
  x: 1,
  method() { console.log(this.x); },
};

obj.method(); // 1
const f = obj.method;
// f(); // TypeError (this is undefined)
`),
    RealWorldUsage:
      'Callback bugs often come from losing this. Fix with binding, arrow wrappers, or avoiding this-heavy patterns.',
  },
  {
    Difficulty: 2,
    CodeLanguage: 'JavaScript',
    Question: 'What are prototypes?',
    Explanation:
      'Objects delegate property lookups to a prototype (prototype chain). Functions expose .prototype used by new to set the instance prototype.',
    CodeSnippet: code(`
function Person(name) {
  this.name = name;
}

Person.prototype.sayHi = function () {
  return 'Hi, ' + this.name;
};

const p = new Person('Ava');
console.log(p.sayHi());
`),
    RealWorldUsage:
      'Prototype knowledge helps you understand classes under the hood and memory-efficient method sharing.',
  },
  {
    Difficulty: 2,
    CodeLanguage: 'JavaScript',
    Question: 'What is the event loop (microtasks vs macrotasks)?',
    Explanation:
      'After the current call stack is cleared, microtasks (Promise callbacks) run before macrotasks (setTimeout).',
    CodeSnippet: code(`
console.log('A');
setTimeout(() => console.log('B'), 0);
Promise.resolve().then(() => console.log('C'));
console.log('D');
// Output: A D C B
`),
    RealWorldUsage:
      'This explains UI “jank”, why Promise chains run sooner than timers, and how to schedule work without blocking rendering.',
  },
  {
    Difficulty: 1,
    CodeLanguage: 'JavaScript',
    Question: 'How does async/await relate to Promises?',
    Explanation:
      'async functions return a Promise. await pauses inside the async function until the promise settles, then returns the value or throws.',
    CodeSnippet: code(`
async function getUser() {
  const res = await fetch('/user');
  if (!res.ok) throw new Error('Bad response');
  return res.json();
}
`),
    RealWorldUsage:
      'async/await makes network code readable and maintainable for sequential steps and clear error handling.',
  },
  {
    Difficulty: 2,
    CodeLanguage: 'JavaScript',
    Question: 'What is debounce vs throttle?',
    Explanation:
      'Debounce waits for inactivity before running. Throttle runs at most once per interval. Both reduce noisy event handlers.',
    CodeSnippet: code(`
function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function throttle(fn, ms) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    }
  };
}
`),
    RealWorldUsage:
      'Use debounce for search input and autosave; use throttle for scroll handlers and analytics pings.',
  },
  {
    Difficulty: 1,
    CodeLanguage: 'JavaScript',
    Question: 'Optional chaining (?.) and nullish coalescing (??): what do they do?',
    Explanation:
      '?. safely accesses nested properties without throwing. ?? provides a default only when the value is null/undefined (not 0/false/"").',
    CodeSnippet: code(`
const user = { profile: null };
const name = user.profile?.name ?? 'Anonymous';
console.log(name);

const page = 0;
console.log(page ?? 1); // 0
console.log(page || 1); // 1
`),
    RealWorldUsage:
      'Great for resilient rendering of partially loaded data and setting defaults without breaking valid falsy values.',
  },
  {
    Difficulty: 2,
    CodeLanguage: 'JavaScript',
    Question: 'How does AbortController work with fetch?',
    Explanation:
      'AbortController lets you cancel an in-flight request by passing controller.signal to fetch and calling controller.abort().',
    CodeSnippet: code(`
const controller = new AbortController();
fetch('/search?q=js', { signal: controller.signal });
// later...
controller.abort();
`),
    RealWorldUsage:
      'Cancel stale requests in type-ahead search or fast navigation to avoid race conditions and wasted work.',
  },
];

while (JS_CORE_SEEDS.length < 50) {
  const i = JS_CORE_SEEDS.length + 1;
  JS_CORE_SEEDS.push({
    Difficulty: 2,
    CodeLanguage: 'JavaScript',
    Question: 'JavaScript drill #' + i + ': explain one pitfall and one safe pattern.',
    Explanation:
      'Placeholder card to keep the deck size at 50 in the mock build. Replace later with authored content.',
    CodeSnippet: code(`
// Placeholder snippet
export function placeholder${i}() {
  return 'Replace this with real deck content.';
}
`),
    RealWorldUsage:
      'Replace placeholders with real prompts (core JS, async patterns, data structures) once your authoring flow is ready.',
  });
}

const TS_REACT_SEEDS: CardSeed[] = [
  {
    Difficulty: 1,
    CodeLanguage: 'TypeScript',
    Question: 'type vs interface: when do you use each?',
    Explanation:
      'Both can describe object shapes. interface is common for public object contracts and can be merged (declaration merging). type is more flexible (unions, intersections, mapped/conditional types).',
    CodeSnippet: code(`
interface User { id: string; name: string }
type UserId = User['id'] | number;
`),
    RealWorldUsage:
      'Use interface for component props and domain models; use type for advanced compositions like unions of API states.',
  },
  {
    Difficulty: 1,
    CodeLanguage: 'TypeScript',
    Question: 'Union vs intersection types: what do they mean?',
    Explanation:
      'A union (A | B) means a value can be either type. An intersection (A & B) means a value must satisfy both types.',
    CodeSnippet: code(`
type Loading = { state: 'loading' };
type Ready = { state: 'ready'; data: string[] };
type ViewState = Loading | Ready;

type WithId = { id: string };
type WithName = { name: string };
type Person = WithId & WithName;
`),
    RealWorldUsage:
      'Unions are perfect for UI state machines. Intersections help build reusable “mixins” like WithId, WithTimestamps.',
  },
  {
    Difficulty: 2,
    CodeLanguage: 'TypeScript',
    Question: 'What are generics and why are they useful?',
    Explanation:
      'Generics let you write reusable functions/components while preserving type information of inputs and outputs.',
    CodeSnippet: code(`
function first<T>(arr: T[]): T | undefined {
  return arr[0];
}
const x = first([1, 2, 3]); // number | undefined
`),
    RealWorldUsage:
      'Generics make helpers like fetchJson<T>() type-safe so you can avoid “any” and catch mismatches at compile time.',
  },
  {
    Difficulty: 2,
    CodeLanguage: 'TypeScript',
    Question: 'What is a discriminated union?',
    Explanation:
      'A union of object types that share a common literal field (the discriminant). TypeScript can narrow based on that field.',
    CodeSnippet: code(`
type Ok = { ok: true; value: string };
type Err = { ok: false; message: string };
type Result = Ok | Err;

function handle(r: Result) {
  if (r.ok) return r.value;
  return r.message;
}
`),
    RealWorldUsage:
      'Great for API results, async states, and reducers—keeps logic explicit and prevents undefined access.',
  },
  {
    Difficulty: 2,
    CodeLanguage: 'TypeScript',
    Question: 'unknown vs any: what is the difference?',
    Explanation:
      'any turns off type checking. unknown forces you to narrow before using the value, making it safer for untrusted data.',
    CodeSnippet: code(`
function parse(input: unknown) {
  if (typeof input === 'string') return input.toUpperCase();
  return 'N/A';
}
`),
    RealWorldUsage:
      'Use unknown for JSON.parse results and external inputs; then validate/narrow before using.',
  },
  {
    Difficulty: 1,
    CodeLanguage: 'TypeScript',
    Question: 'What are common utility types (Partial, Pick, Omit, Record)?',
    Explanation:
      'Utility types help build new types from existing ones. Partial makes fields optional, Pick selects keys, Omit removes keys, Record maps keys to a type.',
    CodeSnippet: code(`
type User = { id: string; name: string; email: string };
type UserPreview = Pick<User, 'id' | 'name'>;
type UserUpdate = Partial<Omit<User, 'id'>>;
type ErrorMap = Record<string, string>;
`),
    RealWorldUsage:
      'You’ll use these constantly when defining API DTOs, update payloads, and derived props.',
  },
  {
    Difficulty: 2,
    CodeLanguage: 'React',
    Question: 'How do you type React component props?',
    Explanation:
      'Define a props type/interface and use it on the component. Prefer explicit props typing; it keeps autocomplete and refactors safe.',
    CodeSnippet: code(`
type ButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
};

export function PrimaryButton(props: ButtonProps) {
  return null;
}
`),
    RealWorldUsage:
      'Well-typed components prevent UI wiring bugs (wrong callback shape, missing required fields) and improve teammate velocity.',
  },
  {
    Difficulty: 2,
    CodeLanguage: 'React',
    Question: 'useState typing: when do you need generics?',
    Explanation:
      'TypeScript infers from the initial value. Use a generic when the initial state is null/undefined or when you need a union type.',
    CodeSnippet: code(`
type User = { id: string; name: string };
const [user, setUser] = React.useState<User | null>(null);
setUser({ id: '1', name: 'Ava' });
`),
    RealWorldUsage:
      'Common in apps with async data: state starts null, then becomes a typed object once loaded.',
  },
  {
    Difficulty: 2,
    CodeLanguage: 'React',
    Question: 'useEffect dependencies: what is the safe mental model?',
    Explanation:
      'Put every reactive value you read inside the effect into the dependency array. If you want stability, memoize with useCallback/useMemo.',
    CodeSnippet: code(`
React.useEffect(() => {
  loadUser(userId);
}, [userId]);
`),
    RealWorldUsage:
      'Correct dependencies prevent stale data bugs and infinite loops. It’s one of the most common sources of React app issues.',
  },
  {
    Difficulty: 2,
    CodeLanguage: 'React',
    Question: 'useMemo vs useCallback: what is the difference?',
    Explanation:
      'useMemo memoizes a computed value. useCallback memoizes a function reference. Both are optimization tools and should be justified.',
    CodeSnippet: code(`
const expensive = React.useMemo(() => compute(items), [items]);
const onClick = React.useCallback(() => doThing(id), [id]);
`),
    RealWorldUsage:
      'Use them to avoid re-computing heavy work or re-render cascades, especially when passing props into memoized children.',
  },
];

while (TS_REACT_SEEDS.length < 50) {
  const i = TS_REACT_SEEDS.length + 1;
  TS_REACT_SEEDS.push({
    Difficulty: 2,
    CodeLanguage: 'TypeScript',
    Question: 'TypeScript/React drill #' + i + ': make a type-safe pattern.',
    Explanation:
      'Placeholder card to keep the deck size at 50 in the mock build. Replace later with authored content.',
    CodeSnippet: code(`
// Placeholder snippet
export type Placeholder${i} = { ok: true };
`),
    RealWorldUsage:
      'Replace placeholders with real prompts (narrowing, generics, hooks typing, navigation params) once your authoring flow is ready.',
  });
}

const WEB_API_SEEDS: CardSeed[] = [
  {
    Difficulty: 1,
    CodeLanguage: 'HTTP',
    Question: 'What does “idempotent” mean for HTTP methods?',
    Explanation:
      'An idempotent request can be repeated multiple times with the same effect. GET/PUT/DELETE should be idempotent; POST is typically not.',
    CodeSnippet: code(`
// PUT /users/123
// repeating the same PUT should result in the resource being in the same final state
`),
    RealWorldUsage:
      'Idempotency enables safe retries on flaky networks and prevents duplicated writes when clients retry requests.',
  },
  {
    Difficulty: 1,
    CodeLanguage: 'HTTP',
    Question: 'When do you use 200 vs 201 vs 204?',
    Explanation:
      '200 OK returns a response body. 201 Created is used when a new resource is created (often with a Location header). 204 No Content is used when the request succeeds but there is no body.',
    CodeSnippet: code(`
// POST /items -> 201 Created
// DELETE /items/1 -> 204 No Content
`),
    RealWorldUsage:
      'Consistent status codes make APIs intuitive and reduce special-casing in frontend/mobile clients.',
  },
  {
    Difficulty: 2,
    CodeLanguage: 'HTTP',
    Question: 'What is CORS and why does it exist?',
    Explanation:
      'CORS is a browser security feature that restricts cross-origin requests. Servers must explicitly allow origins/headers/methods for browser clients.',
    CodeSnippet: code(`
// Example response headers:
// Access-Control-Allow-Origin: https://app.example.com
// Access-Control-Allow-Methods: GET,POST
`),
    RealWorldUsage:
      'Mobile apps are less constrained than browsers, but CORS matters for web clients and when configuring API gateways and CDNs.',
  },
  {
    Difficulty: 2,
    CodeLanguage: 'Backend',
    Question: 'Offset vs cursor pagination: what is the difference?',
    Explanation:
      'Offset pagination is simple but can get slow and inconsistent when data changes. Cursor pagination uses a stable sort key and a cursor token and scales better.',
    CodeSnippet: code(`
// Offset: GET /items?limit=20&offset=40
// Cursor: GET /items?limit=20&cursor=<opaque-token>
`),
    RealWorldUsage:
      'Cursor pagination is preferred for large datasets and infinite scroll experiences (feeds, logs, timelines).',
  },
  {
    Difficulty: 2,
    CodeLanguage: 'Security',
    Question: 'JWT vs session cookies: what is the trade-off?',
    Explanation:
      'JWTs are self-contained tokens (less server state) but revocation is harder. Sessions require server-side storage but allow easy invalidation.',
    CodeSnippet: code(`
// JWT: Authorization: Bearer <token>
// Session: Cookie: sid=<sessionId>
`),
    RealWorldUsage:
      'Pick based on needs: sessions are simpler for web apps; JWTs are common for mobile/API clients but need careful refresh/revocation design.',
  },
  {
    Difficulty: 2,
    CodeLanguage: 'Backend',
    Question: 'What is an idempotency key and why use it?',
    Explanation:
      'An idempotency key is a client-generated key sent with a write request so the server can de-duplicate retries and return the same outcome.',
    CodeSnippet: code(`
// POST /payments
// Idempotency-Key: 4f2c...
`),
    RealWorldUsage:
      'This is critical for payments, subscriptions, and any “charge money” endpoint where retries can be costly.',
  },
  {
    Difficulty: 2,
    CodeLanguage: 'Backend',
    Question: 'Where should you validate input: client, server, or both?',
    Explanation:
      'Both. Client validation improves UX, but server validation is the security boundary. Always validate and sanitize on the server.',
    CodeSnippet: code(`
// Server-side pseudo:
// if (!isEmail(body.email)) return 400;
// if (body.role not allowed) return 403;
`),
    RealWorldUsage:
      'Server-side validation prevents crashes and security issues (injection, privilege escalation) from untrusted inputs.',
  },
  {
    Difficulty: 2,
    CodeLanguage: 'Database',
    Question: 'What is a transaction and when do you need one?',
    Explanation:
      'A transaction groups multiple operations into an atomic unit: all succeed or all roll back. It helps maintain data consistency.',
    CodeSnippet: code(`
// BEGIN;
// UPDATE accounts SET balance = balance - 10 WHERE id = 1;
// UPDATE accounts SET balance = balance + 10 WHERE id = 2;
// COMMIT;
`),
    RealWorldUsage:
      'Use transactions for multi-step updates like transfers, order creation + inventory decrement, and any consistency-critical write flow.',
  },
  {
    Difficulty: 2,
    CodeLanguage: 'HTTP',
    Question: 'What are ETags and how do they help caching?',
    Explanation:
      'An ETag is a version identifier for a representation. Clients can send If-None-Match; server replies 304 if unchanged.',
    CodeSnippet: code(`
// Response: ETag: "v3"
// Request: If-None-Match: "v3" -> 304 Not Modified
`),
    RealWorldUsage:
      'ETags save bandwidth, speed up list/detail screens, and reduce backend load for frequently-read resources.',
  },
  {
    Difficulty: 2,
    CodeLanguage: 'Backend',
    Question: 'Why do you need rate limiting?',
    Explanation:
      'Rate limiting protects APIs from abuse and spikes, and helps maintain fairness and reliability under load.',
    CodeSnippet: code(`
// Example: allow 60 requests/min per user
// return 429 Too Many Requests when exceeded
`),
    RealWorldUsage:
      'Prevents accidental overload (bugs) and malicious traffic. Often paired with retries/backoff on the client.',
  },
];

while (WEB_API_SEEDS.length < 50) {
  const i = WEB_API_SEEDS.length + 1;
  WEB_API_SEEDS.push({
    Difficulty: 2,
    CodeLanguage: 'Backend',
    Question: 'Backend/API drill #' + i + ': describe a reliability or security best practice.',
    Explanation:
      'Placeholder card to keep the deck size at 50 in the mock build. Replace later with authored content.',
    CodeSnippet: code(`
// Placeholder snippet
// Add a concrete example here (timeouts, retries/backoff, input validation, authZ, caching, observability, etc.).
`),
    RealWorldUsage:
      'Replace placeholders with scenario-based prompts once your authoring pipeline is ready.',
  });
}

export const jsCoreStarterMock: DeckExport = {
  Title: 'JavaScript Core Basics',
  Slug: JS_CORE_SLUG,
  Locale: 'en-US',
  DeckType: 1,
  IsFreeStarter: true,
  Version: '1.1', // ✅ bump version to help reset old stored progress
  TotalCards: JS_CORE_SEEDS.length,
  FreeCardCount: JS_CORE_SEEDS.length,
  Cards: buildCards(JS_CORE_SLUG, JS_CORE_SEEDS),
};

export const tsReactStarterMock: DeckExport = {
  Title: 'TypeScript + React Essentials',
  Slug: TS_REACT_SLUG,
  Locale: 'en-US',
  DeckType: 1,
  IsFreeStarter: true,
  Version: '1.1',
  TotalCards: TS_REACT_SEEDS.length,
  FreeCardCount: TS_REACT_SEEDS.length,
  Cards: buildCards(TS_REACT_SLUG, TS_REACT_SEEDS),
};

export const webApiStarterMock: DeckExport = {
  Title: 'Web & API Fundamentals',
  Slug: WEB_API_SLUG,
  Locale: 'en-US',
  DeckType: 1,
  IsFreeStarter: true,
  Version: '1.1',
  TotalCards: WEB_API_SEEDS.length,
  FreeCardCount: WEB_API_SEEDS.length,
  Cards: buildCards(WEB_API_SLUG, WEB_API_SEEDS),
};

export const systemDesignPremiumPlaceholderMock: DeckExport = {
  Title: 'System Design (Pro)',
  Slug: SYSTEM_DESIGN_PRO_SLUG,
  Locale: 'en-US',
  DeckType: 2,
  IsFreeStarter: false,
  Version: '1.1',
  TotalCards: 0,
  FreeCardCount: 0,
  Cards: [],
};

export const cloudPremiumPlaceholderMock: DeckExport = {
  Title: 'Cloud Engineering (Pro)',
  Slug: CLOUD_PRO_SLUG,
  Locale: 'en-US',
  DeckType: 2,
  IsFreeStarter: false,
  Version: '1.1',
  TotalCards: 0,
  FreeCardCount: 0,
  Cards: [],
};

export const MOCK_DECKS: DeckExport[] = [
  jsCoreStarterMock,
  tsReactStarterMock,
  webApiStarterMock,
  systemDesignPremiumPlaceholderMock,
  cloudPremiumPlaceholderMock,
];

export function getMockDeckBySlug(slug: string): DeckExport | undefined {
  return MOCK_DECKS.find(d => d.Slug === slug);
}

// Simple global active-deck switcher (keeps navigation simple for now)
let ACTIVE_DECK_SLUG: string = JS_CORE_SLUG;

export function getActiveDeckSlug(): string {
  return ACTIVE_DECK_SLUG;
}

export function setActiveDeckSlug(slug: string): void {
  if (MOCK_DECKS.some(d => d.Slug === slug)) {
    ACTIVE_DECK_SLUG = slug;
  }
}

export function getActiveDeck(): DeckExport {
  return getMockDeckBySlug(ACTIVE_DECK_SLUG) ?? jsCoreStarterMock;
}