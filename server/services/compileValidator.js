const validateCompilation = async (pool, dbName) => {
  await pool.request().query(`USE [${dbName}]`);
  
  const compilationErrors = [];
  
  try {
    const modulesResult = await pool.request().query(`
      SELECT o.name, o.type_desc, s.name as schema_name
      FROM sys.sql_modules m
      INNER JOIN sys.objects o ON m.object_id = o.object_id
      INNER JOIN sys.schemas s ON o.schema_id = s.schema_id
    `);
    
    for (const row of modulesResult.recordset) {
      const fullObjectName = `[${row.schema_name}].[${row.name}]`;
      try {
        await pool.request().query(`EXEC sp_refreshsqlmodule '${fullObjectName}'`);
      } catch (err) {
        compilationErrors.push({
          object: fullObjectName,
          type: row.type_desc,
          error: err.message
        });
      }
    }
  } catch (err) {
    console.error('Error validating compilation', err);
  }
  
  return compilationErrors;
};

const checkUnresolvedReferences = async (pool, dbName) => {
  await pool.request().query(`USE [${dbName}]`);
  
  try {
    const depsResult = await pool.request().query(`
      SELECT 
        OBJECT_NAME(referencing_id) as referencing_object,
        referenced_entity_name as missing_reference
      FROM sys.sql_expression_dependencies
      WHERE is_ambiguous = 0 AND referenced_id IS NULL
    `);
    
    return depsResult.recordset;
  } catch (err) {
    console.error('Error checking dependencies', err);
    return [];
  }
};

const getObjectCounts = async (pool, dbName) => {
  await pool.request().query(`USE [${dbName}]`);
  
  const counts = {
    tables: 0,
    views: 0,
    procedures: 0,
    functions: 0,
    triggers: 0
  };
  
  try {
    const result = await pool.request().query(`
      SELECT type, COUNT(*) as cnt
      FROM sys.objects
      WHERE is_ms_shipped = 0
      GROUP BY type
    `);
    
    for (const row of result.recordset) {
      const type = row.type.trim();
      if (type === 'U') counts.tables += row.cnt;
      if (type === 'V') counts.views += row.cnt;
      if (type === 'P') counts.procedures += row.cnt;
      if (['FN', 'IF', 'TF'].includes(type)) counts.functions += row.cnt;
      if (type === 'TR') counts.triggers += row.cnt;
    }
  } catch (err) {
    console.error('Error getting object counts', err);
  }
  
  return counts;
};

const runAllValidations = async (pool, dbName) => {
  const compilationErrors = await validateCompilation(pool, dbName);
  const unresolvedDependencies = await checkUnresolvedReferences(pool, dbName);
  const objectCounts = await getObjectCounts(pool, dbName);
  
  const passed = compilationErrors.length === 0 && unresolvedDependencies.length === 0;
  
  return {
    compilationErrors,
    unresolvedDependencies,
    objectCounts,
    passed
  };
};

module.exports = {
  validateCompilation,
  checkUnresolvedReferences,
  getObjectCounts,
  runAllValidations
};
