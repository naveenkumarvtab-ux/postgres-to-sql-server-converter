const createDisposableDatabase = async (pool, dbName, compatLevel = 150) => {
  try {
    // Drop if exists
    await dropDisposableDatabase(pool, dbName);
    
    // Create DB
    await pool.request().query(`CREATE DATABASE [${dbName}]`);
    
    // Set Compat level
    await pool.request().query(`ALTER DATABASE [${dbName}] SET COMPATIBILITY_LEVEL = ${compatLevel}`);
    
    return true;
  } catch (err) {
    console.error(`Error creating database ${dbName}`, err);
    throw err;
  }
};

const dropDisposableDatabase = async (pool, dbName) => {
  try {
    await pool.request().query(`
      IF DB_ID('${dbName}') IS NOT NULL
      BEGIN
        ALTER DATABASE [${dbName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
        DROP DATABASE [${dbName}];
      END
    `);
    return true;
  } catch (err) {
    console.error(`Error dropping database ${dbName}`, err);
    throw err;
  }
};

const objectTypeOrder = [
  'SCHEMA', 'SEQUENCE', 'ENUM', 'DOMAIN', 'TABLE', 
  'CONSTRAINT', 'INDEX', 'VIEW', 'FUNCTION', 'PROCEDURE', 'TRIGGER'
];

const sortObjects = (objects) => {
  return [...objects].sort((a, b) => {
    const typeA = a.classified?.type || '';
    const typeB = b.classified?.type || '';
    
    let indexA = objectTypeOrder.indexOf(typeA.toUpperCase());
    let indexB = objectTypeOrder.indexOf(typeB.toUpperCase());
    
    if (indexA === -1) indexA = 999;
    if (indexB === -1) indexB = 999;
    
    return indexA - indexB;
  });
};

const deployObjects = async (pool, dbName, objects, onProgress) => {
  const sortedObjects = sortObjects(objects);
  const total = sortedObjects.length;
  let current = 0;
  const errors = [];
  
  // Use the newly created db for subsequent queries
  await pool.request().query(`USE [${dbName}]`);
  
  for (const obj of sortedObjects) {
    current++;
    const type = obj.classified?.type || 'UNKNOWN';
    const name = obj.classified?.name || 'Unknown Object';
    const tsql = obj.translation?.tsql;
    
    if (!tsql) {
      if (onProgress) {
        onProgress({ object: obj, objectType: type, status: 'skipped', error: 'No T-SQL translation', current, total });
      }
      continue;
    }
    
    try {
      const batches = tsql.split(/^\s*GO\s*$/gim).map(b => b.trim()).filter(b => b.length > 0);
      for (const batch of batches) {
        await pool.request().query(batch);
      }
      if (onProgress) {
        onProgress({ object: obj, objectType: type, status: 'success', current, total });
      }
    } catch (err) {
      errors.push({ object: name, objectType: type, error: err.message });
      if (onProgress) {
        onProgress({ object: obj, objectType: type, status: 'error', error: err.message, current, total });
      }
      // Continue deploying remaining objects instead of aborting
    }
  }
  
  return { totalDeployed: total - errors.length, totalErrors: errors.length, errors };
};

module.exports = {
  createDisposableDatabase,
  dropDisposableDatabase,
  deployObjects
};
