// src/lib/highlightSnippet.ts
//
// highlight.js setup and a pure snippet highlighter, lifted out of CardForm so
// the component file can keep exporting only the component and its types
// (react-refresh/only-export-components is an error here). CardForm is the only
// module that imports this one, which keeps highlight.js in the lazy CardForm
// chunk (tests/bundleFirstLoad.test.ts). The atom-one-dark.css theme import
// stays in CardForm.

import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import csharp from 'highlight.js/lib/languages/csharp';
import sql from 'highlight.js/lib/languages/sql';
import bash from 'highlight.js/lib/languages/bash';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('cs', csharp);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('bash', bash);

/** The select's short codes to highlight.js grammar names; null when unset. */
export function mapToHlLanguage(codeLang: string): string | null {
  if (!codeLang) return null;
  switch (codeLang) {
    case 'js':
      return 'javascript';
    case 'ts':
      return 'typescript';
    case 'cs':
      return 'csharp';
    default:
      return codeLang;
  }
}

/** Escape the three characters that would otherwise open markup, like today. */
export function escapeHtml(code: string): string {
  return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Turn a snippet into the HTML the preview renders.
 *
 * An empty snippet shows the placeholder comment. A chosen language highlights,
 * falling back to escaped plain text if highlight.js throws. No language means
 * escaped plain text and nothing more — deliberately no auto-detection, which
 * used to run every registered grammar on each keystroke.
 */
export function highlightSnippet(code: string, language: string | null): string {
  if (!code) {
    return hljs.highlight('// No code snippet.', { language: 'javascript' }).value;
  }

  if (language) {
    try {
      return hljs.highlight(code, { language }).value;
    } catch {
      return escapeHtml(code);
    }
  }

  return escapeHtml(code);
}
