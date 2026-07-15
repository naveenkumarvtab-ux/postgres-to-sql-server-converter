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
  apiVersion = 'v1' 
}) {
  if (!apiKey) {
    throw new Error('Google Gemini API Key is missing. Please provide it in settings.');
  }

  // Construct URL with dynamic apiVersion (v1 or v1beta)
  const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${apiKey}`;

  let sqlSection = `Original PostgreSQL Code:
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

  const prompt = `You are an expert database administrator. Translate the following PostgreSQL database object (written in PL/pgSQL or SQL) into its exact Microsoft SQL Server (T-SQL) equivalent.

Original PostgreSQL ${objectType} name: "${objectName}"

${sqlSection}

Ensure that:
1. No Schema Creation: Do not include CREATE SCHEMA statements in your output — assume the target schema already exists. Only output the object definition itself.
2. Idempotent Objects (CREATE OR ALTER): For Views, Functions, Procedures, and Triggers, use CREATE OR ALTER instead of CREATE or CREATE OR REPLACE (e.g. CREATE OR ALTER VIEW, CREATE OR ALTER FUNCTION, CREATE OR ALTER PROCEDURE, CREATE OR ALTER TRIGGER).
3. Error Raising & Dynamic Values: Use THROW (not RAISERROR) for raising custom errors inside procedures/triggers, unless printf-style formatting is genuinely required. THROW syntax: THROW <error_number>, N'<message>', <state>; error numbers must be 50000 or higher. Preserve dynamic values (like parameters and variables, e.g., @p_order_id or p_order_id) in THROW/error messages exactly as they appeared in the original PostgreSQL RAISE EXCEPTION message — do not drop parameter interpolation or string concatenation.
4. SQL Server Function Constraints: SQL Server functions (scalar/table-valued) are highly restricted and CANNOT use THROW, RAISERROR, TRY/CATCH blocks, transactions (BEGIN TRAN/COMMIT), dynamic SQL, or perform state-modifying actions (INSERT/UPDATE/DELETE). If the original function does any of these, rewrite it using safe table-valued mappings, return status codes, or convert it to a SQL Server STORED PROCEDURE instead and add a warning comment block (-- WARNING: Converted to Stored Procedure due to side-effects/exception handling).
5. Identifier Wrapping & Schema mapping: Wrap EVERY schema, table, view, function, procedure, trigger, and column identifier in square brackets consistently — e.g. [schema].[name] or [table].[column], never schema.name. Map the PostgreSQL "public" schema to "dbo" consistently across all statements (e.g. public.orders -> [dbo].[orders]).
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
          apiVersion: 'v1beta'
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
          apiVersion: 'v1'
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
