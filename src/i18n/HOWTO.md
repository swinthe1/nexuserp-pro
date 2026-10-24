# Translating the app

Shqip (sq) is the default language; English (en) is the second one. The English text in the code is the key, and the Albanian dictionary lives in `src/i18n/sq/dict/*.ts` (one file per area, merged automatically). Missing Albanian falls back to the English text, so nothing breaks — but `npm run i18n:check` must stay at zero.

## Which helper

| What you show | How |
|---|---|
| Fixed UI text | `t('Save changes')`, `t('{n} items selected', { n })` |
| Text that depends on a count | `tn(count, '{n} line', '{n} lines')` |
| Same English word, different meaning | add a context: `t('Open|status')` (English shows "Open") |
| Text with links or bold parts | `tr('Read the {guide} first', { guide: <Link …>{t('guide')}</Link> })` |
| Text in module-level constants (nav items, catalogs, option lists, column arrays) | wrap with `msg('…')` where it is defined, call `t(item.label)` where it is rendered. Never call `t()` at module level — it would freeze the language at load time. |
| Database enum values (status, kinds, methods) | `humanize(value)` / `tEnum(value)` / `<StatusBadge>`; add `'enum:<value>'` keys |
| Names that may be system defaults created by the database (chart of accounts, journals, tax codes, units, default warehouse and locations, payment terms, pipeline stages, leave types, roles, permissions, document types, approval document types, notification categories) | `td(row.name)` — a default name is translated, a name the company typed stays as typed |
| Text written by the database (error messages, notification titles and bodies, report column and grouping labels, tax calendar items, any label returned by an RPC) | `tServer(text)`; `describeError(err)` already does it for errors |
| Dates, months, money, quantities | `formatDate`, `formatMonth`, `formatMoney`, `formatQty`, `intlLocale()` — never a hard-coded `'en-GB'` |
| Zod messages in schemas | plain English string; `FormMessage` translates it. If you show a schema error yourself, wrap it in `t()`. Built-in Zod messages are translated by `src/i18n/zod.ts`. |

Changing the language re-mounts the app below the providers, so `t()` calls in render code (including `useMemo` column definitions) are always current.

## Writing the text

* Plain words for cashiers, warehouse staff, sales reps and managers. No database or developer words (no "RPC", "row", "record ID", "GL" — say "accounting"/"kontabiliteti", "entry"/"regjistrim").
* Buttons are verbs that say what happens ("Ruaj faturën", "Dërgo për miratim"); the toast repeats the same verb ("Fatura u ruajt").
* Sentence case. Short descriptions under page titles: one sentence.
* Albanian follows `GLOSSARY.md`. Use the definite form for labels and column headers (Klienti, Data, Shuma).
* Keep `{placeholders}` identical in both languages; the checker verifies it.

## Checking

```
npm run i18n:check                     # summary; non-zero exit when something is untranslated
node scripts/i18n-check.mjs -v src/features/hr   # details with line numbers
```
Add `// i18n-ignore` at the end of a line that really must stay as is (a brand name, a code sample).
