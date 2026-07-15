import fs from 'fs';
import path from 'path';
import { splitSqlStatements, classifyStatement } from './src/utils/parser.js';
import { translateObject, resolveDependencies } from './src/utils/translator.js';

// Read the mock schema
const schemaPath = 'C:\\Users\\Naveenkumar\\.gemini\\antigravity\\brain\\049d878d-0216-49a0-8e5b-4bba156c604d\\scratch\\test_schema.sql';
const sql = fs.readFileSync(schemaPath, 'utf-8');

console.log('--- Original SQL loaded ---');
console.log(`Length: ${sql.length} chars`);

// Split
const statements = splitSqlStatements(sql);
console.log(`\nSplit into ${statements.length} statements.`);

// First pass: classify and collect enums, domains, and composites
const classifiedStatements = statements.map(stmt => classifyStatement(stmt));
const enumsMap = {};
const domainsMap = {};
const compositesMap = {};
classifiedStatements.forEach(obj => {
  if (obj.type === 'ENUM') {
    enumsMap[obj.name.toLowerCase()] = obj.parsed.values;
  } else if (obj.type === 'DOMAIN') {
    // Scan for usages
    const usages = [];
    classifiedStatements.forEach(tbl => {
      if (tbl.type === 'TABLE' && tbl.parsed.columns) {
        tbl.parsed.columns.forEach(col => {
          if (col.type.toLowerCase() === obj.name.toLowerCase() ||
              col.type.toLowerCase() === `${obj.schema.toLowerCase()}.${obj.name.toLowerCase()}`) {
            usages.push(`${tbl.schema}.${tbl.name}.${col.name}`);
          }
        });
      }
    });
    obj.parsed.usages = usages;
    domainsMap[obj.name.toLowerCase()] = obj.parsed;
    domainsMap[`${obj.schema.toLowerCase()}.${obj.name.toLowerCase()}`] = obj.parsed;
  } else if (obj.type === 'COMPOSITE') {
    compositesMap[obj.name.toLowerCase()] = obj.parsed.fields;
    compositesMap[`${obj.schema.toLowerCase()}.${obj.name.toLowerCase()}`] = obj.parsed.fields;
  }
});

// Merge Trigger functions with Trigger definitions
const triggerFunctions = classifiedStatements.filter(obj => obj.type === 'FUNCTION' && obj.parsed.returnsTrigger === true);
classifiedStatements.forEach(obj => {
  if (obj.type === 'TRIGGER' && obj.parsed.triggerFunctionName) {
    const matchingFunc = triggerFunctions.find(func => 
      func.name.toLowerCase() === obj.parsed.triggerFunctionName.toLowerCase() &&
      func.schema.toLowerCase() === obj.parsed.triggerFunctionSchema.toLowerCase()
    );
    if (matchingFunc) {
      obj.parsed.functionBody = matchingFunc.raw;
      matchingFunc.parsed.isMergedIntoTrigger = true;
      matchingFunc.parsed.mergedTriggerName = obj.name;
    }
  }
});

// Second pass: translate with enumsMap, domainsMap, and compositesMap
const rawObjects = classifiedStatements.map(classified => {
  const translation = translateObject(classified, true, null, enumsMap, domainsMap, compositesMap);
  return {
    classified,
    translation
  };
});

// Run dependency resolution pass
const parsedObjects = resolveDependencies(rawObjects);

console.log('\n--- Classified Objects ---');
parsedObjects.forEach((obj, idx) => {
  console.log(`[Statement ${idx + 1}] Type: ${obj.classified.type}, Name: ${obj.classified.schema}.${obj.classified.name}`);
  if (obj.translation.warnings.length > 0) {
    console.log(`  Warnings:`, obj.translation.warnings);
  }
});

console.log('\n--- Translated SQL Output ---');
parsedObjects.forEach((obj, idx) => {
  console.log(`\n-- Object: [${obj.classified.type}] ${obj.classified.schema}.${obj.classified.name}`);
  console.log(obj.translation.tsql);
});
