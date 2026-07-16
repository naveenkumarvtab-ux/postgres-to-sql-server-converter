/**
 * PostgreSQL Schema Parser and Classifier
 * This module splits the schema SQL into distinct statements,
 * extracts structural information, and classifies each object.
 */

// Helper to strip surrounding quotes (double or single) and brackets
export function cleanIdentifier(name) {
  if (!name) return '';
  let clean = name.trim();
  // Strip trailing parentheses
  while (clean.endsWith(')')) {
    clean = clean.substring(0, clean.length - 1).trim();
  }
  // Strip leading parentheses
  while (clean.startsWith('(')) {
    clean = clean.substring(1).trim();
  }
  // Strip double quotes
  if (clean.startsWith('"') && clean.endsWith('"')) {
    clean = clean.substring(1, clean.length - 1);
  }
  // Strip single quotes
  if (clean.startsWith("'") && clean.endsWith("'")) {
    clean = clean.substring(1, clean.length - 1);
  }
  // Strip square brackets
  if (clean.startsWith('[') && clean.endsWith(']')) {
    clean = clean.substring(1, clean.length - 1);
  }
  return clean;
}

// Split schema identifier into [schema, name]
export function parseSchemaQualifiedName(fullName) {
  const parts = fullName.split('.');
  if (parts.length > 1) {
    return {
      schema: cleanIdentifier(parts[0]),
      name: cleanIdentifier(parts[1])
    };
  }
  return {
    schema: 'public',
    name: cleanIdentifier(fullName)
  };
}

/**
 * Splits SQL script into discrete statements, handling single/double quotes,
 * dollar-quoted strings ($$ or $tag$), and line/block comments.
 */
export function splitSqlStatements(sqlContent) {
  const statements = [];
  let currentStatement = '';
  let state = 'NORMAL'; // NORMAL, SINGLE_QUOTE, DOUBLE_QUOTE, DOLLAR_QUOTE, SINGLE_COMMENT, MULTI_COMMENT
  let dollarTag = '';
  
  let i = 0;
  while (i < sqlContent.length) {
    const char = sqlContent[i];
    const nextChar = sqlContent[i + 1];
    
    if (state === 'NORMAL') {
      if (char === '-' && nextChar === '-') {
        state = 'SINGLE_COMMENT';
        i += 2;
        continue;
      } else if (char === '/' && nextChar === '*') {
        state = 'MULTI_COMMENT';
        i += 2;
        continue;
      } else if (char === "'") {
        state = 'SINGLE_QUOTE';
        currentStatement += char;
      } else if (char === '"') {
        state = 'DOUBLE_QUOTE';
        currentStatement += char;
      } else if (char === '$') {
        // Match dollar quote tags (e.g. $$ or $BODY$ or $function$)
        const sub = sqlContent.substring(i);
        const match = sub.match(/^(\$[a-zA-Z0-9_]*\$)/);
        if (match) {
          dollarTag = match[1];
          state = 'DOLLAR_QUOTE';
          currentStatement += dollarTag;
          i += dollarTag.length;
          continue;
        } else {
          currentStatement += char;
        }
      } else if (char === ';') {
        currentStatement += char;
        statements.push(currentStatement.trim());
        currentStatement = '';
      } else {
        currentStatement += char;
      }
    } else if (state === 'SINGLE_QUOTE') {
      currentStatement += char;
      if (char === '\\') {
        if (nextChar) {
          currentStatement += nextChar;
          i++;
        }
      } else if (char === "'") {
        state = 'NORMAL';
      }
    } else if (state === 'DOUBLE_QUOTE') {
      currentStatement += char;
      if (char === '\\') {
        if (nextChar) {
          currentStatement += nextChar;
          i++;
        }
      } else if (char === '"') {
        state = 'NORMAL';
      }
    } else if (state === 'DOLLAR_QUOTE') {
      currentStatement += char;
      if (char === '$') {
        const sub = sqlContent.substring(i);
        if (sub.startsWith(dollarTag)) {
          const remainingTag = dollarTag.substring(1);
          currentStatement += remainingTag;
          i += remainingTag.length;
          state = 'NORMAL';
        }
      }
    } else if (state === 'SINGLE_COMMENT') {
      if (char === '\n' || char === '\r') {
        state = 'NORMAL';
        currentStatement += ' '; // Preserve spaces/line ends
      }
    } else if (state === 'MULTI_COMMENT') {
      if (char === '*' && nextChar === '/') {
        state = 'NORMAL';
        i++;
        currentStatement += ' ';
      }
    }
    i++;
  }
  
  if (currentStatement.trim()) {
    statements.push(currentStatement.trim());
  }
  
  return statements.filter(stmt => stmt.length > 0);
}

/**
 * Split items inside parentheses at the top level (ignores nested parentheses and quotes)
 */
export function splitParenthesesBody(bodyText) {
  const items = [];
  let current = '';
  let parenLevel = 0;
  let inSingleQuote = false;
  
  for (let i = 0; i < bodyText.length; i++) {
    const char = bodyText[i];
    if (char === "'" && bodyText[i-1] !== '\\') {
      inSingleQuote = !inSingleQuote;
      current += char;
    } else if (!inSingleQuote && char === '(') {
      parenLevel++;
      current += char;
    } else if (!inSingleQuote && char === ')') {
      parenLevel--;
      current += char;
    } else if (!inSingleQuote && char === ',' && parenLevel === 0) {
      items.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) {
    items.push(current.trim());
  }
  return items;
}

/**
 * Categorize a single SQL statement and parse its structure.
 */
export function classifyStatement(rawSql) {
  const cleanSql = rawSql.replace(/\s+/g, ' ').trim();
  const upperSql = cleanSql.toUpperCase();
  
  const obj = {
    id: Math.random().toString(36).substring(2, 9),
    type: 'OTHER',
    name: 'unknown',
    schema: 'public',
    raw: rawSql,
    clean: cleanSql,
    parsed: {},
    warnings: [],
  };

  // 1.5 CREATE EXTENSION
  if (upperSql.startsWith('CREATE EXTENSION ')) {
    obj.type = 'EXTENSION';
    const match = cleanSql.match(/CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s;]+)/i);
    if (match) {
      obj.name = cleanIdentifier(match[1]);
      obj.schema = 'public';
    }
    return obj;
  }

  // 1. Schema
  if (upperSql.startsWith('CREATE SCHEMA ')) {
    obj.type = 'SCHEMA';
    const match = cleanSql.match(/CREATE\s+SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s;]+)/i);
    if (match) {
      obj.name = cleanIdentifier(match[1]);
      obj.schema = obj.name;
    }
    return obj;
  }

  // 2. Sequence
  if (upperSql.startsWith('CREATE SEQUENCE ')) {
    obj.type = 'SEQUENCE';
    const match = cleanSql.match(/CREATE\s+SEQUENCE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s;(]+)/i);
    if (match) {
      const qname = parseSchemaQualifiedName(match[1]);
      obj.name = qname.name;
      obj.schema = qname.schema;
    }
    return obj;
  }

  // 2.5 Custom ENUM Type
  if (upperSql.startsWith('CREATE TYPE ')) {
    const match = cleanSql.match(/CREATE\s+TYPE\s+([^\s;]+)\s+AS\s+ENUM\s*\((.*)\)/i);
    if (match) {
      const qname = parseSchemaQualifiedName(match[1]);
      obj.type = 'ENUM';
      obj.name = qname.name;
      obj.schema = qname.schema;
      
      const valuesStr = match[2];
      const values = splitParenthesesBody(valuesStr).map(v => cleanIdentifier(v));
      obj.parsed = {
        values
      };
      return obj;
    }
  }

  // 2.6 Custom Composite Type
  if (upperSql.startsWith('CREATE TYPE ')) {
    const match = cleanSql.match(/CREATE\s+TYPE\s+([^\s;]+)\s+AS\s*\((.*)\)/i);
    if (match) {
      const qname = parseSchemaQualifiedName(match[1]);
      obj.type = 'COMPOSITE';
      obj.name = qname.name;
      obj.schema = qname.schema;
      
      const fieldsStr = match[2];
      const fields = fieldsStr.split(',').map(f => f.trim());
      obj.parsed = {
        fields
      };
      return obj;
    }
  }

  // 2.7 Custom DOMAIN Type
  if (upperSql.startsWith('CREATE DOMAIN ')) {
    obj.type = 'DOMAIN';
    let baseType = '';
    let checkCondition = null;
    
    const checkMatch = cleanSql.match(/CREATE\s+DOMAIN\s+([^\s;]+)\s+AS\s+(.*?)\s+CHECK\s*\((.*)\)/i);
    if (checkMatch) {
      const qname = parseSchemaQualifiedName(checkMatch[1]);
      obj.name = qname.name;
      obj.schema = qname.schema;
      baseType = checkMatch[2].trim();
      checkCondition = checkMatch[3].trim();
      
      if (checkCondition && checkCondition.endsWith(')')) {
        let openParens = 0;
        for (let c of checkCondition) {
          if (c === '(') openParens++;
          if (c === ')') openParens--;
        }
        if (openParens < 0) {
          checkCondition = checkCondition.substring(0, checkCondition.length - 1).trim();
        }
      }
    } else {
      const simpleMatch = cleanSql.match(/CREATE\s+DOMAIN\s+([^\s;]+)\s+AS\s+([^;]+)/i);
      if (simpleMatch) {
        const qname = parseSchemaQualifiedName(simpleMatch[1]);
        obj.name = qname.name;
        obj.schema = qname.schema;
        baseType = simpleMatch[2].trim();
      }
    }
    
    obj.parsed = {
      baseType,
      checkCondition
    };
    return obj;
  }

  // 3. Table
  if (upperSql.startsWith('CREATE TABLE ')) {
    obj.type = 'TABLE';
    
    // Check if it's a declarative partition table (PARTITION OF)
    if (upperSql.includes(' PARTITION OF ')) {
      const nameMatch = cleanSql.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s;(]+)/i);
      if (nameMatch) {
        const qname = parseSchemaQualifiedName(nameMatch[1]);
        obj.name = qname.name;
        obj.schema = qname.schema;
      }
      obj.parsed.isPartitionTable = true;
      return obj;
    }

    // Look for matching parentheses body
    const match = cleanSql.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s;(]+)\s*\((.*)\)/i);
    if (match) {
      const qname = parseSchemaQualifiedName(match[1]);
      obj.name = qname.name;
      obj.schema = qname.schema;
      
      const body = match[2];
      const elements = splitParenthesesBody(body);
      const columns = [];
      const constraints = [];
      
      for (const el of elements) {
        const upperEl = el.toUpperCase().trim();
        const isConstraint = 
          upperEl.startsWith('CONSTRAINT') ||
          upperEl.startsWith('PRIMARY KEY') ||
          upperEl.startsWith('FOREIGN KEY') ||
          upperEl.startsWith('UNIQUE') ||
          upperEl.startsWith('CHECK') ||
          upperEl.startsWith('EXCLUDE');
        if (isConstraint) {
          constraints.push(el);
        } else {
          columns.push(parseColumnDefinition(el));
        }
      }
      
      obj.parsed = {
        columns,
        constraints
      };
    } else {
      // Direct fall back if parenthesis splitting fails
      const fallbackMatch = cleanSql.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s;(]+)/i);
      if (fallbackMatch) {
        const qname = parseSchemaQualifiedName(fallbackMatch[1]);
        obj.name = qname.name;
        obj.schema = qname.schema;
      }
    }
    return obj;
  }

  // 4. Alter Table (Constraints & Owners)
  if (upperSql.startsWith('ALTER TABLE ')) {
    // Match Alter Table Add Constraint
    const addConstMatch = cleanSql.match(/ALTER\s+TABLE\s+(?:ONLY\s+)?([^\s;]+)\s+ADD\s+CONSTRAINT\s+([^\s;]+)\s+(.*)/i);
    if (addConstMatch) {
      const qname = parseSchemaQualifiedName(addConstMatch[1]);
      obj.name = cleanIdentifier(addConstMatch[2]);
      obj.schema = qname.schema;
      obj.type = 'CONSTRAINT';
      obj.parsed = {
        tableName: qname.name,
        constraintType: extractConstraintType(addConstMatch[3]),
        definition: addConstMatch[3]
      };
      return obj;
    }
    
    const alterMatch = cleanSql.match(/ALTER\s+TABLE\s+(?:ONLY\s+)?([^\s;]+)/i);
    if (alterMatch) {
      const qname = parseSchemaQualifiedName(alterMatch[1]);
      obj.name = `alter_${qname.name}`;
      obj.schema = qname.schema;
      obj.type = 'ALTER_TABLE';
      obj.parsed = {
        tableName: qname.name
      };
    }
    return obj;
  }

  // 5. Index
  if (upperSql.startsWith('CREATE INDEX ') || upperSql.startsWith('CREATE UNIQUE INDEX ')) {
    obj.type = 'INDEX';
    const unique = upperSql.includes('UNIQUE');
    
    const nameMatch = cleanSql.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s;]+)/i);
    if (nameMatch) {
      obj.name = cleanIdentifier(nameMatch[1]);
    }
    
    const onIndex = upperSql.indexOf(' ON ');
    if (onIndex !== -1) {
      const afterOn = cleanSql.substring(onIndex + 4).trim();
      const tblMatch = afterOn.match(/^([^\s(]+)/);
      if (tblMatch) {
        const tblQname = parseSchemaQualifiedName(tblMatch[1]);
        obj.schema = tblQname.schema;
        obj.parsed = {
          tableName: tblQname.name,
          unique,
          using: 'btree',
          columns: '',
          where: null
        };
        
        const firstParen = afterOn.indexOf('(');
        if (firstParen !== -1) {
          let level = 0;
          let endParen = -1;
          for (let k = firstParen; k < afterOn.length; k++) {
            if (afterOn[k] === '(') level++;
            if (afterOn[k] === ')') {
              level--;
              if (level === 0) {
                endParen = k;
                break;
              }
            }
          }
          
          if (endParen !== -1) {
            obj.parsed.columns = afterOn.substring(firstParen + 1, endParen).trim();
            
            const betweenTblAndCols = afterOn.substring(tblMatch[1].length, firstParen).toUpperCase();
            const usingMatch = betweenTblAndCols.match(/USING\s+(\w+)/);
            if (usingMatch) {
              obj.parsed.using = usingMatch[1];
            }
            
            const afterCols = afterOn.substring(endParen + 1).trim();
            const whereMatch = afterCols.match(/^WHERE\s+(.*)/i);
            if (whereMatch) {
              let predicate = whereMatch[1].trim();
              if (predicate.endsWith(';')) {
                predicate = predicate.substring(0, predicate.length - 1).trim();
              }
              obj.parsed.where = predicate;
            }
          }
        }
      }
    }
    return obj;
  }

  // 5.5 Materialized View
  if (upperSql.startsWith('CREATE MATERIALIZED VIEW ') || upperSql.startsWith('CREATE OR REPLACE MATERIALIZED VIEW ') || upperSql.includes(' CREATE OR REPLACE MATERIALIZED VIEW ')) {
    obj.type = 'VIEW';
    const match = cleanSql.match(/CREATE\s+(?:OR\s+REPLACE\s+)?MATERIALIZED\s+VIEW\s+([^\s;(]+)/i);
    if (match) {
      const qname = parseSchemaQualifiedName(match[1]);
      obj.name = qname.name;
      obj.schema = qname.schema;
    }
    obj.parsed.isMaterializedView = true;
    return obj;
  }

  // 6. View
  if (upperSql.startsWith('CREATE VIEW ') || upperSql.includes(' CREATE OR REPLACE VIEW ') || upperSql.startsWith('CREATE OR REPLACE VIEW ')) {
    obj.type = 'VIEW';
    const match = cleanSql.match(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP|TEMPORARY)?\s*(?:RECURSIVE)?\s*VIEW\s+([^\s;(]+)/i);
    if (match) {
      const qname = parseSchemaQualifiedName(match[1]);
      obj.name = qname.name;
      obj.schema = qname.schema;
    }
    return obj;
  }

  // 7. Function or Procedure
  const isFunc = upperSql.startsWith('CREATE FUNCTION ') || upperSql.includes(' CREATE OR REPLACE FUNCTION ') || upperSql.startsWith('CREATE OR REPLACE FUNCTION ');
  const isProc = upperSql.startsWith('CREATE PROCEDURE ') || upperSql.includes(' CREATE OR REPLACE PROCEDURE ') || upperSql.startsWith('CREATE OR REPLACE PROCEDURE ');
  
  if (isFunc || isProc) {
    obj.type = isFunc ? 'FUNCTION' : 'PROCEDURE';
    const match = cleanSql.match(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+([^\s;(]+)/i);
    if (match) {
      const qname = parseSchemaQualifiedName(match[1]);
      obj.name = qname.name;
      obj.schema = qname.schema;
    }
    const returnsTrigger = isFunc && (upperSql.includes('RETURNS TRIGGER') || upperSql.includes('RETURNS TRIGGER '));
    obj.parsed = {
      returnsTrigger
    };
    return obj;
  }

  // 8. Trigger
  if (upperSql.startsWith('CREATE TRIGGER ')) {
    obj.type = 'TRIGGER';
    // Match: CREATE TRIGGER name BEFORE/AFTER/INSTEAD OF event ON table ... EXECUTE FUNCTION/PROCEDURE func_name()
    const match = cleanSql.match(/CREATE\s+TRIGGER\s+([^\s;]+)\s+(BEFORE|AFTER|INSTEAD\s+OF)\s+([\w\s,]+)\s+ON\s+([^\s;]+)\s+.*\s+EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+([^\s;(]+)/i);
    if (match) {
      obj.name = cleanIdentifier(match[1]);
      const tblQname = parseSchemaQualifiedName(match[4]);
      obj.schema = tblQname.schema;
      const funcQname = parseSchemaQualifiedName(match[5]);
      obj.parsed = {
        tableName: tblQname.name,
        timing: match[2].toUpperCase(),
        events: match[3].toUpperCase(),
        triggerFunctionName: funcQname.name,
        triggerFunctionSchema: funcQname.schema
      };
    }
    return obj;
  }

  // 9. INSERT / COPY (Data)
  if (upperSql.startsWith('INSERT INTO ') || upperSql.startsWith('COPY ')) {
    obj.type = 'DATA';
    const match = cleanSql.match(/(?:INSERT\s+INTO|COPY)\s+([^\s;(]+)/i);
    if (match) {
      const qname = parseSchemaQualifiedName(match[1]);
      obj.name = qname.name;
      obj.schema = qname.schema;
    }
    return obj;
  }

  // 10. Standalone SELECT / WITH
  if (upperSql.startsWith('SELECT ') || upperSql.startsWith('WITH ')) {
    obj.type = 'SELECT';
    obj.name = 'standalone_select';
    return obj;
  }

  return obj;
}

/**
 * Parse an individual column definition string
 * E.g., `id integer NOT NULL DEFAULT nextval('users_id_seq'::regclass)`
 * E.g., `metadata jsonb`
 */
function parseColumnDefinition(columnText) {
  const trimmed = columnText.trim();
  
  // Extract column name: first word (it might be wrapped in double quotes)
  const firstWordMatch = trimmed.match(/^("[^"]+"|[^\s]+)/);
  if (!firstWordMatch) return { raw: trimmed, name: 'unknown', type: 'unknown' };
  
  const colNameRaw = firstWordMatch[1];
  const colName = cleanIdentifier(colNameRaw);
  
  // Strip column name to isolate type and constraints
  let remainder = trimmed.substring(colNameRaw.length).trim();
  
  // Look for GENERATED ALWAYS AS ... STORED computed column definitions
  let isComputed = false;
  let computedExpression = null;
  const genIndex = remainder.toUpperCase().indexOf('GENERATED ALWAYS AS');
  if (genIndex !== -1) {
    const afterGen = remainder.substring(genIndex + 19).trim();
    if (afterGen.startsWith('(')) {
      let level = 0;
      let closingIdx = -1;
      for (let j = 0; j < afterGen.length; j++) {
        if (afterGen[j] === '(') level++;
        if (afterGen[j] === ')') {
          level--;
          if (level === 0) {
            closingIdx = j;
            break;
          }
        }
      }
      if (closingIdx !== -1) {
        isComputed = true;
        computedExpression = afterGen.substring(1, closingIdx).trim();
        // Remove the computed expression block and STORED keyword from remainder
        remainder = remainder.substring(0, genIndex).trim() + ' ' + afterGen.substring(closingIdx + 1).replace(/STORED/i, '').trim();
        remainder = remainder.trim();
      }
    }
  }
  
  // Identify multi-word data types or standard single-word types (possibly with parentheses)
  const multiWordTypes = [
    'double precision',
    'character varying',
    'char varying',
    'bit varying',
    'timestamp without time zone',
    'timestamp with time zone',
    'time without time zone',
    'time with time zone',
  ];

  let type = '';
  const lowerRem = remainder.toLowerCase();
  
  // Check for complex time/timestamp types with precision: e.g. timestamp(3) without/with time zone
  const timestampRegex = /^(timestamp|time)\s*(\(\s*\d+\s*\))?\s+(with|without)\s+time\s+zone/i;
  const tsMatch = remainder.match(timestampRegex);
  if (tsMatch) {
    type = tsMatch[0];
    remainder = remainder.substring(tsMatch[0].length).trim();
  } else {
    let matchedMw = false;
    for (const mw of multiWordTypes) {
      const regex = new RegExp(`^${mw}\\b`, 'i');
      if (regex.test(remainder)) {
        let length = mw.length;
        type = remainder.substring(0, length);
        let subRem = remainder.substring(length).trim();
        
        // Check if followed by parentheses, e.g. character varying(255)
        if (subRem.startsWith('(')) {
          let parenLevel = 0;
          let parenEnd = -1;
          for (let j = 0; j < subRem.length; j++) {
            if (subRem[j] === '(') parenLevel++;
            if (subRem[j] === ')') {
              parenLevel--;
              if (parenLevel === 0) {
                parenEnd = j;
                break;
              }
            }
          }
          if (parenEnd !== -1) {
            type += ' ' + subRem.substring(0, parenEnd + 1);
            remainder = subRem.substring(parenEnd + 1).trim();
            matchedMw = true;
            break;
          }
        }
        
        type = remainder.substring(0, length);
        remainder = subRem;
        matchedMw = true;
        break;
      }
    }
    
    if (!matchedMw) {
      // Standard single-word type which may have parentheses, e.g. varchar(255) or numeric(10,2) or int
      let parenLevel = 0;
      let typeIndex = remainder.length;
      for (let i = 0; i < remainder.length; i++) {
        const char = remainder[i];
        if (char === '(') parenLevel++;
        if (char === ')') parenLevel--;
        
        if (char === ' ' && parenLevel === 0) {
          typeIndex = i;
          break;
        }
      }
      type = remainder.substring(0, typeIndex);
      remainder = remainder.substring(typeIndex).trim();
    }
  }
  
  // Check if type is followed by array brackets e.g. integer[]
  const arrayMatch = remainder.match(/^(\s*\[\s*\])+/);
  let isArray = false;
  if (arrayMatch) {
    isArray = true;
    type += '[]';
    remainder = remainder.substring(arrayMatch[0].length).trim();
  }
  
  // Parse constraints in the remainder: DEFAULT, NOT NULL, NULL, UNIQUE, PRIMARY KEY, REFERENCES
  let upperRem = remainder.toUpperCase();
  const nullable = !upperRem.includes('NOT NULL');
  const primaryKey = upperRem.includes('PRIMARY KEY');
  const unique = upperRem.includes('UNIQUE');
  
  // Extract inline REFERENCES
  let inlineReferences = null;
  const refIndex = upperRem.indexOf('REFERENCES');
  if (refIndex !== -1) {
    const refPart = remainder.substring(refIndex);
    const refMatch = refPart.match(/REFERENCES\s+([^\s(]+)\s*\(([^)]+)\)(?:\s+ON\s+DELETE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION))?(?:\s+ON\s+UPDATE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION))?/i);
    if (refMatch) {
      inlineReferences = {
        rawRef: refMatch[0],
        table: refMatch[1],
        column: refMatch[2],
        onDelete: refMatch[3] || null,
        onUpdate: refMatch[4] || null
      };
      // Clean references clause from remainder
      remainder = remainder.replace(refMatch[0], '').trim();
      upperRem = remainder.toUpperCase();
    }
  }

  // Extract inline CHECK constraints
  let inlineCheck = null;
  const checkIndex = upperRem.indexOf('CHECK');
  if (checkIndex !== -1) {
    const afterCheckRaw = remainder.substring(checkIndex + 5);
    const leadingSpaces = afterCheckRaw.length - afterCheckRaw.trimStart().length;
    const afterCheck = afterCheckRaw.substring(leadingSpaces);
    if (afterCheck.startsWith('(')) {
      let level = 0;
      let closingIdx = -1;
      for (let j = 0; j < afterCheck.length; j++) {
        if (afterCheck[j] === '(') level++;
        if (afterCheck[j] === ')') {
          level--;
          if (level === 0) {
            closingIdx = j;
            break;
          }
        }
      }
      if (closingIdx !== -1) {
        const expr = afterCheck.substring(1, closingIdx).trim();
        inlineCheck = {
          rawCheck: remainder.substring(checkIndex, checkIndex + 5 + leadingSpaces + closingIdx + 1),
          expression: expr
        };
        // Clean check clause from remainder
        remainder = remainder.replace(inlineCheck.rawCheck, '').trim();
        upperRem = remainder.toUpperCase();
      }
    }
  }
  
  let defaultValue = null;
  // Match DEFAULT clause. Can be complex (e.g. nextval(...), 'string'::text, etc.)
  const defaultMatch = remainder.match(/DEFAULT\s+(.*)/i);
  if (defaultMatch) {
    let defVal = defaultMatch[1].trim();
    // Clean trailing comma or parentheses if they leaked, though they shouldn't
    const stopWords = ['NOT NULL', 'NULL', 'PRIMARY KEY', 'UNIQUE', 'REFERENCES', 'CONSTRAINT'];
    let earliestStopIndex = defVal.length;
    for (const stop of stopWords) {
      const regex = new RegExp(`\\b${stop}\\b`, 'i');
      const idxMatch = defVal.match(regex);
      if (idxMatch && idxMatch.index < earliestStopIndex) {
        earliestStopIndex = idxMatch.index;
      }
    }
    defaultValue = defVal.substring(0, earliestStopIndex).trim();
  }

  return {
    raw: trimmed,
    name: colName,
    type: type.trim(),
    isArray,
    nullable,
    primaryKey,
    unique,
    defaultValue,
    isComputed,
    computedExpression,
    inlineReferences,
    inlineCheck
  };
}

function extractConstraintType(text) {
  const upper = text.toUpperCase();
  if (upper.includes('PRIMARY KEY')) return 'PRIMARY KEY';
  if (upper.includes('FOREIGN KEY') || upper.includes('REFERENCES')) return 'FOREIGN KEY';
  if (upper.includes('UNIQUE')) return 'UNIQUE';
  if (upper.includes('CHECK')) return 'CHECK';
  return 'OTHER';
}
