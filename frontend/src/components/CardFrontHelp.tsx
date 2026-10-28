import { parseFrontHelp } from '../lib/frontHelp';

export function CardFrontHelp({ help, lang = 'en' }: { help: unknown; lang?: 'en' | 'zh-CN' }) {
  const entries = parseFrontHelp(help);
  if (!entries?.length) return null;
  return (
    <details className="mt-3 text-sm text-slate-700" lang={lang}>
      <summary className="cursor-pointer py-2 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-700">
        {lang === 'zh-CN' ? '\u8bcd\u8bed\u5e2e\u52a9' : 'Word help'}
      </summary>
      <dl className="space-y-2 break-words">
        {entries.map(({ term, definition }) => (
          <div key={term}><dt className="font-medium">{term}</dt><dd className="whitespace-pre-wrap">{definition}</dd></div>
        ))}
      </dl>
    </details>
  );
}
