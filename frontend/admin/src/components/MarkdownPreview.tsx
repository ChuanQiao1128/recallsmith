// src/components/MarkdownPreview.tsx
import React from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Paper, Stack, Title, Text, useComputedColorScheme } from '@mantine/core';

// ✅ 使用 PrismLight（轻量版），才支持 registerLanguage
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight, vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

// 按需注册 Prism 语言（轻量版必须自己注册）
import jsLang from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import tsLang from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import tsxLang from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import jsxLang from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import bashLang from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import yamlLang from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import csharpLang from 'react-syntax-highlighter/dist/esm/languages/prism/csharp';

// 轻量版：必须手动注册所有要用的语言别名
SyntaxHighlighter.registerLanguage('javascript', jsLang);
SyntaxHighlighter.registerLanguage('js', jsLang);
SyntaxHighlighter.registerLanguage('typescript', tsLang);
SyntaxHighlighter.registerLanguage('ts', tsLang);
SyntaxHighlighter.registerLanguage('tsx', tsxLang);
SyntaxHighlighter.registerLanguage('jsx', jsxLang);
SyntaxHighlighter.registerLanguage('bash', bashLang);
SyntaxHighlighter.registerLanguage('shell', bashLang);
SyntaxHighlighter.registerLanguage('yaml', yamlLang);
SyntaxHighlighter.registerLanguage('yml', yamlLang);
SyntaxHighlighter.registerLanguage('csharp', csharpLang);
SyntaxHighlighter.registerLanguage('cs', csharpLang);

// ---- 语言别名归一化，保证 js/ts/csharp 等都正常高亮 ----
const langAlias: Record<string, string> = {
  js: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  sh: 'bash',
  shell: 'bash',
  yml: 'yaml',
  dotnet: 'csharp',
  cs: 'csharp',
  csharp: 'csharp',
};

function normalizeLanguage(raw?: string) {
  if (!raw) return 'text';
  const l = raw.toLowerCase();
  return langAlias[l] ?? l;
}

// ---- 从 Markdown 中提取所有 ```fenced``` 代码块，并返回去掉代码块的文本 ----
function extractCodeBlocks(md: string) {
  const codeBlocks: { lang?: string; code: string }[] = [];
  const re = /```([\w+-]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  let explanation = '';
  let lastIndex = 0;

  while ((match = re.exec(md)) !== null) {
    const [whole, lang, code] = match;
    explanation += md.slice(lastIndex, match.index);
    codeBlocks.push({ lang: lang || 'text', code: code.replace(/\n$/, '') });
    lastIndex = match.index + whole.length;
  }
  explanation += md.slice(lastIndex);

  return { explanationMd: explanation.trim(), codeBlocks };
}

type MarkdownPreviewProps = {
  value: string;
  /** Back 预览时传 true：上面解释、下面代码 */
  splitCode?: boolean;
  /** 包一层 Paper 的可选标题 */
  title?: string;
};

export default function MarkdownPreview({ value, splitCode, title }: MarkdownPreviewProps) {
  // 根据主题选择高亮配色
  const scheme = useComputedColorScheme('light', { getInitialValueInEffect: true });
  const prismTheme = scheme === 'dark' ? vscDarkPlus : oneLight;

  // ReactMarkdown 的 code 渲染器
  // 用 any 避免 ReactMarkdown 的 CodeProps 与 HTML props 交叉导致的 TS 报错
  const components: Components = {
    code({ inline, className, children, ...props }: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { inline?: boolean }) {
      const raw = String(children ?? '');
      const lang = normalizeLanguage((className || '').replace('language-', ''));

      if (inline) {
        return <code className={className} {...props}>{raw}</code>;
      }

      return (
        <SyntaxHighlighter
          language={lang}
          style={prismTheme}
          PreTag="div"
          customStyle={{ margin: '8px 0', borderRadius: 8, fontSize: 14, lineHeight: 1.55 }}
        >
          {raw}
        </SyntaxHighlighter>
      );
    },
  };

  if (!splitCode) {
    // 常规：整篇 Markdown，代码块用 Prism 彩色高亮
    return (
      <Paper withBorder p="md">
        {title && <Title order={6} mb="xs">{title}</Title>}
        <div className="mdx">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
            components={components}
          >
            {value || '*No content*'}
          </ReactMarkdown>
        </div>
      </Paper>
    );
  }

  // Back 分屏：解释（去掉代码块） + 代码块列表（逐个高亮）
  const { explanationMd, codeBlocks } = extractCodeBlocks(value || '');

  return (
    <Stack gap="md">
      <Paper withBorder p="md">
        <Title order={6} mb="xs">{title ?? 'Explanation'}</Title>
        <div className="mdx">
          {explanationMd ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              components={components}
            >
              {explanationMd}
            </ReactMarkdown>
          ) : (
            <Text c="dimmed">No explanation text.</Text>
          )}
        </div>
      </Paper>

      <Paper withBorder p="md">
        <Title order={6} mb="xs">Code</Title>
        {codeBlocks.length === 0 ? (
          <Text c="dimmed">No code blocks.</Text>
        ) : (
          <Stack gap="sm">
            {codeBlocks.map((b, i) => (
              <SyntaxHighlighter
                key={i}
                language={normalizeLanguage(b.lang)}
                style={prismTheme}
                PreTag="div"
                customStyle={{ margin: 0, borderRadius: 8, fontSize: 14, lineHeight: 1.55 }}
              >
                {b.code}
              </SyntaxHighlighter>
            ))}
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}