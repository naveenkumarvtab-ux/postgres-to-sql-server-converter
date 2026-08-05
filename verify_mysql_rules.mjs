import { mapDataType, translateObject } from 'file:///c:/Users/Naveenkumar/Downloads/Postgres to SQL Server Conversion Application/src/utils/translator.js';
import { splitSqlStatements, classifyStatement } from 'file:///c:/Users/Naveenkumar/Downloads/Postgres to SQL Server Conversion Application/src/utils/parser.js';

console.log('Running MySQL Transpile rules verification checks...\n');

let failed = 0;

// Test 1: MySQL Data Type Mapping
console.log('--- Test Group 1: MySQL Datatype Mappings ---');
const typeTests = [
  { mysql: 'VARCHAR(255)', expected: 'NVARCHAR(255)' },
  { mysql: 'CHAR(10)', expected: 'NCHAR(10)' },
  { mysql: 'TINYINT(1)', expected: 'BIT' },
  { mysql: 'BOOLEAN', expected: 'BIT' },
  { mysql: 'TINYINT', expected: 'SMALLINT' },
  { mysql: 'MEDIUMINT', expected: 'INT' },
  { mysql: 'INT', expected: 'INT' },
  { mysql: 'INT UNSIGNED', expected: 'BIGINT' },
  { mysql: 'SMALLINT UNSIGNED', expected: 'INT' },
  { mysql: 'BIGINT UNSIGNED', expected: 'DECIMAL(20,0)' },
  { mysql: 'DATE', expected: 'DATE' },
  { mysql: 'DATETIME', expected: 'DATETIME2' },
  { mysql: 'TIMESTAMP', expected: 'DATETIME2' },
  { mysql: 'YEAR', expected: 'SMALLINT' },
  { mysql: 'JSON', expected: 'NVARCHAR(MAX)' },
  { mysql: 'TEXT', expected: 'NVARCHAR(MAX)' },
  { mysql: 'LONGTEXT', expected: 'NVARCHAR(MAX)' },
  { mysql: 'BLOB', expected: 'VARBINARY(MAX)' },
  { mysql: 'SET(\'a\',\'b\')', expected: 'NVARCHAR(MAX)' },
  { mysql: 'GEOMETRY', expected: 'GEOMETRY' },
];

typeTests.forEach(t => {
  const result = mapDataType(t.mysql, true, 'mysql');
  if (result.mappedType === t.expected) {
    console.log(`✅ [PASS] mapDataType('${t.mysql}') -> ${result.mappedType}`);
  } else {
    console.log(`❌ [FAIL] mapDataType('${t.mysql}') -> Got '${result.mappedType}', Expected '${t.expected}'`);
    failed++;
  }
});

// Test 2: MySQL Statement Splitter & DELIMITER Strip
console.log('\n--- Test Group 2: MySQL Delimiter splitting & comment parsing ---');
const mockMySqlScript = `
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100)
);

# This is a MySQL hash comment
DELIMITER $$
CREATE TRIGGER before_users_insert
BEFORE INSERT ON users
FOR EACH ROW
BEGIN
  SET NEW.name = UPPER(NEW.name);
END$$
DELIMITER ;

CREATE EVENT my_event ON SCHEDULE EVERY 1 HOUR DO SELECT 1;
`;

const splitStmts = splitSqlStatements(mockMySqlScript, 'mysql');
if (splitStmts.length === 3) {
  console.log(`✅ [PASS] splitSqlStatements returned exactly 3 statements`);
} else {
  console.log(`❌ [FAIL] splitSqlStatements returned ${splitStmts.length} statements (expected 3)`);
  failed++;
}

// Test 3: AUTO_INCREMENT and ON UPDATE CURRENT_TIMESTAMP Translation
console.log('\n--- Test Group 3: MySQL Table columns and Trigger generation ---');
const tableSql = `
CREATE TABLE orders (
  order_id INT AUTO_INCREMENT PRIMARY KEY,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  total DECIMAL(10,2)
);
`;

const parsedTable = classifyStatement(tableSql, 'mysql');
const translatedTable = translateObject(parsedTable, true, null, null, null, null, { 'public': 'dbo' }, {}, 'migration', '2017+', 'mysql');

if (translatedTable.tsql.includes('IDENTITY(1,1)')) {
  console.log('✅ [PASS] AUTO_INCREMENT translated to IDENTITY(1,1)');
} else {
  console.log('❌ [FAIL] AUTO_INCREMENT translation failed');
  failed++;
}

if (translatedTable.tsql.includes('CREATE OR ALTER TRIGGER') && translatedTable.tsql.includes('AFTER UPDATE')) {
  console.log('✅ [PASS] ON UPDATE CURRENT_TIMESTAMP generated AFTER UPDATE trigger');
} else {
  console.log('❌ [FAIL] ON UPDATE CURRENT_TIMESTAMP trigger generation failed');
  failed++;
}

// Test 4: ZEROFILL & UNSIGNED widening
console.log('\n--- Test Group 4: ZEROFILL and UNSIGNED conversions ---');
const zerofillColSql = `
CREATE TABLE test_table (
  val_zf INT(5) ZEROFILL,
  val_uns INT UNSIGNED
);
`;
const parsedZF = classifyStatement(zerofillColSql, 'mysql');
const translatedZF = translateObject(parsedZF, true, null, null, null, null, { 'public': 'dbo' }, {}, 'migration', '2017+', 'mysql');

const warnings = translatedZF.warnings.join(' ');
if (warnings.includes('ZEROFILL') && warnings.includes('UNSIGNED')) {
  console.log('✅ [PASS] ZEROFILL and UNSIGNED columns flagged with warnings correctly');
} else {
  console.log(`❌ [FAIL] ZEROFILL or UNSIGNED warning flagging failed. Warnings: ${warnings}`);
  failed++;
}

// Test 5: MySQL Events warning
console.log('\n--- Test Group 5: MySQL Events Conversions ---');
const eventSql = 'CREATE EVENT clean_logs ON SCHEDULE EVERY 1 DAY DO DELETE FROM logs;';
const parsedEvent = classifyStatement(eventSql, 'mysql');
const translatedEvent = translateObject(parsedEvent, true, null, null, null, null, { 'public': 'dbo' }, {}, 'migration', '2017+', 'mysql');

if (translatedEvent.tsql.includes('MySQL Event') && translatedEvent.warnings.some(w => w.includes('MySQL Event'))) {
  console.log('✅ [PASS] MySQL Event translated as NOT CONVERTED with warning comment');
} else {
  console.log('❌ [FAIL] MySQL Event translation failed to flag properly');
  failed++;
}

// Test 6: DML backtick stripping, dbo defaulting, and MERGE routing
console.log('\n--- Test Group 6: DML, Default Schema, and MERGE routing ---');
const dmlSql = "INSERT INTO `orders` (`order_id`, `customer_name`) VALUES (1, 'Jane');";
const parsedDml = classifyStatement(dmlSql, 'mysql');

if (parsedDml.schema === 'dbo') {
  console.log('✅ [PASS] Default schema set to dbo instead of public');
} else {
  console.log(`❌ [FAIL] Default schema set to ${parsedDml.schema} (expected dbo)`);
  failed++;
}

const translatedDml = translateObject(parsedDml, true, null, null, null, null, { 'public': 'dbo' }, {}, 'migration', '2017+', 'mysql');
if (translatedDml.tsql.includes('[orders]') && translatedDml.tsql.includes('[order_id]') && !translatedDml.tsql.includes('`')) {
  console.log('✅ [PASS] DML backticks successfully stripped and replaced with square brackets');
} else {
  console.log(`❌ [FAIL] DML backtick conversion failed. Got: ${translatedDml.tsql}`);
  failed++;
}

// Test ON DUPLICATE KEY UPDATE / REPLACE INTO requiresAi
const duplicateKeySql = "INSERT INTO `orders` (`id`) VALUES (1) ON DUPLICATE KEY UPDATE `id` = 2;";
const parsedDup = classifyStatement(duplicateKeySql, 'mysql');
const translatedDup = translateObject(parsedDup, true, null, null, null, null, { 'public': 'dbo' }, {}, 'migration', '2017+', 'mysql');

if (translatedDup.requiresAi === false && translatedDup.tsql.includes('MERGE INTO')) {
  console.log('✅ [PASS] ON DUPLICATE KEY UPDATE successfully compiled locally to MERGE (requiresAi=false)');
} else {
  console.log('❌ [FAIL] ON DUPLICATE KEY UPDATE local compilation failed');
  failed++;
}

const replaceSql = "REPLACE INTO `orders` (`id`) VALUES (1);";
const parsedRep = classifyStatement(replaceSql, 'mysql');
const translatedRep = translateObject(parsedRep, true, null, null, null, null, { 'public': 'dbo' }, {}, 'migration', '2017+', 'mysql');

if (translatedRep.requiresAi === true && translatedRep.tsql.includes('PENDING AI TRANSLATION')) {
  console.log('✅ [PASS] REPLACE INTO successfully routed to AI (requiresAi=true) when columns missing');
} else {
  console.log('❌ [FAIL] REPLACE INTO did not trigger AI routing');
  failed++;
}

// Test CREATE DATABASE classified as SCHEMA
const dbCreateSql = "CREATE DATABASE `my_custom_db`;";
const parsedDb = classifyStatement(dbCreateSql, 'mysql');
const translatedDb = translateObject(parsedDb, true, null, null, null, null, { 'public': 'dbo' }, {}, 'migration', '2017+', 'mysql');

if (parsedDb.type === 'SCHEMA' && translatedDb.tsql.includes('CREATE SCHEMA [my_custom_db]')) {
  console.log('✅ [PASS] CREATE DATABASE successfully classified as SCHEMA and generates guard');
} else {
  console.log(`❌ [FAIL] CREATE DATABASE classification failed. Type: ${parsedDb.type}, Got: ${translatedDb.tsql}`);
  failed++;
}

// Test 7: DML relative order preservation and REPLACE INTO column resetting
console.log('\n--- Test Group 7: DML Order & REPLACE INTO semantics ---');

const tableColMap = {
  'dbo.inventory_snapshot': ['product_id', 'snapshot_qty', 'snapshot_note', 'taken_at']
};

const replaceDml = "REPLACE INTO `inventory_snapshot` (`product_id`, `snapshot_qty`) VALUES (1, 8);";
const parsedReplace = classifyStatement(replaceDml, 'mysql');
const translatedReplace = translateObject(parsedReplace, true, null, null, null, null, { 'public': 'dbo' }, tableColMap, 'migration', '2017+', 'mysql');

if (translatedReplace.tsql.includes('[snapshot_note] = NULL') && translatedReplace.tsql.includes('[taken_at] = DEFAULT')) {
  console.log('✅ [PASS] REPLACE INTO successfully resets unspecified columns (snapshot_note=NULL, taken_at=DEFAULT)');
} else {
  console.log(`❌ [FAIL] REPLACE INTO failed to reset unspecified columns. Got:\n${translatedReplace.tsql}`);
  failed++;
}

// Test ON DUPLICATE KEY UPDATE only updates specified
const insertOnDup = "INSERT INTO `inventory_snapshot` (`product_id`, `snapshot_qty`) VALUES (1, 8) ON DUPLICATE KEY UPDATE `snapshot_qty` = VALUES(`snapshot_qty`);";
const parsedInsertOnDup = classifyStatement(insertOnDup, 'mysql');
const translatedInsertOnDup = translateObject(parsedInsertOnDup, true, null, null, null, null, { 'public': 'dbo' }, tableColMap, 'migration', '2017+', 'mysql');

if (translatedInsertOnDup.tsql.includes('[snapshot_qty] = [source].[snapshot_qty]') && !translatedInsertOnDup.tsql.includes('snapshot_note')) {
  console.log('✅ [PASS] ON DUPLICATE KEY UPDATE only updates specified column (snapshot_qty) without affecting snapshot_note');
} else {
  console.log(`❌ [FAIL] ON DUPLICATE KEY UPDATE modified unspecified columns or failed to update. Got:\n${translatedInsertOnDup.tsql}`);
  failed++;
}

// Test 8: Computed Column Boolean expressions wrapping and validation
console.log('\n--- Test Group 8: Computed Column Boolean Wrapping ---');

const computedSql = `
CREATE TABLE products (
  product_id INT AUTO_INCREMENT PRIMARY KEY,
  stock_qty INT,
  low_stock INT GENERATED ALWAYS AS (stock_qty < 10) STORED,
  total_val DECIMAL(10,2) GENERATED ALWAYS AS (stock_qty * 1.5) STORED
);
`;

const parsedComputed = classifyStatement(computedSql, 'mysql');
const translatedComputed = translateObject(parsedComputed, true, null, null, null, null, { 'public': 'dbo' }, {}, 'migration', '2017+', 'mysql');

if (translatedComputed.tsql.includes('CASE WHEN stock_qty < 10 THEN 1 ELSE 0 END')) {
  console.log('✅ [PASS] Boolean generated expression successfully wrapped in CASE WHEN predicate');
} else {
  console.log(`❌ [FAIL] Boolean generated expression failed to wrap. Got:\n${translatedComputed.tsql}`);
  failed++;
}

if (translatedComputed.tsql.includes('[total_val] AS (stock_qty * 1.5)')) {
  console.log('✅ [PASS] Non-boolean arithmetic generated expression left unmodified');
} else {
  console.log(`❌ [FAIL] Non-boolean generated expression incorrectly modified. Got:\n${translatedComputed.tsql}`);
  failed++;
}

// Test validation warning trigger on custom table SQL
import { validateTableTsql } from 'file:///c:/Users/Naveenkumar/Downloads/Postgres to SQL Server Conversion Application/src/utils/translator.js';
const invalidTableTsql = `
CREATE TABLE products (
  [low_stock] AS ([stock_qty] < 10) PERSISTED
);
`;
const testWarnings = [];
validateTableTsql(invalidTableTsql, 'products', testWarnings);
if (testWarnings.some(w => w.includes('invalid T-SQL boolean comparison'))) {
  console.log('✅ [PASS] Self-check successfully detects and flags raw comparison computed columns');
} else {
  console.log('❌ [FAIL] Self-check failed to flag invalid boolean comparison in computed column');
  failed++;
}

// Test 9: CTE Conversions & Schema Qualification
console.log('\n--- Test Group 9: CTE Conversions & Schema Qualification ---');

const recursiveCteSql = `
WITH RECURSIVE employee_tree AS (
  SELECT id, manager_id FROM employees WHERE manager_id IS NULL
  UNION ALL
  SELECT e.id, e.manager_id FROM employees e JOIN employee_tree et ON e.manager_id = et.id
)
SELECT * FROM employee_tree;
`;

const parsedRecursive = classifyStatement(recursiveCteSql, 'mysql');
const translatedRecursive = translateObject(parsedRecursive, true, null, null, null, null, { 'public': 'dbo' }, {}, 'migration', '2017+', 'mysql');

if (translatedRecursive.tsql.includes('WITH employee_tree AS') && 
    translatedRecursive.tsql.includes('FROM [dbo].[employees]') &&
    translatedRecursive.tsql.includes('OPTION (MAXRECURSION 100)')) {
  console.log('✅ [PASS] Recursive CTE: WITH RECURSIVE stripped, tables schema-qualified, CTE names skipped, and MAXRECURSION appended');
} else {
  console.log(`❌ [FAIL] Recursive CTE conversion failed. Got:\n${translatedRecursive.tsql}`);
  failed++;
}

const simpleCteDmlSql = `
WITH simple_cte AS (
  SELECT id FROM customers
)
UPDATE customers SET active = 1 FROM customers JOIN simple_cte ON customers.id = simple_cte.id;
`;

const parsedCteDml = classifyStatement(simpleCteDmlSql, 'mysql');
const translatedCteDml = translateObject(parsedCteDml, true, null, null, null, null, { 'public': 'dbo' }, {}, 'migration', '2017+', 'mysql');

if (translatedCteDml.tsql.includes('UPDATE [dbo].[customers]') && 
    translatedCteDml.tsql.includes('FROM [dbo].[customers] JOIN simple_cte')) {
  console.log('✅ [PASS] Simple CTE DML: CTE name and alias skipped from qualification, actual table qualified');
} else {
  console.log(`❌ [FAIL] Simple CTE DML conversion failed. Got:\n${translatedCteDml.tsql}`);
  failed++;
}

// Test stray END statement ignore logic
const strayEndSql = "END;";
const parsedEnd = classifyStatement(strayEndSql, 'mysql');
const translatedEnd = translateObject(parsedEnd, true, null, null, null, null, { 'public': 'dbo' }, {}, 'migration', '2017+', 'mysql');

if (translatedEnd.tsql === '') {
  console.log('✅ [PASS] Stray END statement ignored successfully without warnings');
} else {
  console.log(`❌ [FAIL] Stray END statement not ignored. Got:\n${translatedEnd.tsql}`);
  failed++;
}

if (failed > 0) {
  console.log(`\n❌ Total failures: ${failed}`);
  process.exit(1);
} else {
  console.log('\nAll MySQL verification assertions completed successfully! 🎉');
}
