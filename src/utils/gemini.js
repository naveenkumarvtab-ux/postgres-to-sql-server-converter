/**
 * Client-side integration with Google Gemini API for PL/pgSQL database objects
 */

export async function translatePLpgSQLWithAI({ 
  apiKey, 
  objectType, 
  objectName, 
  originalSql, 
  triggerFunctionSql = null, 
  model = 'gemini-3.1-flash-lite', 
  apiVersion = 'v1',
  sourceDialect = 'postgres',
  validationFeedback = null,
  schemaMap = null
}) {
  if (!apiKey) {
    throw new Error('Google Gemini API Key is missing. Please provide it in settings.');
  }

  // Construct Schema Mapping instructions
  let schemaMappingInstruction = '';
  if (schemaMap && Object.keys(schemaMap).length > 0) {
    const mappingsList = Object.entries(schemaMap).map(([oldS, newS]) => `'${oldS}' schema MUST be mapped to '[${newS}]'`).join(', ');
    schemaMappingInstruction = ` Rewrite all schema qualifiers to match these mapped target schemas: ${mappingsList}.`;
  }

  // Construct URL with dynamic apiVersion (v1 or v1beta)
  const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${apiKey}`;

  let sqlSection = '';
  if (sourceDialect === 'oracle') {
    sqlSection = `Original Oracle Code:
\`\`\`sql
${originalSql}
\`\`\``;
  } else if (sourceDialect === 'mysql') {
    sqlSection = `Original MySQL Code:
\`\`\`sql
${originalSql}
\`\`\``;
  } else {
    sqlSection = `Original PostgreSQL Code:
\`\`\`sql
${originalSql}
\`\`\``;

    if (objectType === 'TRIGGER' && triggerFunctionSql) {
      sqlSection = `Original PostgreSQL TRIGGER statement:
\`\`\`sql
${originalSql}
\`\`\`

Original PostgreSQL referenced FUNCTION statement (trigger logic):
\`\`\`sql
${triggerFunctionSql}
\`\`\``;
    }
  }

  let prompt = '';
  if (sourceDialect === 'oracle') {
    prompt = `You are an expert database administrator. Translate the following Oracle database object (written in PL/SQL or SQL DDL) into its exact Microsoft SQL Server (T-SQL) equivalent.

Original Oracle ${objectType} name: "${objectName}"

${sqlSection}

Ensure that:
1. No Schema Creation: Do not include CREATE SCHEMA statements in your output — assume the target schema already exists. Only output the object definition itself.
2. Idempotent Objects (CREATE OR ALTER): For Views, Functions, Procedures, and Triggers, use CREATE OR ALTER instead of CREATE or CREATE OR REPLACE (e.g. CREATE OR ALTER VIEW, CREATE OR ALTER FUNCTION, CREATE OR ALTER PROCEDURE, CREATE OR ALTER TRIGGER).
3. Error Raising & Exceptions: Convert Oracle's RAISE_APPLICATION_ERROR(error_code, msg) to T-SQL THROW.
   Note: SQL Server's THROW statement does NOT support expressions (like string concatenation) directly as parameters.
   To include dynamic values or concatenated variables in the message (e.g. using Oracle's '||' string concatenation operator like 'Employee not found: ' || p_employee_id), you MUST build the message into a local variable using string concatenation (+ and CAST as needed) on the line(s) before THROW, then pass that variable as THROW's second argument.
   * WRONG (will cause syntax error):
     -- THROW 50001, N'Employee not found: ' + CAST(@p_employee_id AS NVARCHAR(20)), 1; -- (Incorrect: THROW does not support concatenation directly)
   * RIGHT (always use this pattern for dynamic messages):
     DECLARE @ErrorMessage NVARCHAR(2048) = N'Employee not found: ' + CAST(@p_employee_id AS NVARCHAR(20));
     THROW 50001, @ErrorMessage, 1;
   Since SQL Server functions cannot use THROW/RAISERROR, if a function raises custom exceptions, rewrite it as a stored procedure and add a warning comment block.
4. NVL and NVL2: Map NVL(a, b) to ISNULL(a, b) or COALESCE(a, b). Map NVL2(a, b, c) to CASE WHEN a IS NOT NULL THEN b ELSE c END.
5. DECODE Conversion: Map DECODE(expr, val1, res1, val2, res2, ..., default) to an equivalent CASE expression: CASE expr WHEN val1 THEN res1 WHEN val2 THEN res2 ELSE default END.
6. SYSDATE Conversion: Map SYSDATE to GETDATE() or CURRENT_TIMESTAMP.
7. DUAL Table: Strip "FROM DUAL" clauses entirely. T-SQL does not require a dummy table for selecting constant values or evaluating functions.
8. ROWNUM Conversion: Map ROWNUM conditions to ROW_NUMBER() OVER (...) or TOP depending on query logic.
9. CONNECT BY / START WITH: Map hierarchical/recursive queries to recursive CTEs (Common Table Expressions) in T-SQL.
10. Identity Columns: Map Oracle 12c+ identity columns (GENERATED ALWAYS AS IDENTITY) to T-SQL IDENTITY(1,1).
11. Triggers timing, column scoping, and bind virtuals:
    - Timing & Comments: SQL Server does not support BEFORE triggers. If the Oracle trigger is BEFORE and used for validation/prevention, add a comment noting this timing change and use AFTER or INSTEAD OF (the closer match for write prevention). Flag the timing change explicitly.
    - Column Scoping: If the trigger is column-scoped (e.g. UPDATE OF salary), wrap the trigger logic inside an IF UPDATE(column) check (e.g. IF UPDATE([salary]) BEGIN ... END) so the trigger only executes when that specific column is modified, rather than being table-wide.
    - Bind Virtuals: Map trigger bind variables :NEW and :OLD to T-SQL virtual tables inserted and deleted. Ensure trigger logic is set-based.
12. Sequences (.NEXTVAL): Map sequence usages seq_name.NEXTVAL to NEXT VALUE FOR [seq_name].
13. Packages Namespacing: If the object was originally member of a package, prefix references to package state variables or other package procedures with explanatory warning comments. Declare the object name exactly as "${objectName}".
14. SQL Server Function Constraints: SQL Server functions (scalar/table-valued) are highly restricted and CANNOT use THROW, TRY/CATCH blocks, transactions, or state-modifying actions (INSERT/UPDATE/DELETE). Rewrite functions violating these constraints as stored procedures.
15. Identifier Wrapping & Schema mapping: Wrap EVERY schema, table, view, function, procedure, trigger, and column identifier in square brackets consistently — e.g. [schema].[name] or [table].[column], never schema.name.${schemaMappingInstruction}
16. Batch Ending: End every CREATE VIEW / CREATE FUNCTION / CREATE PROCEDURE / CREATE TRIGGER object with GO on its own line immediately after the closing END or semicolon, since these must be the only statement in their batch in SQL Server. This is mandatory.
17. Implicit Exceptions (NO_DATA_FOUND): When translating Oracle PL/SQL blocks containing SELECT ... INTO, detect if zero rows are returned by checking IF @@ROWCOUNT = 0 right after the query. If the original block had a separate EXCEPTION WHEN NO_DATA_FOUND handler (raising a distinct error code/message), preserve both the implicit not-found path (via @@ROWCOUNT check) and any explicit NULL-value check as separate, distinctly-messaged conditions. Do not merge them into one generic check without at minimum a comment explaining the simplification.
18. MONTHS_BETWEEN Conversion: When converting Oracle MONTHS_BETWEEN(date1, date2) to T-SQL, map it to DATEDIFF(MONTH, date2, date1) and you MUST add this warning comment block directly above it:
    -- NOTE: approximates Oracle MONTHS_BETWEEN; DATEDIFF(MONTH,...) 
    -- counts calendar month boundaries only and does not include 
    -- Oracle's fractional day-based precision.
19. Global Temporary Tables (GTT): When converting an Oracle CREATE GLOBAL TEMPORARY TABLE, translate it to a SQL Server local temporary table pattern using the '#' prefix on the table name (e.g., CREATE TABLE #[table_name]). You MUST include the following comment block directly above the table definition:
    -- NOTE: Converted from Oracle GLOBAL TEMPORARY TABLE.
    -- Oracle GTT definitions are permanent/schema-level with session-scoped data;
    -- SQL Server local temp tables (#TableName) don't persist independently of the session that creates them.
20. Anonymous PL/SQL Blocks: If translating a standalone anonymous PL/SQL block (starts with DECLARE or BEGIN, not part of a function/procedure), convert it to a plain T-SQL batch (using BEGIN...END). You MUST convert DBMS_OUTPUT.PUT_LINE('text') to PRINT 'text' or PRINT @variable.
21. Empty String vs NULL Handling: Oracle treats empty strings ('') as NULL. In SQL Server, they are distinct. When translating Oracle DDL or queries containing IS NULL checks on character/string columns (e.g. notes IS NULL), auto-fix this by converting it to check both NULL and empty string: (notes IS NULL OR notes = ''). Apply this auto-fix directly rather than only flagging it.
22. Return ONLY the valid T-SQL script. DO NOT wrap the code in markdown code blocks (such as \`\`\`sql ... \`\`\`). Do not include any introductory or concluding text. Your entire response must be direct, executable T-SQL code.`;
  } else if (sourceDialect === 'mysql') {
    prompt = `You are an expert database administrator. Translate the following MySQL database object (written in MySQL DDL, stored procedure, function, or trigger logic) into its exact Microsoft SQL Server (T-SQL) equivalent.

Original MySQL ${objectType} name: "${objectName}"

${sqlSection}

Ensure that:
1. No Schema Creation: Do not include CREATE SCHEMA statements in your output — assume the target schema already exists. Only output the object definition itself.
2. Idempotent Objects (CREATE OR ALTER): For Views, Functions, Procedures, and Triggers, use CREATE OR ALTER instead of CREATE or CREATE OR REPLACE (e.g. CREATE OR ALTER VIEW, CREATE OR ALTER FUNCTION, CREATE OR ALTER PROCEDURE, CREATE OR ALTER TRIGGER).
3. Error Raising & Exceptions: Convert MySQL's SIGNAL SQLSTATE 'code' SET MESSAGE_TEXT = msg to T-SQL THROW.
   Note: SQL Server's THROW statement does NOT support expressions (like string concatenation) directly as parameters.
   To include dynamic values or concatenated variables in the message (e.g., using MySQL's CONCAT or '||' string concatenation), you MUST build the message into a local variable using string concatenation (+ and CAST as needed) on the line(s) before THROW, then pass that variable as THROW's second argument.
   * WRONG (will cause syntax error):
     -- THROW 50001, N'Employee not found: ' + CAST(@p_employee_id AS NVARCHAR(20)), 1; -- (Incorrect: THROW does not support concatenation directly)
   * RIGHT (always use this pattern for dynamic messages):
     DECLARE @ErrorMessage NVARCHAR(2048) = N'Employee not found: ' + CAST(@p_employee_id AS NVARCHAR(20));
     THROW 50001, @ErrorMessage, 1;
   Since SQL Server functions cannot use THROW/RAISERROR, if a function raises custom exceptions, rewrite it as a stored procedure and add a warning comment block.
4. IFNULL and COALESCE: Map IFNULL(a, b) to ISNULL(a, b) or COALESCE(a, b).
5. NOW and CURDATE: Map NOW() to GETDATE(). Map CURDATE() to CAST(GETDATE() AS DATE).
6. DATE_ADD Conversion: Map DATE_ADD(date, INTERVAL n unit) to DATEADD(unit, n, date). Translate units (DAY -> DAY, MONTH -> MONTH, YEAR -> YEAR, HOUR -> HOUR, MINUTE -> MINUTE, SECOND -> SECOND).
7. DATEDIFF Conversion: MySQL DATEDIFF(date1, date2) computes (date1 - date2) in whole days. SQL Server DATEDIFF(unit, date2, date1) requires a unit and flips the argument order! Map MySQL DATEDIFF(date1, date2) to T-SQL DATEDIFF(DAY, date2, date1). You must flip the dates and insert DAY.
8. STR_TO_DATE & DATE_FORMAT: Map STR_TO_DATE(text, format) to TRY_CONVERT/PARSE. Map DATE_FORMAT(date, format) to FORMAT(date, 'dotnet-format') or CONVERT. Translate MySQL format tokens (%Y -> yyyy, %m -> MM, %d -> dd, %H -> HH, %i -> mm, %s -> ss) to appropriate SQL Server styles or format string.
9. String Concatenation: Map CONCAT(a, b, ...) and CONCAT_WS(sep, a, b, ...) to their native T-SQL 2017+ equivalents directly (which have the same name and signatures).
10. GROUP_CONCAT Conversion: Map GROUP_CONCAT(col SEPARATOR 'delim') to STRING_AGG(col, 'delim'). If the GROUP_CONCAT uses ORDER BY, map to STRING_AGG(col, 'delim') WITHIN GROUP (ORDER BY ...).
11. LIMIT/OFFSET paging: Map LIMIT n [OFFSET m] to TOP (n) for simple limits, or OFFSET m ROWS FETCH NEXT n ROWS ONLY for paging.
12. Identifier Quotes: Map MySQL backtick-quoted identifiers (\`table_name\`) to bracket-quoted identifiers ([table_name]) consistently.
13. INSERT ... ON DUPLICATE KEY UPDATE: Translate to a T-SQL MERGE statement:
    MERGE INTO [target] USING [source] ON ... WHEN MATCHED THEN UPDATE SET ... WHEN NOT MATCHED THEN INSERT ...
14. REPLACE INTO: Maps to T-SQL MERGE, but flag the subtle difference: REPLACE INTO deletes and re-inserts the entire row (resetting unspecified columns to defaults), whereas ON DUPLICATE KEY UPDATE only updates the specified columns.
15. OUT/INOUT Parameters: Map MySQL routine parameters defined as OUT/INOUT to T-SQL OUTPUT parameters.
16. BEFORE/AFTER Triggers: SQL Server does not support BEFORE triggers. If the trigger is BEFORE, add a warning comment and change it to AFTER or INSTEAD OF. Map OLD/NEW trigger bind variables to deleted/inserted virtual tables. Ensure trigger logic is set-based.
17. Batch Ending: End every CREATE VIEW / CREATE FUNCTION / CREATE PROCEDURE / CREATE TRIGGER object with GO on its own line immediately after the closing END or semicolon.
18. CTE (Common Table Expression) Conversion:
    * Remove the MySQL RECURSIVE keyword from WITH RECURSIVE (e.g. WITH RECURSIVE tree AS ... becomes WITH tree AS ...).
    * For recursive CTEs, preserve the anchor query, recursive query, UNION ALL, and joins.
    * Append OPTION (MAXRECURSION 100) at the end of the query using the recursive CTE.
    * Support all CTE styles (Simple, Multiple, Recursive, Window function, Aggregate, or DML CTE usage like INSERT/UPDATE/DELETE using CTE).
    * Schema qualify all physical tables (excluding temp tables and CTE names) with [dbo] or mapped schema prefix (e.g. FROM customers becomes FROM [dbo].[customers], UPDATE customers becomes UPDATE [dbo].[customers]).
19. Return ONLY the valid T-SQL script. DO NOT wrap the code in markdown code blocks (such as \`\`\`sql ... \`\`\`). Do not include any introductory or concluding text. Your entire response must be direct, executable T-SQL code.`;
  } else {
    prompt = `You are an expert database administrator. Translate the following PostgreSQL database object (written in PL/pgSQL or SQL) into its exact Microsoft SQL Server (T-SQL) equivalent.

Original PostgreSQL ${objectType} name: "${objectName}"

${sqlSection}

Ensure that:
1. No Schema Creation: Do not include CREATE SCHEMA statements in your output — assume the target schema already exists. Only output the object definition itself.
2. Idempotent Objects (CREATE OR ALTER): For Views, Functions, Procedures, and Triggers, use CREATE OR ALTER instead of CREATE or CREATE OR REPLACE (e.g. CREATE OR ALTER VIEW, CREATE OR ALTER FUNCTION, CREATE OR ALTER PROCEDURE, CREATE OR ALTER TRIGGER).
3. Error Raising & Dynamic Values: Use THROW (not RAISERROR) for raising custom errors inside procedures/triggers.
   Note: SQL Server's THROW statement does NOT support expressions (like string concatenation) directly as parameters.
   To include dynamic values or concatenated variables in the message, you MUST build the message into a local variable using string concatenation (+ and CAST as needed) on the line(s) before THROW, then pass that variable as THROW's second argument.
   * WRONG (will cause syntax error):
     -- THROW 50001, N'Order not found: ' + CAST(@p_order_id AS NVARCHAR(20)), 1; -- (Incorrect: THROW does not support concatenation directly)
   * RIGHT (always use this pattern for dynamic messages):
     DECLARE @ErrorMessage NVARCHAR(2048) = N'Order not found: ' + CAST(@p_order_id AS NVARCHAR(20));
     THROW 50001, @ErrorMessage, 1;
4. SQL Server Function Constraints: SQL Server functions (scalar/table-valued) are highly restricted and CANNOT use THROW, RAISERROR, TRY/CATCH blocks, transactions (BEGIN TRAN/COMMIT), dynamic SQL, or perform state-modifying actions (INSERT/UPDATE/DELETE). If the original function does any of these, rewrite it using safe table-valued mappings, return status codes, or convert it to a SQL Server STORED PROCEDURE instead and add a warning comment block (-- WARNING: Converted to Stored Procedure due to side-effects/exception handling).
5. Identifier Wrapping & Schema mapping: Wrap EVERY schema, table, view, function, procedure, trigger, and column identifier in square brackets consistently — e.g. [schema].[name] or [table].[column], never schema.name. Map the schemas consistently across all statements based on this mapping: ${schemaMappingInstruction || 'Map public to dbo'}.
6. Merged Triggers (Rule 8): If a PostgreSQL trigger function (RETURNS TRIGGER) and its CREATE TRIGGER statement are provided together as one merged unit, produce exactly ONE CREATE OR ALTER TRIGGER statement in T-SQL — combine the trigger's timing/events with the function's body logic. Use the inserted/deleted virtual tables in place of NEW/OLD. Do not produce a separate function or procedure object for trigger logic. Ensure the trigger logic is set-based (query [inserted] and [deleted] tables, rather than assuming single-row execution via FOR EACH ROW which is unsupported).
7. TO_DATE Conversion: Map TO_DATE(expr, 'format') to TRY_CONVERT(DATE, expr, style_code) based on the format: 'YYYY-MM-DD' -> style 120, 'YYYY/MM/DD' -> style 111, 'DD/MM/YYYY' -> style 103, 'MM/DD/YYYY' -> style 101, 'DD-MM-YYYY' -> style 105, 'MM-DD-YYYY' -> style 110, 'YYYymmdd' -> style 112. If dynamic or CASE formats are used, e.g. TO_DATE(expr, CASE WHEN cond1 THEN 'fmt1' ELSE 'fmt2' END), rewrite it as: CASE WHEN cond1 THEN TRY_CONVERT(DATE, expr, style1) ELSE TRY_CONVERT(DATE, expr, style2) END.
8. AGE() and DATE_PART('year', AGE()) Conversion: Rewrite AGE(dob) and AGE(now(), dob) using exact, boundary-safe age calculation: CASE WHEN DATEADD(YEAR, DATEDIFF(YEAR, DOB, GETDATE()), DOB) > GETDATE() THEN DATEDIFF(YEAR, DOB, GETDATE()) - 1 ELSE DATEDIFF(YEAR, DOB, GETDATE()) END. Use this calculation automatically for AGE() and DATE_PART('year', AGE()) or EXTRACT(YEAR FROM AGE()).
9. DATE_TRUNC Conversion: Map DATE_TRUNC('month', expr) to DATEADD(month, DATEDIFF(month, 0, expr), 0). If followed by interval year/month addition and day subtraction, e.g. DATE_TRUNC('month', date + interval '1 year') - interval '1 day', rewrite using EOMONTH(DATEADD(year, 1, date), -1). Support 'year', 'month', 'day', 'week', 'quarter' units with equivalent DATEADD/DATEDIFF or CONVERT(DATE, expr) expressions.
10. CALL Conversion: Rewrite CALL procedure(arg1, arg2) to EXEC [schema].[procedure] @Param1=arg1, @Param2=arg2; keeping arguments named and schema-qualified.
11. Batch Ending (Rule 11): End every CREATE VIEW / CREATE FUNCTION / CREATE PROCEDURE / CREATE TRIGGER object with GO on its own line immediately after the closing END or semicolon, since these must be the only statement in their batch in SQL Server. This is mandatory.
12. All PostgreSQL-specific functions, control flows, and syntax are fully rewritten in T-SQL (e.g. use ISNULL/COALESCE, BEGIN...END, DECLARE for variables, SET, convert PL/pgSQL loops, cursors, string concatenations).
13. Preserve the original logic, behavior, names, and types.
14. If there are features that cannot be cleanly translated to T-SQL (e.g. Postgres arrays, enums, specific regex functions, external extensions), write a visible T-SQL comment block (-- WARNING: [Explanation]) inside the code right where the issue occurs to alert the user.
15. Return ONLY the valid T-SQL script. DO NOT wrap the code in markdown code blocks (such as \`\`\`sql ... \`\`\`). Do not include any introductory or concluding text. Your entire response must be direct, executable T-SQL code.`;
  }

  if (validationFeedback) {
    prompt += `\n\n⚠️ IMPORTANT: Your previous translation attempt failed validation check with the following error(s):\n${validationFeedback}\n\nPlease regenerate the T-SQL code, ensuring you address and fix all the errors listed above.`;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.1
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.error?.message || `HTTP error! status: ${response.status}`;
      
      // Attempt 1 Failure Check: If v1 failed, retry with v1beta endpoint
      if (apiVersion === 'v1') {
        console.warn(`v1 call failed for model "${model}" (${errorMessage}). Retrying with "v1beta" API version...`);
        return translatePLpgSQLWithAI({
          apiKey,
          objectType,
          objectName,
          originalSql,
          triggerFunctionSql,
          model,
          apiVersion: 'v1beta',
          sourceDialect,
          validationFeedback
        });
      }
      
      // Attempt 2 Failure Check: If v1beta failed and we were not using gemini-3.1-flash-lite, retry with gemini-3.1-flash-lite on v1
      if (model !== 'gemini-3.1-flash-lite') {
        console.warn(`Model "${model}" failed. Automatically falling back to "gemini-3.1-flash-lite" on v1 API...`);
        return translatePLpgSQLWithAI({
          apiKey,
          objectType,
          objectName,
          originalSql,
          triggerFunctionSql,
          model: 'gemini-3.1-flash-lite',
          apiVersion: 'v1',
          sourceDialect,
          validationFeedback
        });
      }
      
      throw new Error(errorMessage);
    }

    const data = await response.json();
    let translatedSql = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!translatedSql) {
      throw new Error('Gemini returned an empty response. Verify your API Key or try again.');
    }

    // Clean up any markdown code blocks the model might have returned despite instructions
    translatedSql = translatedSql.trim();
    if (translatedSql.startsWith('```')) {
      // Strip ```sql and ``` lines
      translatedSql = translatedSql.replace(/^```(sql|tsql)?\n/i, '');
      translatedSql = translatedSql.replace(/\n```$/g, '');
    }

    return translatedSql.trim();
  } catch (error) {
    console.error('Gemini translation error:', error);
    throw error;
  }
}
