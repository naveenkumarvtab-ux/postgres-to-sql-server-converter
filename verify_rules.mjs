import { applySqlConversionRules } from 'file:///c:/Users/Naveenkumar/Downloads/Postgres%20to%20SQL%20Server%20Conversion%20Application/src/utils/translator.js';
import { validateMigration } from 'file:///c:/Users/Naveenkumar/Downloads/Postgres%20to%20SQL%20Server%20Conversion%20Application/src/utils/validator.js';

console.log('Testing SQL conversion rules engine...');

// Test cases
const tests = [
  {
    name: 'Simple TO_DATE Translation',
    pg: "TO_DATE(date_col, 'YYYY-MM-DD')",
    expected: "TRY_CONVERT(DATE, date_col, 120)"
  },
  {
    name: 'CASE-based TO_DATE Translation',
    pg: "TO_DATE(date_col, CASE WHEN cond = 1 THEN 'YYYY-MM-DD' ELSE 'DD/MM/YYYY' END)",
    expected: "CASE WHEN cond = 1 THEN TRY_CONVERT(DATE, date_col, 120) ELSE TRY_CONVERT(DATE, date_col, 103) END"
  },
  {
    name: 'AGE() Translation',
    pg: "AGE(dob)",
    expected: "CASE WHEN DATEADD(YEAR, DATEDIFF(YEAR, dob, GETDATE()), dob) > GETDATE() THEN DATEDIFF(YEAR, dob, GETDATE()) - 1 ELSE DATEDIFF(YEAR, dob, GETDATE()) END"
  },
  {
    name: 'DATE_PART of AGE() Translation',
    pg: "DATE_PART('year', AGE(dob))",
    expected: "CASE WHEN DATEADD(YEAR, DATEDIFF(YEAR, dob, GETDATE()), dob) > GETDATE() THEN DATEDIFF(YEAR, dob, GETDATE()) - 1 ELSE DATEDIFF(YEAR, dob, GETDATE()) END"
  },
  {
    name: 'DATE_TRUNC EOMONTH Translation',
    pg: "DATE_TRUNC('month', effective_date + interval '1 year') - interval '1 day'",
    expected: "EOMONTH(DATEADD(year, 1, effective_date), -1)"
  },
  {
    name: 'DATE_TRUNC standard Translation',
    pg: "DATE_TRUNC('month', date_col)",
    expected: "DATEADD(month, DATEDIFF(month, 0, date_col), 0)"
  },
  {
    name: 'CALL statement with arguments Translation',
    pg: "CALL sp_test(10, 'ABC');",
    expected: "EXEC [dbo].[sp_test] @Param1=10, @Param2='ABC';"
  },
  {
    name: 'CALL statement with schema qualified name Translation',
    pg: "CALL shop.sp_test(10, 'ABC');",
    expected: "EXEC [shop].[sp_test] @Param1=10, @Param2='ABC';"
  },
  {
    name: 'Schema mapping replacement public to dbo',
    pg: "SELECT * FROM public.orders JOIN public.customers ON orders.cid = customers.id",
    expected: "SELECT * FROM [dbo].[orders] JOIN [dbo].[customers] ON orders.cid = customers.id"
  }
];

let failed = 0;

tests.forEach((t) => {
  const result = applySqlConversionRules(t.pg, true, { 'public': 'dbo' }).trim();
  // Standardize spacing/brackets for comparison checks where necessary
  const normResult = result.replace(/\s+/g, ' ');
  const normExpected = t.expected.replace(/\s+/g, ' ');
  
  if (normResult === normExpected || normResult.includes(normExpected) || normExpected.includes(normResult)) {
    console.log(`✅ [PASS] ${t.name}`);
  } else {
    console.log(`❌ [FAIL] ${t.name}`);
    console.log(`   Input   : ${t.pg}`);
    console.log(`   Output  : ${result}`);
    console.log(`   Expected: ${t.expected}`);
    failed++;
  }
});

console.log('\nTesting validation engine...');
const mockObjects = [
  {
    schema: 'dbo',
    name: 'orders',
    type: 'TABLE',
    tsql: 'CREATE TABLE [dbo].[orders] ( id INT PRIMARY KEY, email NVARCHAR(MAX) )'
  },
  {
    schema: 'dbo',
    name: 'get_orders',
    type: 'PROCEDURE',
    tsql: 'CREATE PROCEDURE [dbo].[get_orders] AS BEGIN SELECT * FROM orders; END' // missing schema orders warning
  }
];

const report = validateMigration(mockObjects);
console.log('Validation output:', JSON.stringify(report, null, 2));

if (failed > 0) {
  process.exit(1);
} else {
  console.log('\nAll tests completed successfully!');
}
