// mobile/src/mock/jsCoreStarterMock.ts
import type { DeckExport } from '../types/deckExport';

export const jsCoreStarterMock: DeckExport = {
  Slug: 'js-core-starter',
  Title: 'JavaScript Core Basics (Starter)',
  Locale: 'en-US',
  Version: 'v1',
  DeckType: 1, // 1 = Starter deck
  IsFreeStarter: true,
  TotalCards: 50,
  FreeCardCount: 50,
  Cards: [
    {
      StableUid: 'js-var-let-const-differences',
      Question: 'Explain the differences between var, let, and const.',
      Explanation:
        'var is function-scoped and allows redeclaration. let and const are block-scoped; let can be reassigned, const cannot be reassigned. In modern JavaScript you almost always prefer const, and use let only when you need reassignment.',
      CodeSnippet: `if (true) {
  var a = 1;
  let b = 2;
  const c = 3;
}

console.log(a); // 1
console.log(typeof b); // ReferenceError: b is not defined
console.log(typeof c); // ReferenceError: c is not defined`,
      CodeLanguage: 'js',
      Difficulty: 1,
      OrderInDeck: 10,
    },
    {
      StableUid: 'js-equality-operators-double-vs-triple',
      Question: 'What is the difference between == and === in JavaScript?',
      Explanation:
        '== performs loose equality with type coercion, while === performs strict equality without coercion. In practice you almost always want === (and !==) to avoid surprising coercions.',
      CodeSnippet: `console.log(0 == false);  // true (coercion)
console.log(0 === false); // false (no coercion)

console.log('5' == 5);   // true
console.log('5' === 5);  // false`,
      CodeLanguage: 'js',
      Difficulty: 1,
      OrderInDeck: 20,
    },
    {
      StableUid: 'js-truthy-falsy-values',
      Question: 'What is a “truthy” and a “falsy” value in JavaScript?',
      Explanation:
        'In a boolean context, values that behave like true are called truthy, and values that behave like false are called falsy. The falsy values are: false, 0, -0, 0n, "", null, undefined, and NaN. Everything else is truthy.',
      CodeSnippet: `const values = [0, 1, '', 'hello', null, undefined, [], {}];

values.forEach(v => {
  if (v) {
    console.log(v, 'is truthy');
  } else {
    console.log(v, 'is falsy');
  }
});`,
      CodeLanguage: 'js',
      Difficulty: 1,
      OrderInDeck: 30,
    },
    {
      StableUid: 'js-closure-definition-example',
      Question: 'What is a closure in JavaScript?',
      Explanation:
        'A closure is the combination of a function and its lexical environment. It allows an inner function to access variables from its outer function even after the outer function has returned.',
      CodeSnippet: `function makeCounter() {
  let count = 0;
  return function () {
    count++;
    return count;
  };
}

const counter = makeCounter();
console.log(counter()); // 1
console.log(counter()); // 2`,
      CodeLanguage: 'js',
      Difficulty: 2,
      OrderInDeck: 40,
    },
    {
      StableUid: 'js-hoisting-functions-and-variables',
      Question: 'What is hoisting in JavaScript?',
      Explanation:
        'Hoisting is JavaScript’s behavior of moving declarations to the top of their scope during compilation. Function declarations are fully hoisted, while var declarations are hoisted but not their assignments. let and const are hoisted but are in the temporal dead zone until their declaration line.',
      CodeSnippet: `console.log(x); // undefined (var is hoisted)
var x = 5;

foo();        // 'I am hoisted'
function foo() {
  console.log('I am hoisted');
}

// console.log(y); // ReferenceError (temporal dead zone)
let y = 10;`,
      CodeLanguage: 'js',
      Difficulty: 2,
      OrderInDeck: 50,
    },
    {
      StableUid: 'js-this-global-vs-method-vs-arrow',
      Question: 'How does the value of this differ between normal functions, methods, and arrow functions?',
      Explanation:
        'In non–strict mode, this in a simple function call points to the global object (or undefined in strict mode). In a method call, this points to the object before the dot. Arrow functions do not have their own this; they capture this lexically from the surrounding scope.',
      CodeSnippet: `const obj = {
  value: 42,
  regular() {
    console.log(this.value);
  },
  arrow: () => {
    console.log(this.value);
  },
};

obj.regular(); // 42
obj.arrow();   // often undefined (this from outer scope, not obj)`,
      CodeLanguage: 'js',
      Difficulty: 2,
      OrderInDeck: 60,
    },
    {
      StableUid: 'js-prototype-and-prototype-chain',
      Question: 'What is the prototype chain in JavaScript?',
      Explanation:
        'Every object has an internal [[Prototype]] that points to another object or null. When you access a property, JavaScript first looks on the object itself, then walks up the prototype chain until it finds it or reaches null. This chain of objects is called the prototype chain.',
      CodeSnippet: `const animal = { eats: true };
const dog = Object.create(animal);
dog.barks = true;

console.log(dog.eats);  // true (from prototype)
console.log(dog.barks); // true (own property)`,
      CodeLanguage: 'js',
      Difficulty: 2,
      OrderInDeck: 70,
    },
    {
      StableUid: 'js-scope-types-global-function-block',
      Question: 'What are the main types of scope in JavaScript?',
      Explanation:
        'JavaScript has global scope, function scope, and block scope. var has function scope, while let and const have block scope. Modules also create their own top-level scope.',
      CodeSnippet: `let a = 1; // global (in module: module scope)

function demo() {
  var x = 2;   // function scope
  if (true) {
    let y = 3; // block scope
  }
  // console.log(y); // ReferenceError
}`,
      CodeLanguage: 'js',
      Difficulty: 1,
      OrderInDeck: 80,
    },
    {
      StableUid: 'js-arrow-vs-regular-functions',
      Question: 'What are the key differences between arrow functions and regular functions?',
      Explanation:
        'Arrow functions have a shorter syntax, do not have their own this, arguments, or prototype, and cannot be used as constructors. Regular functions have their own this and can be used with new.',
      CodeSnippet: `const add = (a, b) => a + b;

function Add(a, b) {
  this.result = a + b;
}

const a1 = new Add(1, 2); // works
// const a2 = new add(1, 2); // TypeError: add is not a constructor`,
      CodeLanguage: 'js',
      Difficulty: 2,
      OrderInDeck: 90,
    },
    {
      StableUid: 'js-call-apply-bind',
      Question: 'What do call, apply, and bind do?',
      Explanation:
        'call and apply call a function with an explicit this value. call takes arguments one by one, apply takes them as an array. bind returns a new function with this permanently bound (and optionally partial arguments).',
      CodeSnippet: `function greet(greeting, name) {
  console.log(greeting + ', ' + name + '!');
}

greet.call(null, 'Hello', 'Alice');
greet.apply(null, ['Hi', 'Bob']);

const sayHelloToCarol = greet.bind(null, 'Hello', 'Carol');
sayHelloToCarol();`,
      CodeLanguage: 'js',
      Difficulty: 2,
      OrderInDeck: 100,
    },
    {
      StableUid: 'js-event-loop-basics',
      Question: 'Briefly explain the JavaScript event loop.',
      Explanation:
        'JavaScript has a single call stack. When asynchronous operations complete, their callbacks are queued in task or microtask queues. The event loop continuously checks the call stack and pushes queued callbacks when the stack is empty, giving the illusion of concurrency.',
      CodeSnippet: `console.log('A');

setTimeout(() => {
  console.log('B');
}, 0);

Promise.resolve().then(() => {
  console.log('C');
});

console.log('D');
// Order: A, D, C, B`,
      CodeLanguage: 'js',
      Difficulty: 3,
      OrderInDeck: 110,
    },
    {
      StableUid: 'js-microtask-vs-macrotask',
      Question: 'What is the difference between microtasks and macrotasks?',
      Explanation:
        'Microtasks (like Promise.then and queueMicrotask) run before the next rendering and before macrotasks. Macrotasks (like setTimeout, setInterval) are scheduled in the main task queue. After each macrotask, the event loop drains all microtasks.',
      CodeSnippet: `console.log('start');

setTimeout(() => console.log('macrotask'), 0);

Promise.resolve().then(() => console.log('microtask'));

console.log('end');
// start, end, microtask, macrotask`,
      CodeLanguage: 'js',
      Difficulty: 3,
      OrderInDeck: 120,
    },
    {
      StableUid: 'js-array-map-filter-reduce',
      Question: 'How do map, filter, and reduce differ on arrays?',
      Explanation:
        'map transforms each element and returns a new array. filter keeps elements that match a predicate. reduce accumulates values into a single result (number, object, etc.). They do not mutate the original array.',
      CodeSnippet: `const numbers = [1, 2, 3, 4];

const doubled = numbers.map(x => x * 2);
const evens = numbers.filter(x => x % 2 === 0);
const sum = numbers.reduce((total, x) => total + x, 0);`,
      CodeLanguage: 'js',
      Difficulty: 1,
      OrderInDeck: 130,
    },
    {
      StableUid: 'js-immutability-with-spread',
      Question: 'How can you update objects or arrays immutably in JavaScript?',
      Explanation:
        'You can create shallow copies using the spread syntax or methods like slice / concat, then modify the copy instead of mutating the original. This is common in React and functional-style code.',
      CodeSnippet: `const user = { name: 'Alice', age: 25 };
const updated = { ...user, age: 26 };

const arr = [1, 2, 3];
const arr2 = [...arr, 4];`,
      CodeLanguage: 'js',
      Difficulty: 1,
      OrderInDeck: 140,
    },
    {
      StableUid: 'js-destructuring-basics',
      Question: 'What is destructuring assignment in JavaScript?',
      Explanation:
        'Destructuring lets you unpack values from arrays or properties from objects into distinct variables using a concise syntax.',
      CodeSnippet: `const point = { x: 10, y: 20 };
const { x, y } = point;

const arr = [1, 2, 3];
const [first, , third] = arr;`,
      CodeLanguage: 'js',
      Difficulty: 1,
      OrderInDeck: 150,
    },
    {
      StableUid: 'js-rest-and-spread-operators',
      Question: 'What are the rest and spread syntaxes in JavaScript?',
      Explanation:
        'The rest syntax collects remaining elements into an array or object. The spread syntax expands an iterable or object into individual elements. Both use ... but in different positions.',
      CodeSnippet: `function sum(...nums) {
  return nums.reduce((total, n) => total + n, 0);
}

const base = [1, 2];
const extended = [...base, 3, 4];`,
      CodeLanguage: 'js',
      Difficulty: 2,
      OrderInDeck: 160,
    },
    {
      StableUid: 'js-template-literals',
      Question: 'What are template literals and why are they useful?',
      Explanation:
        'Template literals use backticks and allow interpolation with ${} and multi-line strings, which is more convenient than string concatenation.',
      CodeSnippet: `const name = 'Alice';
const greeting = \`Hello, \${name}!\`;

const multiLine = \`Line 1
Line 2\`;`,
      CodeLanguage: 'js',
      Difficulty: 1,
      OrderInDeck: 170,
    },
    {
      StableUid: 'js-default-parameters',
      Question: 'How do default function parameters work in JavaScript?',
      Explanation:
        'You can assign default values to parameters directly in the function signature. If the caller passes undefined or omits the argument, the default value is used.',
      CodeSnippet: `function greet(name = 'stranger') {
  return \`Hello, \${name}!\`;
}

greet();          // "Hello, stranger!"
greet('Alice');   // "Hello, Alice!"`,
      CodeLanguage: 'js',
      Difficulty: 1,
      OrderInDeck: 180,
    },
    {
      StableUid: 'js-es-modules-import-export',
      Question: 'How do ES modules work with import and export?',
      Explanation:
        'ES modules use export to expose values and import to consume them. There are named exports and default exports. Bundlers and modern browsers support ES modules natively.',
      CodeSnippet: `// math.js
export function add(a, b) {
  return a + b;
}
export default function multiply(a, b) {
  return a * b;
}

// usage
import multiply, { add } from './math.js';`,
      CodeLanguage: 'js',
      Difficulty: 2,
      OrderInDeck: 190,
    },
    {
      StableUid: 'js-strict-mode',
      Question: 'What is "use strict" and what does it do?',
      Explanation:
        'Strict mode opts into a restricted variant of JavaScript: it disallows some silent errors, forbids certain syntax, and changes how this behaves in functions. It helps catch bugs earlier.',
      CodeSnippet: `'use strict';

function demo() {
  // x = 10; // ReferenceError in strict mode (must declare)
}`,
      CodeLanguage: 'js',
      Difficulty: 2,
      OrderInDeck: 200,
    },
    {
      StableUid: 'js-null-vs-undefined',
      Question: 'What is the difference between null and undefined?',
      Explanation:
        'undefined usually means “not assigned” or “missing” (e.g. uninitialized variables, missing function arguments). null is an explicit “no value” you assign intentionally. Both are falsy, but semantically different.',
      CodeSnippet: `let a;
console.log(a);      // undefined

let b = null;
console.log(b);      // null`,
      CodeLanguage: 'js',
      Difficulty: 1,
      OrderInDeck: 210,
    },
    {
      StableUid: 'js-typeof-pitfalls',
      Question: 'What are some pitfalls of using typeof in JavaScript?',
      Explanation:
        'typeof null returns "object" (a long‑standing bug). typeof for arrays also returns "object". You usually need Array.isArray or other checks for more precise type detection.',
      CodeSnippet: `console.log(typeof null);   // "object" (historical quirk)
console.log(typeof []);     // "object"
console.log(Array.isArray([])); // true`,
      CodeLanguage: 'js',
      Difficulty: 2,
      OrderInDeck: 220,
    },
    {
      StableUid: 'js-reference-equality-objects',
      Question: 'How does equality work for objects and arrays?',
      Explanation:
        'For non‑primitive values (objects, arrays, functions), == and === compare references, not structure. Two different objects with the same shape are not equal.',
      CodeSnippet: `const a = { x: 1 };
const b = { x: 1 };
const c = a;

console.log(a === b); // false
console.log(a === c); // true`,
      CodeLanguage: 'js',
      Difficulty: 1,
      OrderInDeck: 230,
    },
    {
      StableUid: 'js-shallow-vs-deep-copy',
      Question: 'What is the difference between a shallow copy and a deep copy?',
      Explanation:
        'A shallow copy copies only the top-level references; nested objects are still shared. A deep copy recursively copies nested objects so the new structure is fully independent.',
      CodeSnippet: `const original = { user: { name: 'Alice' } };
const shallow = { ...original };
shallow.user.name = 'Bob';

console.log(original.user.name); // "Bob" (shared nested object)`,
      CodeLanguage: 'js',
      Difficulty: 2,
      OrderInDeck: 240,
    },
    {
      StableUid: 'js-json-stringify-parse',
      Question: 'What do JSON.stringify and JSON.parse do?',
      Explanation:
        'JSON.stringify serializes a JavaScript value to a JSON string (if possible). JSON.parse parses a JSON string back into a JavaScript value. They are often used for simple deep copies or localStorage.',
      CodeSnippet: `const user = { name: 'Alice', age: 25 };
const json = JSON.stringify(user);
const parsed = JSON.parse(json);`,
      CodeLanguage: 'js',
      Difficulty: 1,
      OrderInDeck: 250,
    },
    {
      StableUid: 'js-for-of-vs-for-in',
      Question: 'What is the difference between for...of and for...in?',
      Explanation:
        'for...in iterates over enumerable property keys of an object (including inherited ones). for...of iterates over values of an iterable (like arrays, strings, Maps). For arrays you usually want for...of.',
      CodeSnippet: `const arr = ['a', 'b'];

for (const index in arr) {
  console.log(index); // "0", "1"
}

for (const value of arr) {
  console.log(value); // "a", "b"
}`,
      CodeLanguage: 'js',
      Difficulty: 2,
      OrderInDeck: 260,
    },
    {
      StableUid: 'js-promise-basics-states',
      Question: 'What are the possible states of a Promise?',
      Explanation:
        'A Promise starts as pending, then either becomes fulfilled (resolved successfully) or rejected (failed). Once settled (fulfilled or rejected), it stays in that state.',
      CodeSnippet: `const p = new Promise((resolve, reject) => {
  setTimeout(() => resolve(42), 1000);
});

p.then(value => console.log(value));`,
      CodeLanguage: 'js',
      Difficulty: 2,
      OrderInDeck: 270,
    },
    {
      StableUid: 'js-async-await-basics',
      Question: 'How do async and await work together?',
      Explanation:
        'An async function always returns a Promise. Inside it, await pauses the function until a Promise settles and returns its value (or throws if rejected). It makes asynchronous code look synchronous.',
      CodeSnippet: `async function fetchData() {
  try {
    const response = await fetch('/api/data');
    const json = await response.json();
    console.log(json);
  } catch (err) {
    console.error('Failed:', err);
  }
}`,
      CodeLanguage: 'js',
      Difficulty: 2,
      OrderInDeck: 280,
    },
    {
      StableUid: 'js-async-error-handling',
      Question: 'How do you handle errors with async/await?',
      Explanation:
        'Wrap your awaited calls in try/catch blocks. If the awaited Promise rejects, the error is thrown and caught in the catch block, similar to synchronous code.',
      CodeSnippet: `async function loadUser() {
  try {
    const res = await fetch('/api/user');
    if (!res.ok) {
      throw new Error('Request failed');
    }
    const user = await res.json();
    return user;
  } catch (error) {
    console.error('Error loading user:', error);
    throw error;
  }
}`,
      CodeLanguage: 'js',
      Difficulty: 2,
      OrderInDeck: 290,
    },
    {
      StableUid: 'js-custom-error-class',
      Question: 'How can you define and use a custom error type in JavaScript?',
      Explanation:
        'You can extend the built-in Error class to create domain-specific error types. This helps distinguish different error categories and improves debugging.',
      CodeSnippet: `class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

function assertName(name) {
  if (!name) throw new ValidationError('Name is required');
}`,
      CodeLanguage: 'js',
      Difficulty: 3,
      OrderInDeck: 300,
    },
    {
      StableUid: 'js-higher-order-functions',
      Question: 'What is a higher-order function?',
      Explanation:
        'A higher-order function is a function that takes another function as an argument, returns a function, or both. Array methods like map and filter are common examples.',
      CodeSnippet: `function withLogging(fn) {
  return (...args) => {
    console.log('Calling with', args);
    return fn(...args);
  };
}

const add = (a, b) => a + b;
const loggedAdd = withLogging(add);`,
      CodeLanguage: 'js',
      Difficulty: 2,
      OrderInDeck: 310,
    },
    {
      StableUid: 'js-callback-hell-and-promises',
      Question: 'What is “callback hell” and how can you avoid it?',
      Explanation:
        'Callback hell happens when you nest many callbacks deeply, making code hard to read and maintain. You can avoid it by using Promises, async/await, or by breaking code into smaller functions.',
      CodeSnippet: `// Callback hell (example)
doA(resultA => {
  doB(resultA, resultB => {
    doC(resultB, resultC => {
      // ...
    });
  });
});

// Using Promises / async-await is much cleaner`,
      CodeLanguage: 'js',
      Difficulty: 2,
      OrderInDeck: 320,
    },
    {
      StableUid: 'js-debounce',
      Question: 'What is debouncing and when would you use it?',
      Explanation:
        'Debouncing delays a function call until a certain amount of time has passed without it being called again. It is often used for search input or resize events to reduce the number of calls.',
      CodeSnippet: `function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}`,
      CodeLanguage: 'js',
      Difficulty: 3,
      OrderInDeck: 330,
    },
    {
      StableUid: 'js-throttle',
      Question: 'What is throttling and how is it different from debouncing?',
      Explanation:
        'Throttling ensures a function is called at most once in a fixed time window. Debouncing waits until the calls stop; throttling spreads them out. Throttling is useful for scroll or mousemove handlers.',
      CodeSnippet: `function throttle(fn, interval) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last >= interval) {
      last = now;
      fn(...args);
    }
  };
}`,
      CodeLanguage: 'js',
      Difficulty: 3,
      OrderInDeck: 340,
    },
    {
      StableUid: 'js-set-vs-array',
      Question: 'When would you use a Set instead of an Array?',
      Explanation:
        'Use Set when you need a collection of unique values and fast membership checks. Unlike arrays, Sets automatically ignore duplicate additions.',
      CodeSnippet: `const ids = new Set([1, 2, 2, 3]);
console.log(ids.has(2)); // true
console.log(ids.size);   // 3`,
      CodeLanguage: 'js',
      Difficulty: 2,
      OrderInDeck: 350,
    },
    {
      StableUid: 'js-map-vs-object',
      Question: 'What are advantages of Map over plain objects?',
      Explanation:
        'Maps can use any value (including objects) as keys, remember insertion order, and have a size property. Plain objects are limited to string/symbol keys and inherit from Object.prototype unless created carefully.',
      CodeSnippet: `const m = new Map();
const objKey = { id: 1 };
m.set(objKey, 'value');
console.log(m.get(objKey)); // 'value'`,
      CodeLanguage: 'js',
      Difficulty: 2,
      OrderInDeck: 360,
    },
    {
      StableUid: 'js-event-bubbling-capturing',
      Question: 'What are event bubbling and capturing in the browser event model?',
      Explanation:
        'Capturing is the phase where the event travels from the root down to the target. Bubbling is when it travels from the target back up. By default most listeners use bubbling, but you can opt into capturing.',
      CodeSnippet: `element.addEventListener('click', handler, { capture: true }); // capturing
element.addEventListener('click', handler); // bubbling (default)`,
      CodeLanguage: 'js',
      Difficulty: 2,
      OrderInDeck: 370,
    },
    {
      StableUid: 'js-optional-chaining',
      Question: 'What does the optional chaining operator ?. do?',
      Explanation:
        'Optional chaining lets you safely access nested properties. If a part is null or undefined, the whole expression short-circuits to undefined instead of throwing.',
      CodeSnippet: `const user = { profile: { email: 'a@example.com' } };

console.log(user.profile?.email); // 'a@example.com'
console.log(user.address?.city);  // undefined (no error)`,
      CodeLanguage: 'js',
      Difficulty: 1,
      OrderInDeck: 380,
    },
    {
      StableUid: 'js-nullish-coalescing',
      Question: 'How is the nullish coalescing operator ?? different from ||?',
      Explanation:
        'a ?? b returns b only when a is null or undefined. a || b treats many more values as “falsy” (0, "", NaN, etc.). Use ?? when 0 or "" are valid values and should not trigger the fallback.',
      CodeSnippet: `const count = 0;

console.log(count || 10); // 10 (0 is falsy)
console.log(count ?? 10); // 0  (only null/undefined trigger fallback)`,
      CodeLanguage: 'js',
      Difficulty: 2,
      OrderInDeck: 390,
    },
    {
      StableUid: 'js-short-circuit-and-or',
      Question: 'How do logical && and || support short-circuit patterns?',
      Explanation:
        'a && b returns a if a is falsy, otherwise b. a || b returns a if a is truthy, otherwise b. This allows patterns like condition && doSomething() or value || defaultValue.',
      CodeSnippet: `isLoggedIn && showDashboard();
const result = userInput || 'default';`,
      CodeLanguage: 'js',
      Difficulty: 1,
      OrderInDeck: 400,
    },
    {
      StableUid: 'js-bigint-basics',
      Question: 'What is BigInt and when would you use it?',
      Explanation:
        'BigInt is a built-in type for integers that are too large for Number (which is limited to 2^53 - 1 safely). You create BigInts with an n suffix or BigInt().',
      CodeSnippet: `const big = 9007199254740993n; // larger than Number.MAX_SAFE_INTEGER
console.log(big + 2n);`,
      CodeLanguage: 'js',
      Difficulty: 2,
      OrderInDeck: 410,
    },
    {
      StableUid: 'js-symbol-basics',
      Question: 'What is a Symbol in JavaScript?',
      Explanation:
        'Symbol is a primitive type whose values are unique and immutable. Symbols are often used as non-colliding property keys on objects.',
      CodeSnippet: `const id = Symbol('id');

const user = {
  [id]: 123,
  name: 'Alice',
};

console.log(user[id]);`,
      CodeLanguage: 'js',
      Difficulty: 3,
      OrderInDeck: 420,
    },
    {
      StableUid: 'js-object-freeze-vs-seal',
      Question: 'What is the difference between Object.freeze and Object.seal?',
      Explanation:
        'Object.seal prevents adding or removing properties but allows changing existing values. Object.freeze makes an object immutable: you cannot add, remove, or change properties (at the top level).',
      CodeSnippet: `const obj = { x: 1 };

Object.freeze(obj);
// obj.x = 2; // silently fails or throws in strict mode`,
      CodeLanguage: 'js',
      Difficulty: 3,
      OrderInDeck: 430,
    },
    {
      StableUid: 'js-array-sort-comparator',
      Question: 'How does Array.prototype.sort work with a comparator function?',
      Explanation:
        'sort converts elements to strings by default, which can produce unexpected results for numbers. Providing a comparator function (a, b) that returns a negative, zero, or positive value gives full control over ordering.',
      CodeSnippet: `const nums = [10, 2, 5];
nums.sort();              // ['10', '2', '5'] (string comparison)
nums.sort((a, b) => a - b); // [2, 5, 10] (numeric)`,
      CodeLanguage: 'js',
      Difficulty: 2,
      OrderInDeck: 440,
    },
    {
      StableUid: 'js-number-parsing',
      Question: 'What is the difference between Number(), parseInt, and parseFloat?',
      Explanation:
        'Number() converts the whole value to a number and fails to NaN if the string has extra characters. parseInt and parseFloat parse from the start of the string and stop when they hit an invalid character.',
      CodeSnippet: `Number('42');      // 42
Number('42px');   // NaN

parseInt('42px', 10);  // 42
parseFloat('3.14abc'); // 3.14`,
      CodeLanguage: 'js',
      Difficulty: 2,
      OrderInDeck: 450,
    },
    {
      StableUid: 'js-floating-point-precision',
      Question: 'Why does 0.1 + 0.2 not equal 0.3 in JavaScript?',
      Explanation:
        'JavaScript numbers are IEEE 754 double-precision floats. Some decimals cannot be represented exactly in binary, leading to rounding errors like 0.1 + 0.2 ≠ 0.3 exactly.',
      CodeSnippet: `console.log(0.1 + 0.2);        // 0.30000000000000004
console.log((0.1 + 0.2).toFixed(2)); // "0.30"`,
      CodeLanguage: 'js',
      Difficulty: 2,
      OrderInDeck: 460,
    },
    {
      StableUid: 'js-date-basics',
      Question: 'How do you create a Date representing the current time and a specific ISO string?',
      Explanation:
        'new Date() with no arguments creates a Date for “now”. Passing an ISO 8601 string (or timestamp) creates a Date for that moment. Always be careful with time zones.',
      CodeSnippet: `const now = new Date();
const fromIso = new Date('2025-01-01T12:00:00Z');`,
      CodeLanguage: 'js',
      Difficulty: 1,
      OrderInDeck: 470,
    },
    {
      StableUid: 'js-localstorage-vs-sessionstorage',
      Question: 'What is the difference between localStorage and sessionStorage?',
      Explanation:
        'Both store key–value pairs as strings in the browser. localStorage persists across browser sessions; sessionStorage is cleared when the tab is closed.',
      CodeSnippet: `localStorage.setItem('token', 'abc');
sessionStorage.setItem('step', '1');`,
      CodeLanguage: 'js',
      Difficulty: 1,
      OrderInDeck: 480,
    },
    {
      StableUid: 'js-class-syntax-basics',
      Question: 'How do you define a basic class in modern JavaScript?',
      Explanation:
        'You can use the class keyword with a constructor and methods. Under the hood, it is syntactic sugar over prototypes.',
      CodeSnippet: `class Person {
  constructor(name) {
    this.name = name;
  }
  greet() {
    return \`Hello, \${this.name}\`;
  }
}

const p = new Person('Alice');`,
      CodeLanguage: 'js',
      Difficulty: 2,
      OrderInDeck: 490,
    },
    {
      StableUid: 'js-class-inheritance-super',
      Question: 'How do you extend a class and call super in JavaScript?',
      Explanation:
        'Use extends to create a subclass. In the subclass constructor you must call super(...) before using this; to call the parent constructor and set up the instance.',
      CodeSnippet: `class Animal {
  constructor(name) {
    this.name = name;
  }
  speak() {
    console.log(\`\${this.name} makes a noise.\`);
  }
}

class Dog extends Animal {
  speak() {
    console.log(\`\${this.name} barks.\`);
  }
}

new Dog('Rex').speak(); // "Rex barks."`,
      CodeLanguage: 'js',
      Difficulty: 2,
      OrderInDeck: 500,
    },
  ],
};