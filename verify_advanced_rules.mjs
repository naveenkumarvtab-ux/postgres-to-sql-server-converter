import { applySqlConversionRules, translateObject, translatePgCron } from './src/utils/translator.js';
import { classifyStatement } from './src/utils/parser.js';
import { validateMigration } from './src/utils/validator.js';

console.log('Testing Advanced SQL Conversion Rules & Features...');

let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✅ [PASS] ${message}`);
  } else {
    console.error(`❌ [FAIL] ${message}`);
    failed++;
  }
}

// 1. SELECT * Expansion Test
const tableColumns = {
  'public.orders': ['id', 'user_id', 'amount', 'created_at']
};

const expandedSql = applySqlConversionRules(
  'SELECT * FROM public.orders JOIN public.customers ON orders.cid = customers.id',
  true,
  { 'public': 'dbo' },
  tableColumns
);

assert(
  expandedSql.includes('SELECT [id], [user_id], [amount], [created_at] FROM [dbo].[orders]'),
  `SELECT * expanded using tableColumnsMap. Result: "${expandedSql}"`
);

// 2. Preserve SELECT * if metadata is unavailable
const unexpandedSql = applySqlConversionRules(
  'SELECT * FROM public.unknown_table',
  true,
  { 'public': 'dbo' },
  tableColumns
);

assert(
  unexpandedSql.includes('SELECT * FROM [dbo].[unknown_table]'),
  `SELECT * preserved when metadata is unavailable. Result: "${unexpandedSql}"`
);

// 3. Standalone SELECT statement classification and preservation
const rawSelect = 'SELECT id, user_id FROM public.orders WHERE amount > 100;';
const classifiedSelect = classifyStatement(rawSelect);
assert(
  classifiedSelect.type === 'SELECT',
  `Standalone SELECT statement classified as type 'SELECT'. Type: "${classifiedSelect.type}"`
);

const translatedSelect = translateObject(classifiedSelect, true, null, null, null, null, { 'public': 'dbo' });
assert(
  translatedSelect.tsql.trim().includes('SELECT id, user_id FROM [dbo].[orders]'),
  `Standalone SELECT translated as executable SQL, not comments. Result: "${translatedSelect.tsql}"`
);

// 4. Configurable Deployment Modes (TABLE & SEQUENCE)
const tableStmt = classifyStatement('CREATE TABLE public.orders (id INT PRIMARY KEY);');
const migrationTable = translateObject(tableStmt, true, null, null, null, null, { 'public': 'dbo' }, {}, 'migration');
assert(
  migrationTable.tsql.includes('DROP TABLE IF EXISTS [dbo].[orders]'),
  'Migration Mode generates DROP TABLE IF EXISTS statement.'
);

const deploymentTable = translateObject(tableStmt, true, null, null, null, null, { 'public': 'dbo' }, {}, 'deployment');
assert(
  deploymentTable.tsql.includes('IF NOT EXISTS (SELECT * FROM sys.objects') && !deploymentTable.tsql.includes('DROP TABLE'),
  'Deployment Mode wraps table definition in IF NOT EXISTS block.'
);

// 5. Validation Engine Checks
const mockTranslatedObjects = [
  {
    schema: 'dbo',
    name: 'orders',
    type: 'TABLE',
    tsql: 'CREATE TABLE [dbo].[orders] ( [Column1] INT, [Column2] VARCHAR(50) );',
    parsed: { columns: [{ name: 'Column1', type: 'INT' }] }
  },
  {
    schema: 'dbo',
    name: 'view_orders',
    type: 'VIEW',
    tsql: 'CREATE VIEW [dbo].[view_orders] AS SELECT * FROM [dbo].[orders] WHERE regexp_replace(name, \'x\', \'y\') = \'z\';'
  },
  {
    schema: 'dbo',
    name: 'broken_proc',
    type: 'PROCEDURE',
    tsql: 'CREATE PROCEDURE [dbo].[broken_proc] AS SELECT * FROM [dbo].[nonexistent_table];'
  }
];

const report = validateMigration(mockTranslatedObjects);

// Verify placeholder columns check
const placeholderErr = report.errors.find(e => e.description.includes("placeholder column name 'Column1'"));
assert(
  placeholderErr !== undefined,
  'Validation Engine detects leaked placeholder columns (Column1).'
);

// Verify unsupported PG function check (regexp_replace)
const regexpFix = report.manualFixes.find(f => f.description.includes("regexp_replace"));
assert(
  regexpFix !== undefined,
  "Validation Engine detects unsupported PG function 'regexp_replace'."
);

// Verify broken dependency / missing object reference warning
const brokenDep = report.warnings.find(w => w.description.includes("Broken Dependency / Missing Object"));
assert(
  brokenDep !== undefined,
  'Validation Engine flags broken dependencies (missing nonexistent_table).'
);

// 6. CONCAT_WS Translation Tests
const concatWsModern = applySqlConversionRules(
  "SELECT CONCAT_WS(', ', first_name, last_name) FROM users;",
  true,
  { 'public': 'dbo' },
  {},
  '2017+'
);
assert(
  concatWsModern.includes("CONCAT_WS(', ', first_name, last_name)"),
  `CONCAT_WS modern version (2017+) preserves CONCAT_WS syntax. Result: "${concatWsModern}"`
);

const concatWsLegacy = applySqlConversionRules(
  "SELECT CONCAT_WS(', ', first_name, last_name) FROM users;",
  true,
  { 'public': 'dbo' },
  {},
  '2016-'
);
assert(
  concatWsLegacy.includes("STUFF(COALESCE(', ' + first_name, '') + COALESCE(', ' + last_name, ''), 1, 2, '')"),
  `CONCAT_WS legacy version (2016-) simulates NULL-safe concat. Result: "${concatWsLegacy}"`
);

// 7. split_part() Translation Tests
const splitPartLiteral = applySqlConversionRules(
  "SELECT split_part(name, '-', 2) FROM users;",
  true,
  { 'public': 'dbo' }
);
assert(
  splitPartLiteral.includes("COALESCE(CAST('<x>' + REPLACE(name, '-', '</x><x>') + '</x>' AS XML).value('/x[2][1]', 'NVARCHAR(MAX)'), '')"),
  `split_part with literal index translates to XML value selection. Result: "${splitPartLiteral}"`
);

const splitPartColumn = applySqlConversionRules(
  "SELECT split_part(name, '-', field_idx) FROM users;",
  true,
  { 'public': 'dbo' }
);
assert(
  splitPartColumn.includes("COALESCE(CAST('<x>' + REPLACE(name, '-', '</x><x>') + '</x>' AS XML).value('/x[sql:column(\"field_idx\")][1]', 'NVARCHAR(MAX)'), '')"),
  `split_part with column index translates to XML sql:column selection. Result: "${splitPartColumn}"`
);

// 8. Hyphenated and multi-word names tests
const hyphenatedTable = classifyStatement('CREATE TABLE public."my-hyphenated-table" ("first name" VARCHAR(50));');
const transHyphen = translateObject(hyphenatedTable, true, null, null, null, null, { 'public': 'dbo' });
assert(
  transHyphen.tsql.includes('[dbo].[my-hyphenated-table]') && transHyphen.tsql.includes('[first name]'),
  `Hyphenated and multi-word names are properly wrapped in square brackets. Result: "${transHyphen.tsql}"`
);

// 9. pg_cron Job detection and SQL Agent conversion test
const pgCronStmt = classifyStatement("SELECT cron.schedule('nightly_clean', '0 2 * * *', 'CALL public.cleanup_logs()');");
assert(
  pgCronStmt.type === 'PG_CRON',
  `pg_cron statement successfully classified as PG_CRON. Type: "${pgCronStmt.type}"`
);

const transCron = translatePgCron(pgCronStmt.raw);
assert(
  transCron.includes("Suggested SQL Server Agent Job") && transCron.includes("job_name = N'nightly_clean'") && transCron.includes("database_name = N'current_database'"),
  `pg_cron job maps to SQL Server Agent step template. Result: "${transCron}"`
);

// 10. Standalone CALL Statement preservation
const rawCall = "CALL public.sp_my_proc(1, 'ABC');";
const classifiedCall = classifyStatement(rawCall);
assert(
  classifiedCall.type === 'CALL',
  `Standalone CALL statement classified as type 'CALL'. Type: "${classifiedCall.type}"`
);

const translatedCall = translateObject(classifiedCall, true, null, null, null, null, { 'public': 'dbo' });
assert(
  translatedCall.tsql.trim().includes("EXEC [dbo].[sp_my_proc] @Param1=1, @Param2='ABC';"),
  `Standalone CALL translated to executable EXEC query. Result: "${translatedCall.tsql}"`
);

// 11. NULL-handling validation warnings
const mockNullObjects = [
  {
    schema: 'dbo',
    name: 'test_concats',
    type: 'VIEW',
    tsql: "CREATE VIEW test_concats AS SELECT a + ' ' + b FROM test;"
  },
  {
    schema: 'dbo',
    name: 'test_legacy',
    type: 'VIEW',
    tsql: "CREATE VIEW test_legacy AS SELECT STUFF(COALESCE(', ' + a, ''), 1, 2, '') FROM test;"
  }
];
const nullReport = validateMigration(mockNullObjects);
const hasNullWarning = nullReport.warnings.find(w => w.description.includes("NULL-Handling Warning"));
assert(
  hasNullWarning !== undefined,
  "Validation Engine detects and warns about potential NULL-handling changes on T-SQL '+' concatenation."
);
const hasStuffInfo = nullReport.warnings.find(w => w.description.includes("NULL-Handling Info: CONCAT_WS"));
assert(
  hasStuffInfo !== undefined,
  "Validation Engine flags old-compatibility CONCAT_WS (STUFF/COALESCE) translations."
);

if (failed > 0) {
  console.error(`\n❌ Failed ${failed} assertions!`);
  process.exit(1);
} else {
  console.log('\n✅ All advanced rules and features verified successfully!');
}
