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
      WHERE is_ambiguous = 0 
        AND referenced_id IS NULL 
        AND referenced_entity_name NOT IN ('inserted', 'deleted')
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
    triggers: 0,
    constraints: 0,
    indexes: 0
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

    // Constraints & Keys count (all foreign keys)
    const fkResult = await pool.request().query(`
      SELECT COUNT(*) as cnt FROM sys.foreign_keys
    `);
    counts.constraints = fkResult.recordset[0].cnt;

    // Indexes count (excluding PK and Unique Constraint indexes)
    const idxResult = await pool.request().query(`
      SELECT COUNT(*) as cnt
      FROM sys.indexes i
      JOIN sys.tables t ON i.object_id = t.object_id
      WHERE i.index_id > 0 
        AND i.is_primary_key = 0 
        AND i.is_unique_constraint = 0
        AND i.name IS NOT NULL
    `);
    counts.indexes = idxResult.recordset[0].cnt;

  } catch (err) {
    console.error('Error getting object counts', err);
  }
  
  return counts;
};

const getDeployedObjectsList = async (pool, dbName) => {
  await pool.request().query(`USE [${dbName}]`);
  
  const schemas = [];
  const tables = [];
  const views = [];
  const procedures = [];
  const functions = [];
  const triggers = [];
  const constraints = [];
  const indexes = [];
  
  try {
    // Schemas
    const schs = await pool.request().query(`
      SELECT name FROM sys.schemas
    `);
    schs.recordset.forEach(r => schemas.push({ name: r.name }));

    // Tables
    const tbls = await pool.request().query(`
      SELECT s.name AS SchemaName, t.name AS TableName 
      FROM sys.tables t 
      JOIN sys.schemas s ON t.schema_id = s.schema_id
    `);
    tbls.recordset.forEach(r => tables.push({ schema: r.SchemaName, name: r.TableName }));
    
    // Views
    const vws = await pool.request().query(`
      SELECT s.name AS SchemaName, v.name AS ViewName 
      FROM sys.views v 
      JOIN sys.schemas s ON v.schema_id = s.schema_id
    `);
    vws.recordset.forEach(r => views.push({ schema: r.SchemaName, name: r.ViewName }));
    
    // Procedures
    const procs = await pool.request().query(`
      SELECT s.name AS SchemaName, p.name AS ProcedureName 
      FROM sys.procedures p 
      JOIN sys.schemas s ON p.schema_id = s.schema_id
    `);
    procs.recordset.forEach(r => procedures.push({ schema: r.SchemaName, name: r.ProcedureName }));
    
    // Functions
    const funcs = await pool.request().query(`
      SELECT s.name AS SchemaName, o.name AS FunctionName 
      FROM sys.objects o 
      JOIN sys.schemas s ON o.schema_id = s.schema_id 
      WHERE o.type IN ('FN', 'IF', 'TF')
    `);
    funcs.recordset.forEach(r => functions.push({ schema: r.SchemaName, name: r.FunctionName }));
    
    // Triggers
    const trgs = await pool.request().query(`
      SELECT s.name AS SchemaName, t.name AS TriggerName 
      FROM sys.triggers t 
      JOIN sys.objects o ON t.parent_id = o.object_id 
      JOIN sys.schemas s ON o.schema_id = s.schema_id
    `);
    trgs.recordset.forEach(r => triggers.push({ schema: r.SchemaName, name: r.TriggerName }));

    // Constraints (all foreign keys)
    const fks = await pool.request().query(`
      SELECT s.name AS SchemaName, f.name AS ConstraintName
      FROM sys.foreign_keys f
      JOIN sys.schemas s ON f.schema_id = s.schema_id
    `);
    fks.recordset.forEach(r => constraints.push({ schema: r.SchemaName, name: r.ConstraintName }));
    
    // Indexes (excluding PK and UQ indexes)
    const idxs = await pool.request().query(`
      SELECT s.name AS SchemaName, t.name AS TableName, i.name AS IndexName
      FROM sys.indexes i
      JOIN sys.tables t ON i.object_id = t.object_id
      JOIN sys.schemas s ON t.schema_id = s.schema_id
      WHERE i.index_id > 0 
        AND i.is_primary_key = 0 
        AND i.is_unique_constraint = 0
        AND i.name IS NOT NULL
    `);
    idxs.recordset.forEach(r => indexes.push({ schema: r.SchemaName, name: r.IndexName, tableName: r.TableName }));
    
  } catch (err) {
    console.error('Error fetching deployed objects list:', err);
  }
  
  return {
    schemas,
    tables,
    views,
    procedures,
    functions,
    triggers,
    constraints,
    indexes
  };
};

const runAllValidations = async (pool, dbName) => {
  const compilationErrors = await validateCompilation(pool, dbName);
  const unresolvedDependencies = await checkUnresolvedReferences(pool, dbName);
  const objectCounts = await getObjectCounts(pool, dbName);
  const deployedObjects = await getDeployedObjectsList(pool, dbName);
  
  const passed = compilationErrors.length === 0 && unresolvedDependencies.length === 0;
  
  return {
    compilationErrors,
    unresolvedDependencies,
    objectCounts,
    deployedObjects,
    passed
  };
};

module.exports = {
  validateCompilation,
  checkUnresolvedReferences,
  getObjectCounts,
  getDeployedObjectsList,
  runAllValidations
};
