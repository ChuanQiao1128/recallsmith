import React, { useMemo } from 'react';
import { ScrollView, Text, View, StyleSheet, Platform } from 'react-native';

type TokenType = 'keyword' | 'string' | 'number' | 'comment' | 'plain' | 'operator';

type Token = {
  type: TokenType;
  text: string;
};

const KEYWORDS = new Set([
  'const',
  'let',
  'var',
  'function',
  'return',
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'break',
  'continue',
  'import',
  'from',
  'export',
  'default',
  'class',
  'extends',
  'new',
  'try',
  'catch',
  'finally',
  'throw',
  'async',
  'await',
  'interface',
  'type',
  'implements',
  'public',
  'private',
  'protected',
  'readonly',
  'static',
  'true',
  'false',
  'null',
  'undefined',
]);

function tokenizeLine(code: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < code.length) {
    const ch = code[i];
    const next = code[i + 1];

    // 行注释 //
    if (ch === '/' && next === '/') {
      let start = i;
      i += 2;
      while (i < code.length && code[i] !== '\n') i++;
      tokens.push({ type: 'comment', text: code.slice(start, i) });
      continue;
    }

    // 块注释 /* */ （这里只按单行处理，足够应付大多数情况）
    if (ch === '/' && next === '*') {
      let start = i;
      i += 2;
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i++;
      if (i < code.length) i += 2;
      tokens.push({ type: 'comment', text: code.slice(start, i) });
      continue;
    }

    // 字符串 ' " `
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      let start = i;
      i++;
      while (i < code.length) {
        if (code[i] === '\\') {
          i += 2; // 跳过转义
          continue;
        }
        if (code[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      tokens.push({ type: 'string', text: code.slice(start, i) });
      continue;
    }

    // 空白
    if (/\s/.test(ch)) {
      let start = i;
      while (i < code.length && /\s/.test(code[i])) i++;
      tokens.push({ type: 'plain', text: code.slice(start, i) });
      continue;
    }

    // 数字
    if (/[0-9]/.test(ch)) {
      let start = i;
      while (i < code.length && /[0-9._]/.test(code[i])) i++;
      tokens.push({ type: 'number', text: code.slice(start, i) });
      continue;
    }

    // 标识符 / 关键字
    if (/[a-zA-Z_$]/.test(ch)) {
      let start = i;
      while (i < code.length && /[a-zA-Z0-9_$]/.test(code[i])) i++;
      const word = code.slice(start, i);
      if (KEYWORDS.has(word)) {
        tokens.push({ type: 'keyword', text: word });
      } else {
        tokens.push({ type: 'plain', text: word });
      }
      continue;
    }

    // 其它符号当成 operator
    tokens.push({ type: 'operator', text: ch });
    i++;
  }

  return tokens;
}

interface CodeBlockProps {
  code: string;
  language?: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ code }) => {
  const lines = useMemo(() => code.split('\n'), [code]);

  return (
    <View style={styles.outer}>
      <ScrollView horizontal bounces={false}>
        <View style={styles.inner}>
          {lines.map((line, lineIndex) => {
            const tokens = tokenizeLine(line);
            return (
              <View key={lineIndex} style={styles.line}>
                {/* 行号区域，模拟 VS Code 左侧 gutter */}
                <Text style={styles.lineNumber}>
                  {lineIndex + 1}
                </Text>

                {/* 代码本体 */}
                <Text style={styles.code}>
                  {tokens.map((token, tokenIndex) => (
                    <Text
                      key={tokenIndex}
                      // 如果 TS 报类型，可以写成 (styles as any)[token.type]
                      style={styles[token.type]}
                    >
                      {token.text}
                    </Text>
                  ))}
                </Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  // 外层容器：深色背景 + 左侧高亮边框，比较接近 VS Code Dark+
  outer: {
    backgroundColor: '#1e1e1e',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 0,
    marginVertical: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#007acc', // VS Code 蓝
  },
  // 内部垂直堆叠所有行
  inner: {
    flexDirection: 'column',
    paddingRight: 12,
  },
  // 每一行：左侧行号 + 右侧代码
  line: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  lineNumber: {
    width: 36,
    textAlign: 'right',
    paddingRight: 8,
    color: '#858585',
    opacity: 0.8,
    fontSize: 12,
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },
  code: {
    flexShrink: 1,
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
    fontSize: 13,
    color: '#d4d4d4',
  },
  // token 颜色，基本照 VS Code Dark+ 配色
  keyword: {
    color: '#569cd6',
  },
  string: {
    color: '#ce9178',
  },
  number: {
    color: '#b5cea8',
  },
  comment: {
    color: '#6a9955',
    fontStyle: 'italic',
  },
  operator: {
    color: '#d4d4d4',
  },
  plain: {
    color: '#d4d4d4',
  },
});

export default CodeBlock;