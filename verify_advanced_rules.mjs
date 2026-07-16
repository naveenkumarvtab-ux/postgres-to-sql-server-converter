import { applySqlConversionRules, translateObject } from './src/utils/translator.js';
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

if (failed > 0) {
  console.error(`\n❌ Failed ${failed} assertions!`);
  process.exit(1);
} else {
  console.log('\n✅ All advanced rules and features verified successfully!');
}
