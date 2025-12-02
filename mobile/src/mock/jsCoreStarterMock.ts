// mobile/src/mock/jsCoreStarterMock.ts

import type { DeckExport } from '../types/deckExport';

/**
 * 按照后端导出的格式（PascalCase）写的 mock Deck。
 * 方便 RN 端直接对齐真实导出结构。
 */
export const jsCoreStarterMock: DeckExport = {
  Slug: 'js-core-starter',
  Title: 'JavaScript Core Basics (Starter)',
  Locale: 'en-US',
  Version: 'v1',
  DeckType: 1,
  IsFreeStarter: true,
  TotalCards: 5,
  FreeCardCount: 5,
  Cards: [
    {
      StableUid: 'js-basics-var-let-const',
      Question: 'What is the difference between var, let, and const in JavaScript?',
      Explanation:
        'var 是函数作用域，可以重复声明；let / const 是块级作用域。let 允许重新赋值，const 不允许。现代代码通常优先用 const，需要重新赋值时用 let。',
      CodeSnippet:
        'function demo() {\n' +
        '  if (true) {\n' +
        '    var x = 1;\n' +
        '    let y = 2;\n' +
        '    const z = 3;\n' +
        '  }\n' +
        '\n' +
        '  console.log(x); // 1 (function-scoped)\n' +
        '  // console.log(y); // ReferenceError\n' +
        '  // console.log(z); // ReferenceError\n' +
        '}',
      CodeLanguage: 'js',
      Difficulty: 1,
      OrderInDeck: 10,
    },
    {
      StableUid: 'js-basics-closure',
      Question: 'What is a closure in JavaScript?',
      Explanation:
        '闭包是“函数 + 它的词法环境”的组合。内部函数可以访问外部函数里的变量，即使外部函数已经返回。',
      CodeSnippet:
        'function makeCounter() {\n' +
        '  let count = 0;\n' +
        '  return function () {\n' +
        '    count++;\n' +
        '    return count;\n' +
        '  };\n' +
        '}\n' +
        '\n' +
        'const counter = makeCounter();\n' +
        'console.log(counter()); // 1\n' +
        'console.log(counter()); // 2',
      CodeLanguage: 'js',
      Difficulty: 2,
      OrderInDeck: 20,
    },
    {
      StableUid: 'ts-basics-interface-vs-type',
      Question: 'What is the difference between interface and type in TypeScript?',
      Explanation:
        'interface 更偏向描述对象形状，支持声明合并；type 是类型别名，可以表示联合、交叉、条件类型等。很多场景可以互换，由团队约定为主。',
      CodeSnippet:
        'interface User {\n' +
        '  id: number;\n' +
        '  name: string;\n' +
        '}\n' +
        '\n' +
        'type Admin = User & {\n' +
        "  role: 'admin';\n" +
        '};\n' +
        '\n' +
        'const alice: Admin = {\n' +
        '  id: 1,\n' +
        "  name: 'Alice',\n" +
        "  role: 'admin',\n" +
        '};',
      CodeLanguage: 'ts',
      Difficulty: 2,
      OrderInDeck: 30,
    },
    {
      StableUid: 'cs-basics-class-vs-record',
      Question: 'What is the difference between class and record in C#?',
      Explanation:
        'record 更适合表达不变的值对象，默认是基于内容的相等比较；class 默认是引用相等。record 常用于 DTO / 值对象。',
      CodeSnippet:
        'public class PersonClass\n' +
        '{\n' +
        '    public string Name { get; init; } = "";\n' +
        '}\n' +
        '\n' +
        'public record PersonRecord(string Name);\n' +
        '\n' +
        'var c1 = new PersonClass { Name = "Alice" };\n' +
        'var c2 = new PersonClass { Name = "Alice" };\n' +
        '\n' +
        'var r1 = new PersonRecord("Alice");\n' +
        'var r2 = new PersonRecord("Alice");\n' +
        '\n' +
        'Console.WriteLine(c1 == c2); // False (reference equality)\n' +
        'Console.WriteLine(r1 == r2); // True  (value equality)',
      CodeLanguage: 'cs',
      Difficulty: 2,
      OrderInDeck: 40,
    },
    {
      StableUid: 'sql-last-7-days',
      Question: 'How do you select all users created in the last 7 days using PostgreSQL?',
      Explanation:
        "使用 NOW() 减去 interval '7 days'，然后比较 created_at 字段即可。",
      CodeSnippet:
        "SELECT id, email, created_at\n" +
        'FROM users\n' +
        "WHERE created_at >= NOW() - INTERVAL '7 days'\n" +
        'ORDER BY created_at DESC;',
      CodeLanguage: 'sql',
      Difficulty: 1,
      OrderInDeck: 50,
    },
  ],
};