import { cleanIdentifier } from './parser.js';

// Reserved T-SQL keywords list (including types, built-in functions, settings, and cursors)
export const RESERVED_KEYWORDS = new Set([
  // Basic query
  'select', 'from', 'where', 'and', 'or', 'join', 'on', 'group', 'by', 'order', 'having',
  'insert', 'into', 'values', 'update', 'set', 'delete', 'dbo', 'public', 'count', 'sum',
  'avg', 'min', 'max', 'null', 'not', 'in', 'is', 'as', 'create', 'view', 'procedure',
  'function', 'trigger', 'end', 'begin', 'return', 'returns', 'declare', 'if', 'else',
  'case', 'when', 'then', 'coalesce', 'isnull', 'cast', 'convert', 'go', 'with', 'table',
  'exec', 'execute', 'alter', 'drop', 'index', 'primary', 'key', 'foreign', 'references',
  'constraint', 'unique', 'check', 'exists', 'having', 'sys', 'information_schema',
  'inserted', 'deleted', 'left', 'right', 'inner', 'outer', 'cross', 'full', 'merge',
  'into', 'using', 'matched', 'then', 'when', 'output', 'option', 'maxrecursion', 'stored',
  'persisted', 'top', 'over', 'partition', 'save', 'checkpoint',

  // SQL Server Data Types
  'int', 'bigint', 'smallint', 'tinyint', 'bit', 'decimal', 'numeric', 'money', 'smallmoney',
  'float', 'real', 'datetime', 'smalldatetime', 'date', 'time', 'datetime2', 'datetimeoffset',
  'char', 'varchar', 'text', 'nchar', 'nvarchar', 'ntext', 'binary', 'varbinary', 'image',
  'xml', 'sysname', 'uniqueidentifier',

  // SQL Server System Settings, Options and Commands
  'nocount', 'on', 'off', 'ansi_nulls', 'quoted_identifier', 'print',

  // Built-in SQL Server Functions
  'getdate', 'datediff', 'dateadd', 'datepart', 'year', 'month', 'day', 'string_agg',
  'concat', 'concat_ws', 'format', 'throw', 'raiserror', 'len', 'substring', 'replace',
  'lower', 'upper', 'ltrim', 'rtrim', 'sysdatetime', 'sysdatetimeoffset', 'sysutcdatetime',
  'current_timestamp', 'getutcdate', 'json_value', 'json_query', 'json_modify', 'isjson',
  'row_number', 'rank', 'dense_rank', 'ntile', 'lead', 'lag', 'first_value', 'last_value',
  'string_split', 'cursor_status', 'sp_executesql', 'sp_refreshsqlmodule',

  // Transactions & Try/Catch block
  'transaction', 'tran', 'commit', 'rollback', 'try', 'catch', 'error_number',
  'error_message', 'error_severity', 'error_state',

  // Control Flow
  'while', 'break', 'continue', 'goto',

  // Cursors
  'cursor', 'open', 'fetch', 'next', 'close', 'deallocate', 'fast_forward', 'read_only',
  'local', 'global', 'forward_only', 'scroll', 'static', 'keyset', 'dynamic', 'optimistic',
  'scroll_locks',

  // Trigger timings & events
  'after', 'before', 'instead', 'of', 'each', 'row', 'for'
]);

/**
 * Extract locally scoped names (variables, parameters, CTE aliases, and table aliases) from clean SQL text.
 */
export function extractLocalScopeNames(cleanSql) {
  const localNames = new Set();

  // 1. DECLARE statements (e.g. DECLARE @varname, DECLARE varname, Oracle implicit DECLARE)
  const declareMatches = cleanSql.matchAll(/\bDECLARE\s+@?([a-zA-Z0-9_]+)\b/gi);
  for (const m of declareMatches) {
    localNames.add(m[1].toLowerCase());
  }

  // 2. Stored Procedure & Function parameters
  const paramMatches = cleanSql.matchAll(/@([a-zA-Z0-9_]+)\b/g);
  for (const m of paramMatches) {
    localNames.add(m[1].toLowerCase());
  }

  // Position parameters ($1, $2) and MySQL/Oracle parameter prefixes in signatures
  // Look for arguments in the signature: CREATE FUNCTION / CREATE PROCEDURE name ( params )
  const signatureMatch = cleanSql.match(/\b(?:CREATE|ALTER)(?:\s+OR\s+REPLACE)?(?:\s+(?:EDITIONABLE|NONEDITIONABLE))?\s+(?:PROCEDURE|FUNCTION|TRIGGER)\s+[a-zA-Z0-9_.[\]]+\s*\(([^)]*)\)/i);
  if (signatureMatch) {
    const paramsText = signatureMatch[1];
    const paramList = paramsText.split(',');
    paramList.forEach(p => {
      const trimmed = p.trim();
      const parts = trimmed.replace(/\b(?:IN|OUT|INOUT)\b/gi, '').trim().split(/\s+/);
      if (parts[0]) {
        const cleanParam = cleanIdentifier(parts[0]);
        if (cleanParam) {
          localNames.add(cleanParam.toLowerCase());
        }
      }
    });
  }

  // 3. Oracle PL/SQL Variable declarations between IS/AS and BEGIN
  const declSectionMatch = cleanSql.match(/\b(?:IS|AS)\b([\s\S]*?)\bBEGIN\b/i);
  if (declSectionMatch) {
    const declText = declSectionMatch[1];
    const declarations = declText.split(';');
    declarations.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;
      
      const cursorMatch = trimmed.match(/^CURSOR\s+([a-zA-Z0-9_]+)\b/i);
      if (cursorMatch) {
        localNames.add(cursorMatch[1].toLowerCase());
        return;
      }
      
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        const varName = cleanIdentifier(parts[0]);
        if (varName && !['constant', 'cursor', 'type', 'subtype', 'exception', 'pragma'].includes(varName.toLowerCase()) && !RESERVED_KEYWORDS.has(varName.toLowerCase())) {
          localNames.add(varName.toLowerCase());
        }
      }
    });
  }

  // 4. CTE aliases defined via WITH expression AS (...)
  const withRegex = /\bWITH\s+([a-zA-Z0-9_]+)\s+AS\s*\(/gi;
  let withMatch;
  while ((withMatch = withRegex.exec(cleanSql)) !== null) {
    localNames.add(withMatch[1].toLowerCase());
  }
  const subCteRegex = /,\s*([a-zA-Z0-9_]+)\s+AS\s*\(/gi;
  while ((withMatch = subCteRegex.exec(cleanSql)) !== null) {
    localNames.add(withMatch[1].toLowerCase());
  }

  // 5. Column Aliases (e.g. column_name AS alias_name or column_name alias_name)
  const aliasMatches = cleanSql.matchAll(/\bAS\s+([a-zA-Z0-9_]+)\b/gi);
  for (const m of aliasMatches) {
    localNames.add(m[1].toLowerCase());
  }

  // 6. Table Aliases in FROM/JOIN (e.g., customers c, customers AS c, [customers] [c])
  const tableAliasMatches = cleanSql.matchAll(/\b(?:FROM|JOIN)\s+([a-zA-Z0-9_.[\]]+)(?:\s+AS)?\s+([a-zA-Z0-9_]+)\b/gi);
  for (const m of tableAliasMatches) {
    const alias = m[2].trim().toLowerCase();
    if (!RESERVED_KEYWORDS.has(alias)) {
      localNames.add(alias);
    }
  }

  return localNames;
}

/**
 * Clean and resolve schema prefix for table/view/procedure/sequence references based on declarations.
 */
export function resolveDeclaredSchema(fullRef, declaredSchemas, defaultSchema = 'dbo') {
  const parts = fullRef.split('.');
  let schema = defaultSchema;
  let name = '';

  if (parts.length > 1) {
    const rawSchema = parts[0].toLowerCase();
    schema = declaredSchemas.has(rawSchema) ? rawSchema : defaultSchema;
    name = parts[1].toLowerCase();
  } else {
    name = parts[0].toLowerCase();
  }

  return { schema, name, key: `${schema}.${name}` };
}

export function isExcludedIdentifier(token, localScopeNames, declaredSchemas, metadataRepository, objName = '') {
  const lowerToken = token.toLowerCase();
  
  // 1. Reserved Keywords or Local Scope names
  if (RESERVED_KEYWORDS.has(lowerToken) || (localScopeNames && localScopeNames.has(lowerToken))) {
    return true;
  }
  
  // 2. Declared Schemas
  if (declaredSchemas && declaredSchemas.has(lowerToken)) {
    return true;
  }
  
  // 3. Current Object Name
  if (objName && lowerToken === objName.toLowerCase()) {
    return true;
  }
  
  // 4. Declared Tables, Views, Sequences, Functions, Procedures in the migration
  if (metadataRepository) {
    const isDeclaredTable = (metadataRepository.tables && Object.keys(metadataRepository.tables).some(k => k.toLowerCase() === lowerToken || k.toLowerCase().endsWith('.' + lowerToken))) || (metadataRepository.tables && metadataRepository.tables[lowerToken]);
    const isDeclaredView = (metadataRepository.views && [...metadataRepository.views].some(k => k.toLowerCase() === lowerToken || k.toLowerCase().endsWith('.' + lowerToken))) || (metadataRepository.views && metadataRepository.views.has(lowerToken));
    const isDeclaredSeq = (metadataRepository.sequences && (metadataRepository.sequences.has(lowerToken) || [...metadataRepository.sequences].some(k => k.toLowerCase() === lowerToken || k.toLowerCase().endsWith('.' + lowerToken))));
    const isDeclaredFunc = (metadataRepository.functions && (metadataRepository.functions.has(lowerToken) || [...metadataRepository.functions].some(k => k.toLowerCase() === lowerToken || k.toLowerCase().endsWith('.' + lowerToken))));
    const isDeclaredProc = (metadataRepository.procedures && (metadataRepository.procedures.has(lowerToken) || [...metadataRepository.procedures].some(k => k.toLowerCase() === lowerToken || k.toLowerCase().endsWith('.' + lowerToken))));
    
    if (isDeclaredTable || isDeclaredView || isDeclaredSeq || isDeclaredFunc || isDeclaredProc) {
      return true;
    }
  }
  
  return false;
}

