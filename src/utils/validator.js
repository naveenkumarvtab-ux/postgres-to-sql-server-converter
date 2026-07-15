import { cleanIdentifier } from './parser.js';

/**
 * Advanced Validation Engine for PostgreSQL to SQL Server T-SQL migration.
 * Validates syntax, references, dependencies, schema consistency, data types, and compatibility.
 */
export function validateMigration(translatedObjects) {
  const report = {
    successes: [],
    warnings: [],
    errors: [],
    manualFixes: []
  };

  // Build a lookup map of declared objects (lowercase schema-qualified)
  const declaredObjects = new Set();
  const declaredTables = new Set();
  const declaredSeqs = new Set();
  
  for (const obj of translatedObjects) {
    const fullKey = `${obj.schema.toLowerCase()}.${obj.name.toLowerCase()}`;
    declaredObjects.add(fullKey);
    if (obj.type === 'TABLE') declaredTables.add(fullKey);
    if (obj.type === 'SEQUENCE') declaredSeqs.add(fullKey);
  }

  // Iterate and validate each translated object
  for (const obj of translatedObjects) {
    const objLabel = `[${obj.schema}].[${obj.name}] (${obj.type})`;
    const tsql = obj.tsql || '';
    const cleanTsql = tsql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*/g, ''); // strip comments
    
    let hasCriticalError = false;

    // 1. Unbalanced Parentheses
    let parenLevel = 0;
    let inQuote = false;
    for (let i = 0; i < cleanTsql.length; i++) {
      const char = cleanTsql[i];
      if (char === "'" && cleanTsql[i - 1] !== '\\') {
        inQuote = !inQuote;
      } else if (!inQuote) {
        if (char === '(') parenLevel++;
        if (char === ')') parenLevel--;
      }
    }
    if (parenLevel !== 0) {
      report.errors.push({
        objectName: objLabel,
        description: `Unbalanced parentheses: ${parenLevel > 0 ? parenLevel + ' unclosed opening' : Math.abs(parenLevel) + ' extra closing'} parentheses detected.`
      });
      hasCriticalError = true;
    }

    // 2. Leaked PostgreSQL syntax checks
    const leakedCasts = cleanTsql.match(/::[a-zA-Z0-9_]+/g);
    if (leakedCasts) {
      report.errors.push({
        objectName: objLabel,
        description: `Leaked PostgreSQL-style cast syntax '${leakedCasts.join(', ')}' detected. Use CAST/CONVERT instead.`
      });
      hasCriticalError = true;
    }

    if (/\bBOOLEAN\b/i.test(cleanTsql)) {
      report.warnings.push({
        objectName: objLabel,
        description: `Unmapped data type 'BOOLEAN' found. SQL Server requires 'BIT'.`
      });
    }

    if (/\|\|/.test(cleanTsql) && obj.type !== 'DATA') {
      report.warnings.push({
        objectName: objLabel,
        description: `Detected PostgreSQL string concatenation '||'. SQL Server requires '+' or CONCAT().`
      });
    }

    if (/\bnow\(\)/i.test(cleanTsql)) {
      report.warnings.push({
        objectName: objLabel,
        description: `Leaked PG 'now()' function. SQL Server uses 'CURRENT_TIMESTAMP' or 'GETDATE()'.`
      });
    }

    if (/\bILIKE\b/i.test(cleanTsql)) {
      report.warnings.push({
        objectName: objLabel,
        description: `Detected PostgreSQL ILIKE comparison. T-SQL uses LIKE (case-insensitivity is determined by database collation).`
      });
    }

    if (/\bstring_agg\s*\(/i.test(cleanTsql)) {
      report.manualFixes.push({
        objectName: objLabel,
        description: `PG function 'string_agg' needs manual review. SQL Server 2017+ supports 'STRING_AGG', older versions require 'FOR XML PATH' queries.`
      });
    }

    if (/\bsplit_part\s*\(/i.test(cleanTsql)) {
      report.manualFixes.push({
        objectName: objLabel,
        description: `PG function 'split_part' needs rewrite. SQL Server does not have a direct split_part function; use STRING_SPLIT or custom split function.`
      });
    }

    // 3. Object Reference & Schema checks
    // Match FROM / JOIN / UPDATE / MERGE / INTO table references
    // e.g. FROM [dbo].[orders] or FROM orders or JOIN public.customers
    const refRegex = /\b(?:FROM|JOIN|UPDATE|INTO|REFERENCES)\s+([a-zA-Z0-9_.[\]]+)/gi;
    let match;
    while ((match = refRegex.exec(cleanTsql)) !== null) {
      const fullRef = match[1].replace(/[\[\]]/g, '').trim();
      
      // Ignore system keywords or common placeholders
      if (['inserted', 'deleted', 'sys', 'information_schema', 'select', 'values'].includes(fullRef.toLowerCase())) {
        continue;
      }

      // Check if reference contains a schema prefix
      const parts = fullRef.split('.');
      let refSchema = '';
      let refName = '';
      if (parts.length > 1) {
        refSchema = parts[0].toLowerCase();
        refName = parts[1].toLowerCase();
      } else {
        refName = parts[0].toLowerCase();
      }

      // Warn about missing schema prefix
      if (!refSchema) {
        report.warnings.push({
          objectName: objLabel,
          description: `Reference '${fullRef}' has no explicit schema prefix. Assumed default (dbo).`
        });
        refSchema = 'dbo';
      }

      // Validate references to actual tables
      const refKey = `${refSchema}.${refName}`;
      if (obj.type !== 'TABLE' && refSchema !== 'sys' && refSchema !== 'information_schema') {
        // If reference looks like it's a project table but isn't declared
        if (!declaredObjects.has(refKey) && (refSchema === 'dbo' || refSchema === obj.schema.toLowerCase())) {
          report.warnings.push({
            objectName: objLabel,
            description: `Referenced object '${fullRef}' could not be resolved inside the active migration schema.`
          });
        }
      }
    }

    // 4. Data Type Compatibility for Indexes / Keys
    // VARCHAR(MAX) and NVARCHAR(MAX) cannot be used in index keys
    if (obj.type === 'TABLE' && obj.parsed && obj.parsed.columns) {
      for (const col of obj.parsed.columns) {
        const isMaxType = col.type.toUpperCase().includes('(MAX)');
        const isPrimaryKey = col.primaryKey || (obj.parsed.constraints && obj.parsed.constraints.some(c => c.type === 'PRIMARY KEY' && c.columns && c.columns.includes(col.name)));
        
        if (isMaxType && isPrimaryKey) {
          report.errors.push({
            objectName: objLabel,
            description: `Primary key column [${col.name}] is mapped to '${col.type}'. SQL Server does not support index keys or primary keys on MAX-length data types (limit is 900 bytes).`
          });
          hasCriticalError = true;
        }
      }
    }

    // Classify object in report
    if (hasCriticalError) {
      // already added to errors list
    } else if (obj.requiresAi) {
      report.manualFixes.push({
        objectName: objLabel,
        description: `This PL/pgSQL object requires AI translation prior to deployment.`
      });
    } else {
      report.successes.push({
        objectName: objLabel,
        description: `Validated T-SQL structure successfully.`
      });
    }
  }

  return report;
}
