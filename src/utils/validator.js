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
  const declaredViews = new Set();
  const declaredFunctions = new Set();
  const declaredProcedures = new Set();
  const declaredSeqs = new Set();
  const declaredSchemas = new Set(['dbo', 'public']);
  const tableColumns = {};
  
  for (const obj of translatedObjects) {
    const schema = obj.schema ? obj.schema.toLowerCase() : 'dbo';
    const name = obj.name.toLowerCase();
    const fullKey = `${schema}.${name}`;
    
    declaredSchemas.add(schema);
    declaredObjects.add(fullKey);
    declaredObjects.add(name);
    
    if (obj.type === 'TABLE') {
      declaredTables.add(fullKey);
      declaredTables.add(name);
      if (obj.parsed && obj.parsed.columns) {
        tableColumns[fullKey] = obj.parsed.columns.map(c => c.name.toLowerCase());
        tableColumns[name] = tableColumns[fullKey];
      }
    }
    if (obj.type === 'VIEW') {
      declaredViews.add(fullKey);
      declaredViews.add(name);
    }
    if (obj.type === 'FUNCTION') {
      declaredFunctions.add(fullKey);
      declaredFunctions.add(name);
    }
    if (obj.type === 'PROCEDURE') {
      declaredProcedures.add(fullKey);
      declaredProcedures.add(name);
    }
    if (obj.type === 'SEQUENCE') {
      declaredSeqs.add(fullKey);
      declaredSeqs.add(name);
    }
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

    // Leaked MySQL syntax checks
    if (cleanTsql.includes('`')) {
      report.errors.push({
        objectName: objLabel,
        description: `Leaked MySQL-style backtick identifier quotes detected. Use square brackets instead.`
      });
      hasCriticalError = true;
    }
    if (/\bLIMIT\b/i.test(cleanTsql) && obj.type !== 'DATA') {
      report.errors.push({
        objectName: objLabel,
        description: `Leaked MySQL 'LIMIT' clause. Use TOP or OFFSET...FETCH instead.`
      });
      hasCriticalError = true;
    }
    if (/\bIFNULL\s*\(/i.test(cleanTsql)) {
      report.errors.push({
        objectName: objLabel,
        description: `Leaked MySQL 'IFNULL()' function. Use ISNULL() or COALESCE() instead.`
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

    // NULL-handling check for T-SQL string concatenation
    if (/\+/.test(cleanTsql) && obj.type !== 'DATA') {
      report.warnings.push({
        objectName: objLabel,
        description: `NULL-Handling Warning: String concatenation using '+' evaluates to NULL if any operand is NULL. Consider using CONCAT() or wrapping operands in COALESCE/ISNULL.`
      });
    }

    if (/STUFF\s*\(\s*COALESCE/i.test(cleanTsql)) {
      report.warnings.push({
        objectName: objLabel,
        description: `NULL-Handling Info: CONCAT_WS was simulated using STUFF and COALESCE to ignore NULL values on an older SQL Server target. Verify correctness under empty string vs NULL separators.`
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
        description: `Leaked PG function 'split_part' needs manual rewrite to T-SQL.`
      });
    }

    if (/CAST\s*\(.*?\s+AS\s+XML\)\.value\('/i.test(cleanTsql)) {
      report.warnings.push({
        objectName: objLabel,
        description: `Info: PostgreSQL split_part() function was simulated in T-SQL via XML casting. Check correctness and index performance.`
      });
    }

    // 2.5 Scan for leaked placeholder columns (e.g. Column1, Column2, ColumnN)
    const leakedPlaceholders = cleanTsql.match(/\bColumn\d+\b/i);
    if (leakedPlaceholders) {
      report.errors.push({
        objectName: objLabel,
        description: `Leaked placeholder column name '${leakedPlaceholders[0]}' detected. SQL Server schemas must use real column names; please verify view/table definitions.`
      });
      hasCriticalError = true;
    }

    // 2.6 Unsupported PostgreSQL features
    if (/\bregexp_replace\s*\(/i.test(cleanTsql)) {
      report.manualFixes.push({
        objectName: objLabel,
        description: `Unsupported PG function 'regexp_replace' found. SQL Server does not have native regex replace; consider CLR or master.dbo.xp_sprintf.`
      });
    }

    if (/\bstring_to_array\s*\(/i.test(cleanTsql) || /\barray_to_string\s*\(/i.test(cleanTsql)) {
      report.manualFixes.push({
        objectName: objLabel,
        description: `Unsupported PG array function 'string_to_array'/'array_to_string' found. SQL Server has no native array types; consider STRING_SPLIT / STRING_AGG.`
      });
    }

    if (/\[\d+\]/.test(cleanTsql) && obj.type !== 'DATA') {
      report.warnings.push({
        objectName: objLabel,
        description: `Detected array subscript access (e.g. col[1]). T-SQL does not support array index access. Consider mapping to JSON arrays (JSON_VALUE) instead.`
      });
    }

    // 3. Object Reference & Schema checks
    // Check Schemas, Tables, Columns, Sequences, Views, Functions, Procedures
    
    // Find all two-part or three-part references like [schema].[table] or schema.table
    const refPattern = /\b([a-zA-Z0-9_]+)\s*\.\s*([a-zA-Z0-9_]+)\b/g;
    let schemaMatch;
    while ((schemaMatch = refPattern.exec(cleanTsql)) !== null) {
      const schemaName = schemaMatch[1].toLowerCase();
      const objName = schemaMatch[2].toLowerCase();
      
      // Skip system schemas, keywords, and known built-ins
      if (['sys', 'information_schema', 'dbo', 'inserted', 'deleted'].includes(schemaName)) {
        continue;
      }
      
      // Validate schema exists — if not, check if this is likely an FDW/external/linked-server reference
      if (!declaredSchemas.has(schemaName)) {
        // Detect common FDW/external naming conventions for higher-confidence signal
        const fdwPatterns = /fdw|remote|external|link|foreign|dblink|federated|remote_/i;
        const isFdwLikely = fdwPatterns.test(schemaName);
        const fullRefName = `${schemaMatch[1]}.${schemaMatch[2]}`;

        if (isFdwLikely) {
          report.warnings.push({
            objectName: objLabel,
            description: `⚠️ Foreign Data Wrapper / Linked Server Reference: This object references [${fullRefName}], which appears to be a foreign data wrapper (FDW), database link, or external/linked-server table. Schema '${schemaMatch[1]}' is not defined anywhere in this dump. Set up a SQL Server LINKED SERVER (via sp_addlinkedserver) and update references to use four-part naming ([linked_server].[database].[schema].[table]) or OPENQUERY() syntax.`
          });
        } else {
          report.warnings.push({
            objectName: objLabel,
            description: `⚠️ Orphaned Schema Reference: This object references [${fullRefName}], but schema '${schemaMatch[1]}' is not defined anywhere in this dump. This may be a foreign data wrapper (FDW), database link, or external/linked-server table not included in this export. Verify manually whether '${schemaMatch[1]}' needs to be set up as a SQL Server LINKED SERVER (via sp_addlinkedserver) before this object will run successfully, and update the four-part naming ([linked_server].[database].[schema].[table]) or OPENQUERY() syntax accordingly.`
          });
        }
      }
    }

    // Detect Oracle @dblink syntax in object bodies (dialect-agnostic)
    const dblinkRegex = /@([a-zA-Z0-9_]+)/g;
    let dblinkMatch;
    while ((dblinkMatch = dblinkRegex.exec(cleanTsql)) !== null) {
      const linkName = dblinkMatch[1];
      // Skip common T-SQL variables (@param) — dblinks don't start with common variable prefixes
      if (['p_', 'v_', 'l_', 'i_', 'o_'].some(prefix => linkName.toLowerCase().startsWith(prefix))) continue;
      // Skip if it looks like a T-SQL variable (lowercase single-word after @)
      if (/^[a-z]/.test(linkName) && linkName.length < 20) continue;
      // Flag Oracle-style database links (typically UPPERCASE or mixed, e.g. @PROD_DB, @REMOTE_LINK)
      if (/[A-Z]/.test(linkName) && (linkName.includes('_') || linkName.length > 4)) {
        report.warnings.push({
          objectName: objLabel,
          description: `⚠️ Oracle Database Link Reference: Detected '@${linkName}' which appears to be an Oracle database link (DB Link). SQL Server uses LINKED SERVERs instead of DB Links. Set up a linked server via sp_addlinkedserver and rewrite the reference to use four-part naming ([linked_server].[database].[schema].[table]) or OPENQUERY() syntax.`
        });
      }
    }

    // Match FROM / JOIN / UPDATE / INTO table references
    const refRegex = /\b(?:FROM|JOIN|UPDATE|INTO|REFERENCES)\s+([a-zA-Z0-9_.[\]]+)/gi;
    let match;
    const referencedTablesInQuery = [];
    while ((match = refRegex.exec(cleanTsql)) !== null) {
      const fullRef = match[1].replace(/[\[\]]/g, '').trim();
      
      if (['inserted', 'deleted', 'sys', 'information_schema', 'select', 'values', 'as', 'begin', 'set', 'declare'].includes(fullRef.toLowerCase())) {
        continue;
      }

      const parts = fullRef.split('.');
      let refSchema = '';
      let refName = '';
      if (parts.length > 1) {
        refSchema = parts[0].toLowerCase();
        refName = parts[1].toLowerCase();
      } else {
        refSchema = 'dbo';
        refName = parts[0].toLowerCase();
      }

      const refKey = `${refSchema}.${refName}`;
      referencedTablesInQuery.push({ key: refKey, name: refName, full: fullRef });

      // Validate references to actual tables/views
      if (!declaredTables.has(refKey) && !declaredViews.has(refKey) && !refName.startsWith('#')) {
        report.errors.push({
          objectName: objLabel,
          description: `Broken Dependency / Missing Table or View: Referenced table or view '${fullRef}' does not exist in the active migration.`
        });
        hasCriticalError = true;
      }
    }

    // Check referenced Columns inside query
    const tokens = cleanTsql.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) || [];
    const uniqueTokens = [...new Set(tokens)];
    
    uniqueTokens.forEach(token => {
      const lowerToken = token.toLowerCase();
      // Skip keywords and built-in function names
      if (['select', 'from', 'where', 'and', 'or', 'join', 'on', 'group', 'by', 'order', 'having', 'insert', 'into', 'values', 'update', 'set', 'delete', 'dbo', 'public', 'count', 'sum', 'avg', 'min', 'max', 'null', 'not', 'in', 'is', 'as', 'create', 'view', 'procedure', 'function', 'trigger', 'end', 'begin', 'return', 'returns', 'declare', 'if', 'else', 'case', 'when', 'then', 'coalesce', 'isnull', 'cast', 'convert', 'go'].includes(lowerToken)) {
        return;
      }
      
      if (declaredFunctions.has(lowerToken) || declaredProcedures.has(lowerToken)) {
        return;
      }

      let foundInAnyTable = false;
      let checkedTablesCount = 0;
      
      referencedTablesInQuery.forEach(tbl => {
        const cols = tableColumns[tbl.key];
        if (cols) {
          checkedTablesCount++;
          if (cols.includes(lowerToken)) {
            foundInAnyTable = true;
          }
        }
      });

      if (checkedTablesCount > 0 && !foundInAnyTable) {
        const isTableName = referencedTablesInQuery.some(t => t.name === lowerToken);
        if (!isTableName) {
          // Find closest column suggestion
          let suggestion = null;
          referencedTablesInQuery.forEach(tbl => {
            const cols = tableColumns[tbl.key];
            if (cols && !suggestion) {
              suggestion = findClosestColumn(token, cols);
            }
          });

          report.errors.push({
            objectName: objLabel,
            description: `Missing Column Error: Referenced column '${token}' does not exist in Table/View.${suggestion ? ` Did you mean '${suggestion}'?` : ''}`
          });
          hasCriticalError = true;
        }
      }
    });

    // Validate sequence references
    const seqRefRegex = /NEXT\s+VALUE\s+FOR\s+([a-zA-Z0-9_.[\]]+)/gi;
    let seqMatch;
    while ((seqMatch = seqRefRegex.exec(cleanTsql)) !== null) {
      const fullSeq = seqMatch[1].replace(/[\[\]]/g, '').trim();
      const parts = fullSeq.split('.');
      let seqSchema = 'dbo';
      let seqName = fullSeq.toLowerCase();
      if (parts.length > 1) {
        seqSchema = parts[0].toLowerCase();
        seqName = parts[1].toLowerCase();
      }
      const seqKey = `${seqSchema}.${seqName}`;
      if (!declaredSeqs.has(seqKey)) {
        report.errors.push({
          objectName: objLabel,
          description: `Broken Dependency / Missing Sequence: Referenced sequence '${fullSeq}' does not exist in the active migration.`
        });
        hasCriticalError = true;
      }
    }

    // Validate foreign key targets
    if (obj.type === 'TABLE' && obj.parsed && obj.parsed.constraints) {
      obj.parsed.constraints.forEach(c => {
        const upperC = c.toUpperCase();
        if (upperC.includes('FOREIGN KEY') && upperC.includes('REFERENCES')) {
          const refMatch = c.match(/REFERENCES\s+([^\s(]+)/i);
          if (refMatch) {
            const refTable = refMatch[1].replace(/[\[\]]/g, '').trim();
            const parts = refTable.split('.');
            let refSchema = 'dbo';
            let refName = refTable.toLowerCase();
            if (parts.length > 1) {
              refSchema = parts[0].toLowerCase();
              refName = parts[1].toLowerCase();
            }
            const refKey = `${refSchema}.${refName}`;
            if (!declaredTables.has(refKey)) {
              report.errors.push({
                objectName: objLabel,
                description: `Broken Foreign Key Target: Referenced target table '${refTable}' does not exist in the active migration.`
              });
              hasCriticalError = true;
            }
          }
        }
      });
    }

    // Validate default expressions are valid SQL Server syntax
    if (obj.type === 'TABLE' && obj.parsed && obj.parsed.columns) {
      obj.parsed.columns.forEach(col => {
        if (col.defaultValue) {
          const defUpper = col.defaultValue.toUpperCase();
          if (defUpper.includes('::') || defUpper.includes('NOW()') || defUpper.includes('TRUE') || defUpper.includes('FALSE')) {
            report.errors.push({
              objectName: objLabel,
              description: `Invalid Default Value: Column '[${col.name}]' default expression '${col.defaultValue}' contains PostgreSQL-specific syntax.`
            });
            hasCriticalError = true;
          }
        }
      });
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

function levenshtein(s1, s2) {
  const m = s1.length, n = s2.length;
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[m][n];
}

function findClosestColumn(colName, columnsList) {
  let closest = '';
  let minDist = Infinity;
  columnsList.forEach(col => {
    const dist = levenshtein(colName.toLowerCase(), col.toLowerCase());
    if (dist < minDist) {
      minDist = dist;
      closest = col;
    }
  });
  return minDist < 4 ? closest : null;
}
