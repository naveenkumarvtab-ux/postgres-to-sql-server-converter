import { cleanIdentifier, parseSchemaQualifiedName } from './parser.js';

const defaultTypeMap = {
  'smallint': 'SMALLINT',
  'integer': 'INT',
  'int': 'INT',
  'int4': 'INT',
  'bigint': 'BIGINT',
  'int8': 'BIGINT',
  'real': 'REAL',
  'float4': 'REAL',
  'double precision': 'FLOAT(53)',
  'float8': 'FLOAT(53)',
  'numeric': 'DECIMAL(18,4)',
  'decimal': 'DECIMAL(18,4)',
  'boolean': 'BIT',
  'bool': 'BIT',
  'uuid': 'UNIQUEIDENTIFIER',
  'date': 'DATE',
  'time': 'TIME',
  'time without time zone': 'TIME',
  'timestamp': 'DATETIME2',
  'timestamp without time zone': 'DATETIME2',
  'timestamptz': 'DATETIMEOFFSET',
  'timestamp with time zone': 'DATETIMEOFFSET',
  'bytea': 'VARBINARY(MAX)',
  'json': 'NVARCHAR(MAX)',
  'jsonb': 'NVARCHAR(MAX)',
};

/**
 * Maps PostgreSQL data types to SQL Server equivalents.
 * Returns an object with the mapped type and any translation flags/warnings.
 */
export function mapDataType(pgType, useUnicode = true) {
  const cleanType = pgType.toLowerCase().trim();
  const result = {
    mappedType: '',
    warning: null
  };

  if (defaultTypeMap[cleanType]) {
    result.mappedType = defaultTypeMap[cleanType];
    if (cleanType === 'json' || cleanType === 'jsonb') {
      result.warning = `Type '${pgType}' mapped to NVARCHAR(MAX). Ensure JSON validation check constraint ISJSON() is used if needed.`;
    }
    return result;
  }

  // varchar(n) / character varying(n)
  let match = cleanType.match(/^(?:character varying|varchar)\s*\(\s*(\d+|max)\s*\)/i);
  if (match) {
    const len = match[1];
    result.mappedType = useUnicode ? `NVARCHAR(${len})` : `VARCHAR(${len})`;
    return result;
  }

  // char(n) / character(n)
  match = cleanType.match(/^(?:character|char)\s*\(\s*(\d+)\s*\)/i);
  if (match) {
    const len = match[1];
    result.mappedType = useUnicode ? `NCHAR(${len})` : `CHAR(${len})`;
    return result;
  }

  // text
  if (cleanType === 'text') {
    result.mappedType = useUnicode ? 'NVARCHAR(MAX)' : 'VARCHAR(MAX)';
    return result;
  }

  // varchar / character varying without length
  if (cleanType === 'varchar' || cleanType === 'character varying') {
    result.mappedType = useUnicode ? 'NVARCHAR(MAX)' : 'VARCHAR(MAX)';
    return result;
  }

  // serial / bigserial / smallserial
  if (cleanType === 'serial') {
    result.mappedType = 'INT IDENTITY(1,1)';
    return result;
  }
  if (cleanType === 'bigserial') {
    result.mappedType = 'BIGINT IDENTITY(1,1)';
    return result;
  }
  if (cleanType === 'smallserial') {
    result.mappedType = 'SMALLINT IDENTITY(1,1)';
    return result;
  }

  // numeric(p,s) / decimal(p,s)
  match = cleanType.match(/^(?:numeric|decimal)\s*\(\s*(\d+)\s*(?:,\s*(\d+))?\s*\)/i);
  if (match) {
    const p = match[1];
    const s = match[2] || '0';
    result.mappedType = `DECIMAL(${p},${s})`;
    return result;
  }

  // Array types: type[]
  if (cleanType.endsWith('[]')) {
    result.mappedType = 'NVARCHAR(MAX)';
    result.warning = `PostgreSQL arrays ('${pgType}') are not natively supported in SQL Server. Mapped to NVARCHAR(MAX) (recommend JSON array or mapping table).`;
    return result;
  }

  // Enum or Custom Type
  result.mappedType = useUnicode ? 'NVARCHAR(255)' : 'VARCHAR(255)';
  result.warning = `Custom or unknown type '${pgType}' mapped to ${result.mappedType}. Verify if it was an Enum or custom domain type.`;
  return result;
}

/**
 * Maps PostgreSQL defaults to SQL Server equivalents.
 */
export function mapDefaultValue(pgDefault, mappedType, useUnicode = true) {
  if (!pgDefault) return null;
  
  let cleanDef = pgDefault.trim();
  
  // Remove cast suffix: value::type or (value)::type
  cleanDef = cleanDef.replace(/::[a-zA-Z0-9_\s"[\]]+/g, '');
  
  // Remove double parentheses if wrapped e.g. ((value))
  const doubleParenMatch = cleanDef.match(/^\(\((.*)\)\)$/);
  if (doubleParenMatch) {
    cleanDef = doubleParenMatch[1].trim();
  }

  const upperDef = cleanDef.toUpperCase();
  
  // Check function defaults
  if (upperDef === 'NOW()' || upperDef === 'CURRENT_TIMESTAMP') {
    return 'CURRENT_TIMESTAMP';
  }
  
  if (upperDef === 'GEN_RANDOM_UUID()' || upperDef === 'UUID_GENERATE_V4()') {
    return 'NEWID()';
  }
  
  if (upperDef === 'TRUE') return '1';
  if (upperDef === 'FALSE') return '0';

  // nextval('sequence_name')
  const seqMatch = cleanDef.match(/nextval\(\s*'([^']+)'(?:::regclass)?\s*\)/i);
  if (seqMatch) {
    const seqQname = parseSchemaQualifiedName(seqMatch[1]);
    return `NEXT VALUE FOR [${seqQname.schema}].[${seqQname.name}]`;
  }

  // Text/character default value padding with Unicode indicator N
  if (useUnicode && cleanDef.startsWith("'") && cleanDef.endsWith("'") && !cleanDef.startsWith("N'") && mappedType.includes('NVARCHAR')) {
    return 'N' + cleanDef;
  }

  return cleanDef;
}

/**
 * Helper to escape names into SQL Server [schema].[name] or [name] format
 */
export function escapeTsqlName(fullName) {
  if (!fullName) return '';
  const parts = fullName.split('.');
  return parts.map(part => `[${cleanIdentifier(part)}]`).join('.');
}

/**
 * Helper to escape lists of columns, e.g. "col1, col2" -> "[col1], [col2]"
 */
export function escapeTsqlColumnList(colList) {
  if (!colList) return '';
  return colList
    .split(',')
    .map(col => `[${cleanIdentifier(col)}]`)
    .join(', ');
}

/**
 * Translates PostgreSQL regex and SIMILAR TO expressions to standard T-SQL LIKE patterns,
 * fully validating that we only use valid LIKE wildcards and warning/omitting on unsupported syntax.
 */
export function translateTsqlCheckExpression(expr, warnings = []) {
  if (!expr) return '';
  
  let cleanExpr = expr;
  
  // Clean quotes to square brackets
  cleanExpr = cleanExpr.replace(/"([^"]+)"/g, '[$1]');
  
  const regexOperatorPattern = /([^\s(]+|[^\s(]+\([^)]+\))\s*(!~|!~\*|~|~\*|SIMILAR\s+TO|NOT\s+SIMILAR\s+TO)\s*'([^']+)'/gi;
  
  cleanExpr = cleanExpr.replace(regexOperatorPattern, (fullMatch, leftSide, operator, pgRegex) => {
    let likePattern = '';
    let isSupported = false;
    let note = '';
    
    const opUpper = operator.toUpperCase();
    const isNegated = opUpper.startsWith('!') || opUpper.includes('NOT');
    const likeOp = isNegated ? 'NOT LIKE' : 'LIKE';
    
    const pgRegexClean = pgRegex.trim();
    
    // 1. Digit validation: ^\d{5}$ or ^\\d{5}$ or ^[0-9]{5}$
    const zipMatch = pgRegexClean.match(/^\^\\\\?(?:d|\[0-9\])\{(\d+)\}\$$/);
    if (zipMatch) {
      const len = parseInt(zipMatch[1]);
      likePattern = '[0-9]'.repeat(len);
      isSupported = true;
    }
    // 2. Email pattern: any pattern checking for @
    else if (pgRegexClean.includes('@')) {
      likePattern = '%_@_%.__%';
      isSupported = true;
      note = `\n-- NOTE: approximates original regex validation using LIKE wildcards; not an exact match. Original PostgreSQL regex: ${pgRegex}`;
    }
    // 3. Simple text start/end/exact matching (with no regex operators inside)
    else if (/^\^([A-Za-z0-9_-]+)\$$/i.test(pgRegexClean)) {
      likePattern = pgRegexClean.replace(/^\^/, '').replace(/\$$/, '');
      isSupported = true;
    } else if (/^\^([A-Za-z0-9_-]+)/i.test(pgRegexClean) && pgRegexClean.endsWith('.*')) {
      likePattern = pgRegexClean.replace(/^\^/, '').replace(/\.\*$/, '') + '%';
      isSupported = true;
    } else if (pgRegexClean.startsWith('.*') && pgRegexClean.endsWith('$') && /([A-Za-z0-9_-]+)\$$/i.test(pgRegexClean)) {
      likePattern = '%' + pgRegexClean.replace(/^\.\*/, '').replace(/\$$/, '');
      isSupported = true;
    }

    if (isSupported) {
      // Validate that the resulting pattern only uses valid LIKE wildcards (%, _, [...], [^...])
      if (/[\+?()|]/.test(likePattern)) {
        isSupported = false;
      }
    }

    if (isSupported) {
      if (note) {
        warnings.push(`CHECK constraint regex pattern translated to LIKE pattern '${likePattern}'. ${note.trim().replace(/^--\s*/, '')}`);
      }
      return `${leftSide} ${likeOp} '${likePattern}'` + (note ? ` /* ${note.replace(/--\s*/g, '').trim()} */` : '');
    } else {
      warnings.push(`⚠️ NOT CONVERTED: original CHECK used a PostgreSQL regex pattern '${pgRegex}' with no safe LIKE equivalent. Enforce this validation in application code, or implement via a CLR/scalar function.`);
      return `1=1 /* ⚠️ NOT CONVERTED: CHECK constraint regex '${pgRegex}' has no direct T-SQL LIKE equivalent */`;
    }
  });

  return cleanExpr;
}

export function translateColumn(colObj, useUnicode = true, enums = null, domains = null, composites = null) {
  const nameEsc = `[${colObj.name}]`;
  
  if (colObj.isComputed) {
    // Replace PostgreSQL identifier quotes with SQL Server square brackets inside the expression
    const cleanExpr = colObj.computedExpression.replace(/"([^"]+)"/g, '[$1]');
    return {
      tsql: `${nameEsc} AS (${cleanExpr}) PERSISTED`,
      warning: `Computed column [${colObj.name}] was translated to T-SQL PERSISTED format.`
    };
  }

  let typeEsc = '';
  let warning = null;
  let enumCheck = '';
  let domainCheckStr = '';
  
  const baseTypeName = cleanIdentifier(colObj.type.split('.').pop()).toLowerCase();
  const fullTypeName = colObj.type.toLowerCase();
  
  let domainInfo = null;
  if (domains) {
    if (domains[fullTypeName]) {
      domainInfo = domains[fullTypeName];
    } else if (domains[baseTypeName]) {
      domainInfo = domains[baseTypeName];
    }
  }

  let compositeFields = null;
  const isRangeType = /range\b/i.test(colObj.type);
  if (composites) {
    if (composites[fullTypeName]) {
      compositeFields = composites[fullTypeName];
    } else if (composites[baseTypeName]) {
      compositeFields = composites[baseTypeName];
    }
  }

  let commentStr = '';
  if (isRangeType) {
    commentStr = `-- NOTE: original type was PostgreSQL range type [${colObj.type}]. No SQL Server equivalent; flattened to NVARCHAR as a placeholder. Consider two separate start/end columns instead.\n    `;
  } else if (compositeFields) {
    commentStr = `-- NOTE: original type was composite type [${colObj.type}] with fields (${compositeFields.join(', ')}). No SQL Server equivalent; flattened to NVARCHAR. Consider normalizing into separate columns or a related table.\n    `;
  }

  if (domainInfo) {
    const baseTypeMap = mapDataType(domainInfo.baseType, useUnicode);
    typeEsc = baseTypeMap.mappedType;
    warning = baseTypeMap.warning;
    
    if (domainInfo.checkCondition) {
      let checkCond = domainInfo.checkCondition.replace(/\bVALUE\b/g, nameEsc);
      
      const checkWarnings = [];
      checkCond = translateTsqlCheckExpression(checkCond, checkWarnings);
      if (checkCond && !checkCond.startsWith('1=1')) {
        domainCheckStr = ` CHECK (${checkCond})`;
      } else {
        domainCheckStr = '';
      }
      if (checkWarnings.length > 0) {
        warning = warning ? `${warning} ${checkWarnings.join(' ')}` : checkWarnings.join(' ');
      }
    }
  } else if (compositeFields || isRangeType) {
    typeEsc = useUnicode ? 'NVARCHAR(MAX)' : 'VARCHAR(MAX)';
    warning = `Column [${colObj.name}] was composite or range type '${colObj.type}' and was flattened to ${typeEsc}.`;
  } else if (enums && enums[baseTypeName]) {
    const enumValues = enums[baseTypeName];
    typeEsc = useUnicode ? 'NVARCHAR(50)' : 'VARCHAR(50)';
    const literalPrefix = useUnicode ? 'N' : '';
    const formattedValues = enumValues.map(v => `${literalPrefix}'${v}'`).join(', ');
    enumCheck = ` CHECK (${nameEsc} IN (${formattedValues}))`;
    warning = `Column [${colObj.name}] references custom enum type '${colObj.type}'. Generated ${typeEsc} type with an inline CHECK constraint.`;
  } else {
    const typeMap = mapDataType(colObj.type, useUnicode);
    typeEsc = typeMap.mappedType;
    warning = typeMap.warning;
  }
  
  let nullability = colObj.nullable ? 'NULL' : 'NOT NULL';
  if (colObj.primaryKey || typeEsc.toUpperCase().includes('IDENTITY')) {
    nullability = 'NOT NULL'; // PKs and Identity columns must be NOT NULL in SQL Server
  }

  let defStr = '';
  if (colObj.defaultValue !== null) {
    const defVal = mapDefaultValue(colObj.defaultValue, typeEsc, useUnicode);
    if (defVal) {
      defStr = ` DEFAULT (${defVal})`;
    }
  }

  let inlinePk = '';
  if (colObj.primaryKey) {
    inlinePk = ' PRIMARY KEY';
  }

  let inlineUnique = '';
  if (colObj.unique && !colObj.primaryKey) {
    inlineUnique = ' UNIQUE';
  }

  let inlineRefStr = '';
  if (colObj.inlineReferences) {
    const parentTableEsc = escapeTsqlName(colObj.inlineReferences.table);
    const parentColEsc = `[${cleanIdentifier(colObj.inlineReferences.column)}]`;
    const onDelete = colObj.inlineReferences.onDelete ? ` ON DELETE ${colObj.inlineReferences.onDelete.toUpperCase()}` : '';
    const onUpdate = colObj.inlineReferences.onUpdate ? ` ON UPDATE ${colObj.inlineReferences.onUpdate.toUpperCase()}` : '';
    inlineRefStr = ` REFERENCES ${parentTableEsc}(${parentColEsc})${onDelete}${onUpdate}`;
  }

  let inlineCheckStr = '';
  if (colObj.inlineCheck) {
    const checkWarnings = [];
    let cleanCheckExpr = translateTsqlCheckExpression(colObj.inlineCheck.expression, checkWarnings);
    if (cleanCheckExpr && !cleanCheckExpr.startsWith('1=1')) {
      const colWordRegex = new RegExp(`\\b${colObj.name}\\b`, 'g');
      cleanCheckExpr = cleanCheckExpr.replace(colWordRegex, `[${colObj.name}]`);
      inlineCheckStr = ` CHECK (${cleanCheckExpr})`;
    } else {
      inlineCheckStr = '';
    }
    if (checkWarnings.length > 0) {
      warning = warning ? `${warning} ${checkWarnings.join(' ')}` : checkWarnings.join(' ');
    }
  }

  let combinedTsql = `${nameEsc} ${typeEsc} ${nullability}${inlinePk}${inlineUnique}${defStr}${enumCheck}${inlineRefStr}${inlineCheckStr}${domainCheckStr}`.replace(/\s+/g, ' ').trim();
  if (commentStr) {
    combinedTsql = `${commentStr}${combinedTsql}`;
  }
  return {
    tsql: combinedTsql,
    warning
  };
}

/**
 * Translates table-level constraint clauses.
 * E.g., `CONSTRAINT users_pkey PRIMARY KEY (id)`
 * E.g., `CONSTRAINT fk_group FOREIGN KEY (group_id) REFERENCES groups(id)`
 */
export function translateTableConstraint(constraintText, warnings = null) {
  let cleanConst = constraintText.trim();
  const upperConst = cleanConst.toUpperCase();

  // Strip trailing commas and semicolons if present
  if (cleanConst.endsWith(',')) {
    cleanConst = cleanConst.substring(0, cleanConst.length - 1).trim();
  }
  if (cleanConst.endsWith(';')) {
    cleanConst = cleanConst.substring(0, cleanConst.length - 1).trim();
  }

  // Match: CONSTRAINT const_name constraint_type
  let match = cleanConst.match(/^CONSTRAINT\s+([^\s;]+)\s+(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|EXCLUDE)\s*(.*)/i);
  if (match) {
    const constName = cleanIdentifier(match[1]);
    const constType = match[2].toUpperCase();
    const constBody = match[3].trim();
    
    let translatedBody = constBody;
    
    if (constType === 'PRIMARY KEY' || constType === 'UNIQUE') {
      const colMatch = constBody.match(/\(([^)]+)\)/);
      if (colMatch) {
        translatedBody = `(${escapeTsqlColumnList(colMatch[1])})`;
      }
    } else if (constType === 'FOREIGN KEY') {
      const fkMatch = constBody.match(/\(([^)]+)\)\s*REFERENCES\s+([^\s(]+)\s*\(([^)]+)\)(.*)/i);
      if (fkMatch) {
        const localCols = escapeTsqlColumnList(fkMatch[1]);
        const parentTable = escapeTsqlName(fkMatch[2]);
        const parentCols = escapeTsqlColumnList(fkMatch[3]);
        const extra = fkMatch[4] || '';
        translatedBody = `(${localCols}) REFERENCES ${parentTable}(${parentCols})${extra}`;
      }
    } else if (constType === 'CHECK') {
      const checkWarnings = [];
      const cleanExpr = translateTsqlCheckExpression(constBody, checkWarnings);
      if (warnings && checkWarnings.length > 0) {
        checkWarnings.forEach(w => warnings.push(w));
      }
      if (cleanExpr && !cleanExpr.startsWith('1=1')) {
        translatedBody = cleanExpr;
      } else {
        return `-- ⚠️ CONSTRAINT [${constName}] NOT CONVERTED: CHECK expression used a PostgreSQL regex pattern with no safe LIKE equivalent. Original: CHECK ${constBody}`;
      }
    } else if (constType === 'EXCLUDE') {
      const msg = `-- ⚠️ NOT CONVERTED — MANUAL REVIEW REQUIRED: PostgreSQL EXCLUDE constraint has no SQL Server equivalent. This prevented overlapping ranges. Recommended: enforce via an AFTER INSERT/UPDATE trigger that checks for overlaps and rolls back if found. Original: ${constraintText}`;
      if (warnings) {
        warnings.push(`Exclusion constraint [${constName}] has no direct SQL Server equivalent.`);
      }
      return msg;
    }

    return `CONSTRAINT [${constName}] ${constType} ${translatedBody}`;
  }

  if (upperConst.startsWith('EXCLUDE') || upperConst.includes('EXCLUDE USING')) {
    const msg = `-- ⚠️ NOT CONVERTED — MANUAL REVIEW REQUIRED: PostgreSQL EXCLUDE constraint has no SQL Server equivalent. This prevented overlapping ranges. Recommended: enforce via an AFTER INSERT/UPDATE trigger that checks for overlaps and rolls back if found. Original: ${constraintText}`;
    if (warnings) {
      warnings.push(`Exclusion constraint has no direct SQL Server equivalent.`);
    }
    return msg;
  }

  // If it does not start with CONSTRAINT explicitly, but is inline
  if (upperConst.startsWith('PRIMARY KEY')) {
    const colMatch = cleanConst.match(/\(([^)]+)\)/);
    if (colMatch) {
      return `PRIMARY KEY (${escapeTsqlColumnList(colMatch[1])})`;
    }
  }

  if (upperConst.startsWith('FOREIGN KEY')) {
    const fkMatch = cleanConst.match(/FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+([^\s(]+)\s*\(([^)]+)\)(.*)/i);
    if (fkMatch) {
      const localCols = escapeTsqlColumnList(fkMatch[1]);
      const parentTable = escapeTsqlName(fkMatch[2]);
      const parentCols = escapeTsqlColumnList(fkMatch[3]);
      const extra = fkMatch[4] || '';
      return `FOREIGN KEY (${localCols}) REFERENCES ${parentTable}(${parentCols})${extra}`;
    }
  }

  if (upperConst.startsWith('CHECK')) {
    const checkMatch = cleanConst.match(/CHECK\s*\((.*)\)/i);
    if (checkMatch) {
      const checkWarnings = [];
      const cleanExpr = translateTsqlCheckExpression(checkMatch[1], checkWarnings);
      if (warnings && checkWarnings.length > 0) {
        checkWarnings.forEach(w => warnings.push(w));
      }
      if (cleanExpr && !cleanExpr.startsWith('1=1')) {
        return `CHECK (${cleanExpr})`;
      } else {
        return `-- ⚠️ CHECK constraint NOT CONVERTED: expression used a PostgreSQL regex pattern with no safe LIKE equivalent. Original: ${cleanConst}`;
      }
    }
  }

  return cleanConst.replace(/"([^"]+)"/g, '[$1]');
}

/**
 * Automagically translates classified objects into T-SQL.
 * PL/pgSQL objects will be returned with a tag indicating they require AI translation.
 */
export function translateObject(obj, useUnicode = true, metadata = null, enums = null, domains = null, composites = null, schemaMap = { 'public': 'dbo' }) {
  const result = {
    tsql: '',
    warnings: [],
    requiresAi: false
  };

  switch (obj.type) {
    case 'SCHEMA': {
      result.tsql = `IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = '${obj.name}')\nBEGIN\n    EXEC('CREATE SCHEMA [${obj.name}]');\nEND\nGO`;
      break;
    }

    case 'SEQUENCE': {
      // Parse sequence modifiers if any
      const startMatch = obj.clean.match(/START\s+(?:WITH\s+)?(-?\d+)/i);
      const incMatch = obj.clean.match(/INCREMENT\s+(?:BY\s+)?(-?\d+)/i);
      
      const start = startMatch ? startMatch[1] : '1';
      const inc = incMatch ? incMatch[1] : '1';
      
      result.tsql = `DROP SEQUENCE IF EXISTS [${obj.schema}].[${obj.name}];\nGO\nCREATE SEQUENCE [${obj.schema}].[${obj.name}]\n    START WITH ${start}\n    INCREMENT BY ${inc};\nGO`;
      break;
    }

    case 'ENUM': {
      const valsList = obj.parsed.values.map(v => `'${v}'`).join(', ');
      result.tsql = `-- Custom ENUM type [${obj.schema}].[${obj.name}] is not natively supported in SQL Server.\n-- Columns referencing this type are converted to NVARCHAR(50) with a CHECK constraint.\n-- Original definition:\n-- CREATE TYPE [${obj.schema}].[${obj.name}] AS ENUM (${valsList});\nGO`;
      break;
    }

    case 'DOMAIN': {
      const usagesStr = obj.parsed.usages && obj.parsed.usages.length > 0 
        ? ` (see ${obj.parsed.usages.join(', ')})` 
        : '';
      result.tsql = `-- NOTE: ${obj.schema}.${obj.name} has no direct SQL Server equivalent.\n-- Its base type and CHECK constraint have been applied inline to every column using this domain${usagesStr}.\nGO`;
      break;
    }

    case 'TABLE': {
      if (obj.parsed.isPartitionTable) {
        result.tsql = `-- NOT CONVERTED — MANUAL REVIEW REQUIRED: PostgreSQL declarative partitioning (PARTITION OF) has no direct SQL Server equivalent.\n` +
                      `-- SQL Server uses partition functions/schemes instead, requiring a different table design.\n` +
                      `-- Recommended: create a partition function/scheme manually, or redesign as a single non-partitioned table.\n\n` +
                      `/* ORIGINAL POSTGRES CODE:\n${obj.raw}\n*/`;
        result.warnings.push(`Table [${obj.schema}].[${obj.name}] uses PostgreSQL declarative partitioning (PARTITION OF) which has no direct SQL Server equivalent.`);
        break;
      }

      if (!obj.parsed.columns) {
        result.tsql = `-- Warning: Failed to parse columns for table ${obj.name}\n-- Original SQL:\n-- ${obj.raw}`;
        result.warnings.push(`Could not parse column structure for table [${obj.schema}].[${obj.name}]. Keep original script.`);
        break;
      }
      
      const colsTsql = [];
      for (const col of obj.parsed.columns) {
        // Apply overrides from metadata if match found
        const overridenCol = applyMetadataOverrides(col, obj.name, metadata);
        const trans = translateColumn(overridenCol, useUnicode, enums, domains, composites);
        colsTsql.push(`    ${trans.tsql}`);
        if (trans.warning) {
          result.warnings.push(`Table [${obj.schema}].[${obj.name}], Column [${overridenCol.name}]: ${trans.warning}`);
        }
      }

      if (obj.parsed.constraints) {
        for (const cons of obj.parsed.constraints) {
          colsTsql.push(`    ${translateTableConstraint(cons, result.warnings)}`);
        }
      }

      result.tsql = `DROP TABLE IF EXISTS [${obj.schema}].[${obj.name}];\nGO\nCREATE TABLE [${obj.schema}].[${obj.name}] (\n${colsTsql.join(',\n')}\n);\nGO`;
      validateTableTsql(result.tsql, obj.name, result.warnings);
      break;
    }

    case 'CONSTRAINT': {
      // Out of table constraints: ALTER TABLE ADD CONSTRAINT
      const tableNameEsc = `[${obj.schema}].[${obj.parsed.tableName}]`;
      const constraintEsc = translateTableConstraint(obj.parsed.definition, result.warnings);
      
      if (constraintEsc.trim().startsWith('--')) {
        result.tsql = `${constraintEsc}\nGO`;
      } else {
        let addClause = constraintEsc;
        if (!constraintEsc.trim().toUpperCase().startsWith('CONSTRAINT ')) {
          addClause = `CONSTRAINT [${obj.name}] ${constraintEsc}`;
        }
        result.tsql = `ALTER TABLE ${tableNameEsc} DROP CONSTRAINT IF EXISTS [${obj.name}];\nGO\nALTER TABLE ${tableNameEsc} ADD ${addClause};\nGO`;
      }
      break;
    }

    case 'EXTENSION': {
      result.requiresAi = false;
      result.tsql = `-- ⚠️ NOT CONVERTED: PostgreSQL EXTENSION [${obj.name}] is not natively supported in SQL Server.\n` +
                    `-- Most extension features (like uuid-ossp or pgcrypto) have built-in SQL Server equivalents\n` +
                    `-- (e.g. NEWID(), CRYPT_GEN_RANDOM()) or require database configurations.\n\n` +
                    `/* ORIGINAL POSTGRES CODE:\n${obj.raw}\n*/`;
      result.warnings.push(`Extension [${obj.name}] is not converted. Extensions have no direct T-SQL equivalent.`);
      break;
    }

    case 'COMPOSITE': {
      const fieldsList = obj.parsed.fields.join(', ');
      result.requiresAi = false;
      result.tsql = `-- ⚠️ NOT CONVERTED: PostgreSQL composite type [${obj.schema}].[${obj.name}] has no direct SQL Server equivalent.\n` +
                    `-- Table columns using this type have been flattened to NVARCHAR placeholders.\n` +
                    `-- Original definition:\n` +
                    `-- CREATE TYPE [${obj.schema}].[${obj.name}] AS (${fieldsList});\nGO`;
      result.warnings.push(`Composite type [${obj.schema}].[${obj.name}] is not converted. Composite types have no direct T-SQL equivalent.`);
      break;
    }

    case 'INDEX': {
      const tblEsc = `[${obj.schema}].[${obj.parsed.tableName}]`;
      
      if (obj.parsed.using && (obj.parsed.using.toLowerCase() === 'gin' || obj.parsed.using.toLowerCase() === 'gist')) {
        result.tsql = `-- ⚠️ NOT CONVERTED — MANUAL REVIEW REQUIRED: PostgreSQL GIN/GIST index has no SQL Server equivalent.\n` +
                      `-- For JSON columns, consider using SQL Server's native JSON functions (JSON_VALUE/OPENJSON) with computed columns + standard indexes.\n` +
                      `-- For array-like columns, consider normalizing into a child table with proper indexes.\n\n` +
                      `/* ORIGINAL POSTGRES CODE:\n${obj.raw}\n*/`;
        result.warnings.push(`Index [${obj.schema}].[${obj.name}] uses PostgreSQL ${obj.parsed.using.toUpperCase()} index method which has no SQL Server equivalent.`);
        break;
      }
      
      const uniqueStr = obj.parsed.unique ? 'UNIQUE ' : '';
      
      // Parse columns for functional indexes
      const colsList = obj.parsed.columns.split(',');
      let computedColAlters = [];
      let indexCols = [];
      
      for (let colTerm of colsList) {
        colTerm = colTerm.trim();
        const funcMatch = colTerm.match(/^(LOWER|UPPER|TRIM|LTRIM|RTRIM)\s*\(\s*([^)]+)\s*\)/i);
        if (funcMatch) {
          const funcName = funcMatch[1].toUpperCase();
          const baseColRaw = funcMatch[2].trim();
          const baseCol = cleanIdentifier(baseColRaw);
          const computedColName = `${baseCol}_${funcName.toLowerCase()}`;
          
          computedColAlters.push(
            `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('${tblEsc}') AND name = '${computedColName}')\n` +
            `BEGIN\n` +
            `    ALTER TABLE ${tblEsc} ADD [${computedColName}] AS (${funcName}([${baseCol}]));\n` +
            `END\n` +
            `GO`
          );
          
          indexCols.push(`[${computedColName}]`);
          result.warnings.push(`Index [${obj.name}] contains functional expression '${colTerm}'. Generated computed column '[${computedColName}]' on table ${tblEsc} and indexed that column instead.`);
        } else {
          indexCols.push(`[${cleanIdentifier(colTerm)}]`);
        }
      }

      // Check for filter (WHERE) clause
      let filterStr = '';
      if (obj.parsed.where) {
        let cleanWhere = obj.parsed.where
          .replace(/"([^"]+)"/g, '[$1]')
          .replace(/\btrue\b/i, '1')
          .replace(/\bfalse\b/i, '0')
          .replace(/\bis\s+true\b/i, '= 1')
          .replace(/\bis\s+false\b/i, '= 0');
        filterStr = ` WHERE ${cleanWhere}`;
      }

      const altersTsql = computedColAlters.length > 0 ? computedColAlters.join('\n') + '\n' : '';
      result.tsql = `${altersTsql}DROP INDEX IF EXISTS [${obj.name}] ON ${tblEsc};\nGO\nCREATE ${uniqueStr}INDEX [${obj.name}] ON ${tblEsc} (${indexCols.join(', ')})${filterStr};\nGO`;
      
      if (obj.parsed.using && obj.parsed.using.toLowerCase() !== 'btree') {
        result.warnings.push(`Index [${obj.name}] was originally defined USING ${obj.parsed.using}. This modifier was stripped because T-SQL only supports clustered/non-clustered index types directly.`);
      }
      break;
    }

    case 'VIEW': {
      if (obj.parsed.isMaterializedView) {
        result.requiresAi = false;
        result.tsql = `-- ⚠️ NOT CONVERTED — MANUAL REVIEW REQUIRED: PostgreSQL MATERIALIZED VIEW has no direct SQL Server equivalent.\n` +
                      `-- Closest equivalent is a SCHEMABINDING view with a UNIQUE CLUSTERED INDEX ('indexed view'),\n` +
                      `-- which has stricter rules (no outer joins, only deterministic aggregates, all referenced objects must use two-part names).\n` +
                      `-- Recommended: manually redesign as an indexed view if requirements allow, or use a scheduled job to populate a real table instead.\n\n` +
                      `/* ORIGINAL POSTGRES CODE:\n${obj.raw}\n*/`;
        result.warnings.push(`Materialized View [${obj.schema}].[${obj.name}] is not converted. Materialized views have no direct T-SQL equivalent.`);
        break;
      }
      result.requiresAi = true;
      result.tsql = `-- PENDING AI TRANSLATION --\n-- The original VIEW object '${obj.name}' is written in PostgreSQL logic.\n-- Click 'AI Translate' to convert this logic to SQL Server (T-SQL).\n\n/* ORIGINAL POSTGRES CODE:\n${obj.raw}\n*/`;
      result.warnings.push(`View '${obj.name}' is a PL/pgSQL database object. It requires translation by the AI model.`);
      break;
    }

    case 'PROCEDURE': {
      result.requiresAi = true;
      result.tsql = `-- PENDING AI TRANSLATION --\n-- The original PROCEDURE object '${obj.name}' is written in PostgreSQL logic.\n-- Click 'AI Translate' to convert this logic to SQL Server (T-SQL).\n\n/* ORIGINAL POSTGRES CODE:\n${obj.raw}\n*/`;
      result.warnings.push(`Procedure '${obj.name}' is a PL/pgSQL database object. It requires translation by the AI model.`);
      break;
    }

    case 'FUNCTION': {
      if (obj.parsed.isMergedIntoTrigger) {
        result.requiresAi = false;
        result.tsql = `-- Merged into trigger [${obj.parsed.mergedTriggerName}] -- no separate object needed.`;
        result.warnings.push(`Trigger function '${obj.name}' was merged into trigger '${obj.parsed.mergedTriggerName}'. No separate object is generated.`);
      } else {
        result.requiresAi = true;
        result.tsql = `-- PENDING AI TRANSLATION --\n-- The original FUNCTION object '${obj.name}' is written in PostgreSQL logic.\n-- Click 'AI Translate' to convert this logic to SQL Server (T-SQL).\n\n/* ORIGINAL POSTGRES CODE:\n${obj.raw}\n*/`;
        result.warnings.push(`Function '${obj.name}' is a PL/pgSQL database object. It requires translation by the AI model.`);
      }
      break;
    }

    case 'TRIGGER': {
      if (obj.parsed.functionBody) {
        result.requiresAi = true;
        result.tsql = `-- PENDING AI TRANSLATION (MERGED TRIGGER UNIT) --\n-- Trigger: [${obj.schema}].[${obj.name}] ON table [${obj.schema}].[${obj.parsed.tableName}]\n-- Timing: ${obj.parsed.timing}, Events: ${obj.parsed.events}\n-- Original trigger function logic will be merged into the T-SQL trigger block.\n-- Click 'AI Translate' to convert this combined block to SQL Server T-SQL.\n\n/* ORIGINAL POSTGRES TRIGGER:\n${obj.raw}\n\nORIGINAL TRIGGER FUNCTION CODE:\n${obj.parsed.functionBody}\n*/`;
        result.warnings.push(`Trigger '${obj.name}' references PL/pgSQL function '${obj.parsed.triggerFunctionName}'. Merged both statements into a single T-SQL CREATE TRIGGER conversion unit.`);
      } else {
        result.requiresAi = true;
        result.tsql = `-- PENDING AI TRANSLATION --\n-- The original TRIGGER object '${obj.name}' is written in PostgreSQL logic.\n-- Click 'AI Translate' to convert this logic to SQL Server (T-SQL).\n\n/* ORIGINAL POSTGRES CODE:\n${obj.raw}\n*/`;
        result.warnings.push(`Trigger '${obj.name}' is a PL/pgSQL database object. It requires translation by the AI model.`);
      }
      break;
    }

    case 'DATA': {
      // Pass data statements directly
      result.tsql = obj.raw;
      break;
    }

    default: {
      // Keep other unrecognized lines as commented references
      result.tsql = `/* UNRECOGNIZED STATEMENT:\n${obj.raw}\n*/`;
      result.warnings.push(`Unrecognized SQL statement (skipped or commented out).`);
    }
  }

  // Apply standard SQL conversion rules to clean up T-SQL output
  result.tsql = applySqlConversionRules(result.tsql, useUnicode, schemaMap);

  // Validate generated SQL Server syntax before returning
  const tsqlValWarnings = validateTsql(result.tsql, obj.type, `${obj.schema}.${obj.name}`);
  result.warnings.push(...tsqlValWarnings);

  return result;
}

/**
 * Validates T-SQL outputs for known compatibility patterns or syntax issues.
 */
export function validateTsql(tsql, objectType, objectName) {
  const warnings = [];
  const cleanSql = tsql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*/g, ''); // strip comments

  // Rule A: IDENTITY columns must not have NULL (only NOT NULL)
  if (/\bIDENTITY\s*\(\s*\d+\s*,\s*\d+\s*\)\s+NULL\b/i.test(cleanSql)) {
    warnings.push(`Syntax Warning: Generated T-SQL for [${objectName}] contains 'IDENTITY' combined with 'NULL'. Identity columns in SQL Server must always be NOT NULL.`);
  }

  // Rule B: Computed columns must not have NULL/NOT NULL suffix
  if (/\bAS\s*\(.*\)\s*(?:PERSISTED\s+)?(?:NULL|NOT\s+NULL)\b/i.test(cleanSql)) {
    warnings.push(`Syntax Warning: Computed columns in SQL Server must not have explicit NULL or NOT NULL constraints.`);
  }

  // Rule C: Check for leaked PG-style casts (::type)
  if (/::[a-zA-Z]/i.test(cleanSql)) {
    warnings.push(`Syntax Warning: Detected PostgreSQL-style cast '::' inside the generated T-SQL. Use CAST() or CONVERT() for SQL Server.`);
  }

  // Rule D: Check for raw PostgreSQL boolean literals (TRUE/FALSE) in constraints or defaults
  if (/\b(?:TRUE|FALSE)\b/i.test(cleanSql)) {
    warnings.push(`Compatibility Warning: PostgreSQL boolean literals 'TRUE'/'FALSE' found. SQL Server uses 1/0 for BIT types.`);
  }

  // Rule E: Check for unmapped BOOLEAN datatype
  if (/\bBOOLEAN\b/i.test(cleanSql)) {
    warnings.push(`Compatibility Warning: PostgreSQL data type 'BOOLEAN' found. SQL Server uses BIT.`);
  }

  // Rule F: Check for unmapped string concatenation operator '||' (T-SQL uses '+')
  if (/\|\|/.test(cleanSql)) {
    warnings.push(`Compatibility Warning: Detected PostgreSQL string concatenation operator '||'. SQL Server uses '+' or CONCAT() function.`);
  }

  // Rule G: Check for unmapped now() function
  if (/\bnow\(\)/i.test(cleanSql)) {
    warnings.push(`Compatibility Warning: PostgreSQL 'now()' function found. SQL Server uses CURRENT_TIMESTAMP or GETDATE().`);
  }

  return warnings;
}

/**
 * Apply column metadata overrides loaded from optional JSON or CSV files
 */
export function applyMetadataOverrides(colObj, tableName, metadata) {
  if (!metadata) return colObj;
  
  const tblNameClean = cleanIdentifier(tableName).toLowerCase();
  const colNameClean = cleanIdentifier(colObj.name).toLowerCase();
  
  let override = null;
  
  if (Array.isArray(metadata)) {
    // Array format e.g. [ { table: 'users', column: 'email', type: 'NVARCHAR(100)' } ]
    override = metadata.find(m => {
      const mTbl = cleanIdentifier(m.table || m.tableName || m.table_name || '').toLowerCase();
      const mCol = cleanIdentifier(m.column || m.columnName || m.column_name || '').toLowerCase();
      return mTbl === tblNameClean && mCol === colNameClean;
    });
  } else if (typeof metadata === 'object') {
    // Dict formats
    if (metadata[`${tblNameClean}.${colNameClean}`]) {
      override = metadata[`${tblNameClean}.${colNameClean}`];
    } else if (metadata[tblNameClean] && metadata[tblNameClean][colNameClean]) {
      override = metadata[tblNameClean][colNameClean];
    }
  }
  
  if (override) {
    return {
      ...colObj,
      type: override.type || override.dataType || override.data_type || colObj.type,
      nullable: override.nullable !== undefined ? 
                 (typeof override.nullable === 'boolean' ? override.nullable : override.nullable.toLowerCase() === 'yes' || override.nullable.toLowerCase() === 'true') : 
                 colObj.nullable,
      defaultValue: override.default || override.defaultValue || override.default_value || colObj.defaultValue
    };
  }
  
  return colObj;
}

/**
 * Iteratively resolves object dependencies and flags objects that depend on unconverted objects.
 */
export function resolveDependencies(objects) {
  if (!objects || objects.length === 0) return [];

  const blockedNames = new Set();
  
  // 1. Find initial unconvertible/unconverted objects
  objects.forEach(obj => {
    if (obj.classified.parsed.isPartitionTable || obj.classified.parsed.isMaterializedView) {
      blockedNames.add(`${obj.classified.schema.toLowerCase()}.${obj.classified.name.toLowerCase()}`);
      blockedNames.add(obj.classified.name.toLowerCase());
    }
  });

  const blockedObjIds = new Set();
  const blockedByMap = new Map();
  let newBlockedAdded = true;

  // 2. Transitive resolution loop
  while (newBlockedAdded) {
    newBlockedAdded = false;
    
    objects.forEach(obj => {
      if (blockedObjIds.has(obj.classified.id)) return;
      if (obj.classified.parsed.isPartitionTable || obj.classified.parsed.isMaterializedView) {
        blockedObjIds.add(obj.classified.id);
        return;
      }

      // Scan raw SQL for dependencies
      const rawTextLower = obj.classified.raw.toLowerCase();
      
      let referencesBlocked = null;
      for (const name of blockedNames) {
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escapedName}\\b`, 'i');
        if (regex.test(rawTextLower)) {
          referencesBlocked = name;
          break;
        }
      }

      if (referencesBlocked) {
        blockedObjIds.add(obj.classified.id);
        blockedNames.add(`${obj.classified.schema.toLowerCase()}.${obj.classified.name.toLowerCase()}`);
        blockedNames.add(obj.classified.name.toLowerCase());
        blockedByMap.set(obj.classified.id, referencesBlocked);
        newBlockedAdded = true;
      }
    });
  }

  // 3. Map and update translations for blocked objects
  return objects.map(obj => {
    if (obj.classified.parsed.isPartitionTable || obj.classified.parsed.isMaterializedView) {
      return obj; // Keep original "NOT CONVERTED" output
    }

    if (blockedObjIds.has(obj.classified.id)) {
      const blocker = blockedByMap.get(obj.classified.id) || 'unconverted dependency';
      // Find the proper casing format of the blocker
      const blockerObj = objects.find(o => 
        o.classified.name.toLowerCase() === blocker.split('.').pop() ||
        `${o.classified.schema}.${o.classified.name}`.toLowerCase() === blocker
      );
      const blockerNameEsc = blockerObj ? `[${blockerObj.classified.schema}].[${blockerObj.classified.name}]` : `[${blocker}]`;

      const tsql = `-- ⚠️ BLOCKED — DEPENDS ON UNCONVERTED OBJECT ${blockerNameEsc}.\n` +
                    `-- Resolve that object first, then revisit this one.\n\n` +
                    `/* ORIGINAL POSTGRES CODE:\n${obj.classified.raw}\n*/`;
      
      return {
        ...obj,
        translation: {
          ...obj.translation,
          tsql,
          requiresAi: false,
          warnings: [
            ...obj.translation.warnings.filter(w => !w.includes('requires translation') && !w.includes('PL/pgSQL database object')),
            `⚠️ BLOCKED — DEPENDS ON UNCONVERTED OBJECT ${blockerNameEsc}.`
          ]
        }
      };
    }

    return obj;
  });
}

/**
 * Performs post-generation parenthesis balance and structure validation on CREATE TABLE T-SQL.
 */
export function validateTableTsql(tsql, tableName, warnings) {
  let openParens = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBrackets = false;
  
  for (let i = 0; i < tsql.length; i++) {
    const char = tsql[i];
    const prevChar = tsql[i - 1];
    
    if (char === "'" && prevChar !== '\\') {
      if (!inDoubleQuote) inSingleQuote = !inSingleQuote;
    } else if (char === '"' && prevChar !== '\\') {
      if (!inSingleQuote) inDoubleQuote = !inDoubleQuote;
    } else if (!inSingleQuote && !inDoubleQuote) {
      if (char === '[') inBrackets = true;
      if (char === ']') inBrackets = false;
      if (char === '(') openParens++;
      if (char === ')') openParens--;
    }
  }
  
  if (openParens !== 0) {
    warnings.push(`⚠️ Unbalanced parentheses detected in table [${tableName}] generated definition (overall balance: ${openParens}).`);
  }

  // Column list syntax verification
  const createIndex = tsql.indexOf('CREATE TABLE');
  if (createIndex !== -1) {
    const startParen = tsql.indexOf('(', createIndex);
    const endParen = tsql.lastIndexOf(')');
    if (startParen !== -1 && endParen !== -1 && startParen < endParen) {
      const colListText = tsql.substring(startParen + 1, endParen).trim();
      const items = [];
      let current = '';
      let pLevel = 0;
      let sQuote = false;
      for (let i = 0; i < colListText.length; i++) {
        const char = colListText[i];
        if (char === "'" && colListText[i - 1] !== '\\') {
          sQuote = !sQuote;
          current += char;
        } else if (!sQuote && char === '(') {
          pLevel++;
          current += char;
        } else if (!sQuote && char === ')') {
          pLevel--;
          current += char;
        } else if (!sQuote && char === ',' && pLevel === 0) {
          items.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      if (current.trim()) items.push(current.trim());

      for (const item of items) {
        let itemPLevel = 0;
        let itemSQuote = false;
        for (let i = 0; i < item.length; i++) {
          const char = item[i];
          if (char === "'" && item[i - 1] !== '\\') {
            itemSQuote = !itemSQuote;
          } else if (!itemSQuote) {
            if (char === '(') itemPLevel++;
            if (char === ')') itemPLevel--;
          }
        }
        if (itemPLevel !== 0) {
          warnings.push(`⚠️ Unbalanced parentheses within column or constraint definition: "${item}" (balance: ${itemPLevel}).`);
        }
      }
    }
  }
}

export function splitParenthesesArguments(argStr) {
  const args = [];
  let current = '';
  let parenLevel = 0;
  let inSingleQuote = false;
  
  for (let i = 0; i < argStr.length; i++) {
    const char = argStr[i];
    if (char === "'" && argStr[i-1] !== '\\') {
      inSingleQuote = !inSingleQuote;
      current += char;
    } else if (!inSingleQuote && char === '(') {
      parenLevel++;
      current += char;
    } else if (!inSingleQuote && char === ')') {
      parenLevel--;
      current += char;
    } else if (!inSingleQuote && char === ',' && parenLevel === 0) {
      args.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim() || args.length > 0) {
    args.push(current.trim());
  }
  return args;
}

const pgFormatToTsqlStyle = {
  'yyyy-mm-dd': 120,
  'yyyy/mm/dd': 111,
  'dd/mm/yyyy': 103,
  'mm/dd/yyyy': 101,
  'dd-mm-yyyy': 105,
  'mm-dd-yyyy': 110,
  'yyyymmdd': 112,
  'yyyy.mm.dd': 102,
  'mon dd, yyyy': 107,
  'month dd, yyyy': 107
};

export function translateToDate(expr, formatPart) {
  const formatClean = formatPart.trim();
  
  if (/^CASE\b/i.test(formatClean)) {
    let translatedCase = formatClean;
    const whenThenRegex = /WHEN\s+(.*?)\s+THEN\s+'([^']+)'/gi;
    translatedCase = translatedCase.replace(whenThenRegex, (match, cond, fmt) => {
      const style = pgFormatToTsqlStyle[fmt.toLowerCase()] || 120;
      return `WHEN ${cond} THEN TRY_CONVERT(DATE, ${expr}, ${style})`;
    });
    translatedCase = translatedCase.replace(/ELSE\s+'([^']+)'/gi, (match, fmt) => {
      const style = pgFormatToTsqlStyle[fmt.toLowerCase()] || 120;
      return `ELSE TRY_CONVERT(DATE, ${expr}, ${style})`;
    });
    return translatedCase;
  } else {
    const fmt = formatClean.replace(/^['"]|['"]$/g, '').toLowerCase();
    const style = pgFormatToTsqlStyle[fmt] || 120;
    return `TRY_CONVERT(DATE, ${expr}, ${style})`;
  }
}

export function translateAge(exprStr) {
  const args = splitParenthesesArguments(exprStr);
  let start = '';
  let end = 'GETDATE()';
  if (args.length >= 2) {
    end = args[0].trim();
    start = args[1].trim();
  } else if (args.length === 1) {
    start = args[0].trim();
  } else {
    return '0';
  }
  return `CASE WHEN DATEADD(YEAR, DATEDIFF(YEAR, ${start}, ${end}), ${start}) > ${end} THEN DATEDIFF(YEAR, ${start}, ${end}) - 1 ELSE DATEDIFF(YEAR, ${start}, ${end}) END`;
}

export function translateCall(procedureName, argsStr, schemaMap = { 'public': 'dbo' }) {
  const parts = procedureName.split('.');
  let schema = 'dbo';
  let name = procedureName;
  if (parts.length > 1) {
    schema = schemaMap[parts[0].trim()] || parts[0].trim();
    name = parts[1].trim();
  }
  const args = splitParenthesesArguments(argsStr);
  if (args.length === 0 || (args.length === 1 && args[0].trim() === '')) {
    return `EXEC [${schema}].[${name}];`;
  }
  const formattedArgs = args.map((arg, idx) => `@Param${idx + 1}=${arg.trim()}`).join(', ');
  return `EXEC [${schema}].[${name}] ${formattedArgs};`;
}

function mapIntervalUnit(unit) {
  const u = unit.toLowerCase();
  if (u.startsWith('year')) return 'year';
  if (u.startsWith('month')) return 'month';
  if (u.startsWith('week')) return 'week';
  if (u.startsWith('day')) return 'day';
  if (u.startsWith('hour')) return 'hour';
  if (u.startsWith('minute')) return 'minute';
  if (u.startsWith('second')) return 'second';
  return 'day';
}

export function translateIntervals(sql) {
  let clean = sql;
  const intervalRegex = /([a-zA-Z0-9_\.\(\)\[\]'"]+)\s*([+\-])\s*interval\s+'(-?\d+)\s+(\w+)'/gi;
  clean = clean.replace(intervalRegex, (match, expr, op, valStr, unit) => {
    const val = parseInt(valStr) * (op === '-' ? -1 : 1);
    const mappedUnit = mapIntervalUnit(unit);
    return `DATEADD(${mappedUnit}, ${val}, ${expr})`;
  });
  return clean;
}

export function applySqlConversionRules(sql, useUnicode = true, schemaMap = { 'public': 'dbo' }) {
  let clean = sql;

  // 1. Schema Mapping (e.g. [public].tableName or public.tableName or public.functionName)
  for (const [oldSchema, newSchema] of Object.entries(schemaMap)) {
    const regex1 = new RegExp(`\\[${oldSchema}\\]\\.\\[([a-zA-Z0-9_]+)\\]`, 'gi');
    clean = clean.replace(regex1, `[${newSchema}].[$1]`);
    
    const regex2 = new RegExp(`\\b${oldSchema}\\.([a-zA-Z0-9_]+)\\b`, 'gi');
    clean = clean.replace(regex2, `[${newSchema}].[$1]`);
  }

  // 2. NOW() and CURRENT_TIMESTAMP
  clean = clean.replace(/\bnow\(\)/gi, 'CURRENT_TIMESTAMP');
  clean = clean.replace(/\bcurrent_date\b/gi, 'CONVERT(DATE, GETDATE())');

  // 3. EOMONTH + interval year subtraction
  const dateTruncEomonthRegex = /DATE_TRUNC\s*\(\s*'month'\s*,\s*([a-zA-Z0-9_\.\(\)\[\]'""\s+\-*\/]+?)\s*\)\s*-\s*interval\s+'1\s+day'/gi;
  clean = clean.replace(dateTruncEomonthRegex, (match, expr) => {
    const translatedExpr = applySqlConversionRules(expr, useUnicode, schemaMap);
    return `EOMONTH(${translatedExpr}, -1)`;
  });

  // 4. DATE_TRUNC mapping
  const dateTruncRegex = /DATE_TRUNC\s*\(\s*'(\w+)'\s*,\s*(.*?)\s*\)/gi;
  clean = clean.replace(dateTruncRegex, (match, unit, expr) => {
    const translatedExpr = applySqlConversionRules(expr, useUnicode, schemaMap);
    const u = unit.toLowerCase();
    if (u === 'year') {
      return `DATEADD(year, DATEDIFF(year, 0, ${translatedExpr}), 0)`;
    } else if (u === 'month') {
      return `DATEADD(month, DATEDIFF(month, 0, ${translatedExpr}), 0)`;
    } else if (u === 'quarter') {
      return `DATEADD(quarter, DATEDIFF(quarter, 0, ${translatedExpr}), 0)`;
    } else if (u === 'week') {
      return `DATEADD(week, DATEDIFF(week, 0, ${translatedExpr}), 0)`;
    } else if (u === 'day') {
      return `CONVERT(DATE, ${translatedExpr})`;
    }
    return `DATEADD(${u}, DATEDIFF(${u}, 0, ${translatedExpr}), 0)`;
  });

  // 5. TO_DATE mapping
  let toDateIdx = clean.toUpperCase().indexOf('TO_DATE');
  while (toDateIdx !== -1) {
    const startParen = clean.indexOf('(', toDateIdx);
    if (startParen !== -1) {
      let level = 1;
      let endParen = -1;
      for (let i = startParen + 1; i < clean.length; i++) {
        if (clean[i] === '(') level++;
        if (clean[i] === ')') {
          level--;
          if (level === 0) {
            endParen = i;
            break;
          }
        }
      }
      if (endParen !== -1) {
        const body = clean.substring(startParen + 1, endParen);
        const args = splitParenthesesArguments(body);
        if (args.length >= 2) {
          const expr = args[0].trim();
          const format = args.slice(1).join(',').trim();
          const translatedToDate = translateToDate(expr, format);
          clean = clean.substring(0, toDateIdx) + translatedToDate + clean.substring(endParen + 1);
        }
      }
    }
    toDateIdx = clean.toUpperCase().indexOf('TO_DATE', toDateIdx + 7);
  }

  // 6. DATE_PART('year', AGE()) or EXTRACT(YEAR FROM AGE())
  const datePartAgeRegex = /DATE_PART\s*\(\s*'year'\s*,\s*AGE\s*\((.*?)\)\s*\)/gi;
  clean = clean.replace(datePartAgeRegex, (match, ageExpr) => {
    return translateAge(ageExpr);
  });
  const extractAgeRegex = /EXTRACT\s*\(\s*YEAR\s+FROM\s+AGE\s*\((.*?)\)\s*\)/gi;
  clean = clean.replace(extractAgeRegex, (match, ageExpr) => {
    return translateAge(ageExpr);
  });

  // 7. AGE(expr)
  let ageIdx = clean.toUpperCase().indexOf('AGE(');
  while (ageIdx !== -1) {
    // Prevent matching DATE_PART or EXTRACT wrappers
    const prevSub = clean.substring(Math.max(0, ageIdx - 15), ageIdx).toUpperCase();
    if (prevSub.includes('DATE_PART') || prevSub.includes('EXTRACT')) {
      ageIdx = clean.toUpperCase().indexOf('AGE(', ageIdx + 4);
      continue;
    }
    const startParen = ageIdx + 3;
    let level = 1;
    let endParen = -1;
    for (let i = startParen + 1; i < clean.length; i++) {
      if (clean[i] === '(') level++;
      if (clean[i] === ')') {
        level--;
        if (level === 0) {
          endParen = i;
          break;
        }
      }
    }
    if (endParen !== -1) {
      const body = clean.substring(startParen + 1, endParen);
      const translatedAge = translateAge(body);
      clean = clean.substring(0, ageIdx) + translatedAge + clean.substring(endParen + 1);
    }
    ageIdx = clean.toUpperCase().indexOf('AGE(', ageIdx + 4);
  }

  // 8. CALL mapping
  const callRegex = /\bCALL\s+([a-zA-Z0-9_\.]+)\s*\((.*?)\)\s*;?/gi;
  clean = clean.replace(callRegex, (match, procName, argsStr) => {
    return translateCall(procName, argsStr, schemaMap);
  });

  // 9. INTERVAL conversion
  clean = translateIntervals(clean);

  // 10. Perform, Return Query, Create Temp Table, Boolean/Serial/Array replacements
  clean = clean.replace(/\bPERFORM\s+([a-zA-Z0-9_.\(\)\[\]]+);?/gi, 'EXEC $1');
  clean = clean.replace(/\bRETURN\s+QUERY\s+SELECT\b/gi, 'SELECT');
  clean = clean.replace(/\bCREATE\s+TEMP\s+TABLE\s+([a-zA-Z0-9_]+)/gi, 'CREATE TABLE #$1');
  clean = clean.replace(/\bCREATE\s+TEMPORARY\s+TABLE\s+([a-zA-Z0-9_]+)/gi, 'CREATE TABLE #$1');

  return clean;
}

