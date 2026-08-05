import { mapDataType, translateObject } from 'file:///c:/Users/Naveenkumar/Downloads/Postgres to SQL Server Conversion Application/src/utils/translator.js';
import { splitSqlStatements, splitOraclePackageBody } from 'file:///c:/Users/Naveenkumar/Downloads/Postgres to SQL Server Conversion Application/src/utils/parser.js';

console.log('Running Oracle Transpile rules verification checks...\n');

let failed = 0;

// Test 1: Oracle Data Type Mapping
console.log('--- Test Group 1: Oracle Datatype Mappings ---');
const typeTests = [
  { oracle: 'VARCHAR2(255)', expected: 'NVARCHAR(255)' },
  { oracle: 'NUMBER(1)', expected: 'BIT' },
  { oracle: 'NUMBER(5)', expected: 'INT' },
  { oracle: 'NUMBER(18)', expected: 'BIGINT' },
  { oracle: 'NUMBER(10,2)', expected: 'DECIMAL(10,2)' },
  { oracle: 'NUMBER', expected: 'DECIMAL(38,10)' },
  { oracle: 'DATE', expected: 'DATETIME2' },
  { oracle: 'CLOB', expected: 'NVARCHAR(MAX)' },
  { oracle: 'BLOB', expected: 'VARBINARY(MAX)' },
  { oracle: 'RAW(16)', expected: 'VARBINARY(16)' },
];

typeTests.forEach(t => {
  const result = mapDataType(t.oracle, true, 'oracle');
  if (result.mappedType === t.expected) {
    console.log(`✅ [PASS] mapDataType('${t.oracle}') -> ${result.mappedType}`);
  } else {
    console.log(`❌ [FAIL] mapDataType('${t.oracle}') -> Got '${result.mappedType}', Expected '${t.expected}'`);
    failed++;
  }
});

// Test 2: Oracle Statement Splitter
console.log('\n--- Test Group 2: Oracle DDL Statement Splitter ---');
const mockOracleScript = `
CREATE TABLE users (
  id NUMBER(10) PRIMARY KEY,
  name VARCHAR2(100)
);

CREATE OR REPLACE TRIGGER audit_users
AFTER INSERT ON users
FOR EACH ROW
BEGIN
  INSERT INTO audit_log VALUES(:new.id, SYSDATE);
END;
/

CREATE SEQUENCE user_seq START WITH 1;
`;

const splitStmts = splitSqlStatements(mockOracleScript, 'oracle');
if (splitStmts.length === 3) {
  console.log(`✅ [PASS] splitSqlStatements returned exactly 3 statements`);
} else {
  console.log(`❌ [FAIL] splitSqlStatements returned ${splitStmts.length} statements (expected 3)`);
  failed++;
}

// Test 3: Oracle Package Splitting
console.log('\n--- Test Group 3: Oracle Package Splitting ---');
const mockPackageBody = `
CREATE OR REPLACE PACKAGE BODY hr_pkg AS
  PROCEDURE hire_employee(emp_id NUMBER, dept_id NUMBER) IS
  BEGIN
    UPDATE employees SET active = 1 WHERE id = emp_id;
  END hire_employee;

  FUNCTION get_salary(emp_id NUMBER) RETURN NUMBER IS
    sal NUMBER;
  BEGIN
    SELECT salary INTO sal FROM employees WHERE id = emp_id;
    RETURN sal;
  END get_salary;
END hr_pkg;
`;

const pkgMembers = splitOraclePackageBody(mockPackageBody, 'hr_pkg');
if (pkgMembers.length === 2) {
  console.log(`✅ [PASS] splitOraclePackageBody found 2 members`);
  const names = pkgMembers.map(m => m.name);
  if (names.includes('hr_pkg_hire_employee') && names.includes('hr_pkg_get_salary')) {
    console.log(`✅ [PASS] Package members namespaced correctly: ${names.join(', ')}`);
  } else {
    console.log(`❌ [FAIL] Package member names missing or incorrect: ${names.join(', ')}`);
    failed++;
  }
} else {
  console.log(`❌ [FAIL] splitOraclePackageBody returned ${pkgMembers.length} members (expected 2)`);
  failed++;
}

// Test 4: Structural Object Warnings (Synonyms, Package declarations)
console.log('\n--- Test Group 4: Oracle Structural Object Conversions ---');
const synonymObj = {
  type: 'ORACLE_SYNONYM',
  name: 'emp_syn',
  schema: 'public',
  raw: 'CREATE PUBLIC SYNONYM emp_syn FOR hr.employees;',
  parsed: { forObject: 'hr.employees' }
};

const synonymTrans = translateObject(synonymObj, true, null, null, null, null, { 'public': 'dbo' }, {}, 'migration', '2017+', 'oracle');
if (synonymTrans.tsql.includes('NOT CONVERTED') && synonymTrans.warnings.length > 0) {
  console.log(`✅ [PASS] Synonym translated as NOT CONVERTED with warning comment`);
} else {
  console.log(`❌ [FAIL] Synonym translation failed to flag properly`);
  failed++;
}

// Test 5: Oracle Syntax Replacements (NEXTVAL, CURRVAL, SYSDATE, SYSTIMESTAMP, FROM DUAL)
console.log('\n--- Test Group 5: Oracle Specific Syntax Conversions ---');
import { applySqlConversionRules } from 'file:///c:/Users/Naveenkumar/Downloads/Postgres to SQL Server Conversion Application/src/utils/translator.js';

const syntaxTests = [
  { input: "my_seq.NEXTVAL", expected: "NEXT VALUE FOR [dbo].[my_seq]" },
  { input: "hr.emp_seq.NEXTVAL", expected: "NEXT VALUE FOR [hr].[emp_seq]" },
  { input: "my_seq.CURRVAL", expected: "(SELECT current_value FROM sys.sequences WHERE object_id = OBJECT_ID('[dbo].[my_seq]'))" },
  { input: "SYSDATE", expected: "GETDATE()" },
  { input: "SYSTIMESTAMP", expected: "SYSDATETIME()" },
  { input: "SELECT 1 FROM DUAL", expected: "SELECT 1" }
];

syntaxTests.forEach(t => {
  const result = applySqlConversionRules(t.input, true).trim();
  const normResult = result.replace(/\s+/g, ' ');
  const normExpected = t.expected.replace(/\s+/g, ' ');
  if (normResult === normExpected) {
    console.log(`✅ [PASS] applySqlConversionRules('${t.input}') -> ${result}`);
  } else {
    console.log(`❌ [FAIL] applySqlConversionRules('${t.input}') -> Got '${result}', Expected '${t.expected}'`);
    failed++;
  }
});

// Test 6: Advanced Oracle Features (GTT, Anonymous blocks, comment-column stripping)
console.log('\n--- Test Group 6: Advanced Oracle Features ---');
import { classifyStatement } from 'file:///c:/Users/Naveenkumar/Downloads/Postgres to SQL Server Conversion Application/src/utils/parser.js';

const gttClass = classifyStatement('CREATE GLOBAL TEMPORARY TABLE my_gtt (id NUMBER);', 'oracle');
if (gttClass.type === 'TABLE' && gttClass.parsed.isGlobalTemp === true) {
  console.log('✅ [PASS] Global Temporary Table classified as TABLE with isGlobalTemp=true');
} else {
  console.log(`❌ [FAIL] GTT classification failed. Got type: ${gttClass.type}, isGlobalTemp: ${gttClass.parsed.isGlobalTemp}`);
  failed++;
}

const anonClass = classifyStatement('BEGIN dbms_output.put_line(1); END;', 'oracle');
if (anonClass.type === 'PLSQL_BLOCK') {
  console.log('✅ [PASS] Standalone BEGIN...END block classified as PLSQL_BLOCK');
} else {
  console.log(`❌ [FAIL] Anonymous block classification failed. Got type: ${anonClass.type}`);
  failed++;
}

const commentTable = classifyStatement('CREATE TABLE products (\n  notes VARCHAR2(200) -- deliberately left nullable, tested with \'\' below\n);', 'oracle');
const colNames = (commentTable.parsed.columns || []).map(c => c.name);
if (colNames.length === 1 && colNames[0] === 'notes') {
  console.log('✅ [PASS] Comment commas correctly stripped, no fabricated [tested] column.');
} else {
  console.log(`❌ [FAIL] Comment column stripping failed. Got columns: ${colNames.join(', ')}`);
  failed++;
}

console.log('\n--- Test Group 7: Oracle Computed Column Boolean Wrapping ---');
import { translateColumn } from 'file:///c:/Users/Naveenkumar/Downloads/Postgres to SQL Server Conversion Application/src/utils/translator.js';
const oraColObj = {
  name: 'is_large',
  isComputed: true,
  computedExpression: 'amount > 1000',
  raw: 'is_large NUMBER GENERATED ALWAYS AS (amount > 1000)'
};
const oraTrans = translateColumn(oraColObj, true, null, null, null, 'oracle');
if (oraTrans.tsql.includes('CASE WHEN amount > 1000 THEN 1 ELSE 0 END')) {
  console.log('✅ [PASS] Oracle boolean computed column successfully wrapped');
} else {
  console.log(`❌ [FAIL] Oracle boolean computed column wrapping failed. Got: ${oraTrans.tsql}`);
  failed++;
}

if (failed > 0) {
  console.log(`\n❌ Total failures: ${failed}`);
  process.exit(1);
} else {
  console.log('\nAll Oracle verification assertions completed successfully! 🎉');
}
