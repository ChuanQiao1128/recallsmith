// The only module that reaches into the console's source tree. scripts/build.mjs
// bundles this file on its own into dist/deckLib.js, so the server runs the very
// importer rules the console runs without needing frontend/node_modules.

export { parseDeckMarkdown, serializeDeckMarkdown } from '../../../frontend/src/lib/deckImport';
export type { DeckCardContent, ImportIssue, ParsedDeck } from '../../../frontend/src/lib/deckImport';
export {
  SOURCE_URL_PATTERN,
  SOURCE_URL_MAX_LENGTH,
  SOURCE_QUOTE_MAX_LENGTH,
  isValidSourceUrl,
} from '../../../frontend/src/lib/sourceRules';
