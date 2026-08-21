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

function sortTopologically(list, allObjects) {
  const result = [];
  const visited = new Set();
  const visiting = new Set();

  function visit(obj) {
    if (!obj.classified?.id) return;
    if (visited.has(obj.classified.id)) return;
    if (visiting.has(obj.classified.id)) {
      console.warn(`Circular dependency detected: Object '${obj.classified.name}' is part of a dependency loop.`);
      return;
    }
    visiting.add(obj.classified.id);

    const rawTextLower = (obj.translation?.tsql || obj.classified?.raw || '').toLowerCase();
    allObjects.forEach(other => {
      if (!other.classified?.id) return;
      if (other.classified.id === obj.classified.id) return;
      const otherType = (other.classified.type || '').toUpperCase();
      if (['DATA', 'INDEX', 'CONSTRAINT', 'OTHER'].includes(otherType)) {
        return;
      }
      const otherName = other.classified.name.toLowerCase();
      const escapedName = otherName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escapedName}\\b`, 'i');

      if (regex.test(rawTextLower)) {
        visit(other);
      }
    });

    visiting.delete(obj.classified.id);
    visited.add(obj.classified.id);
    if (list.some(o => o.classified?.id === obj.classified.id)) {
      result.push(obj);
    }
  }

  list.forEach(obj => visit(obj));
  list.forEach(obj => {
    if (obj.classified?.id && !result.some(r => r.classified?.id === obj.classified.id)) {
      result.push(obj);
    }
  });
  return result;
}

const sortObjects = (objects) => {
  const routinesTypes = ['VIEW', 'FUNCTION', 'PROCEDURE', 'TRIGGER'];
  
  const nonRoutines = objects.filter(o => !routinesTypes.includes((o.classified?.type || '').toUpperCase()));
  const routines = objects.filter(o => routinesTypes.includes((o.classified?.type || '').toUpperCase()));
  
  const sortedNonRoutines = [...nonRoutines].sort((a, b) => {
    const typeA = a.classified?.type || '';
    const typeB = b.classified?.type || '';
    
    let indexA = objectTypeOrder.indexOf(typeA.toUpperCase());
    let indexB = objectTypeOrder.indexOf(typeB.toUpperCase());
    
    if (indexA === -1) indexA = 999;
    if (indexB === -1) indexB = 999;
    
    return indexA - indexB;
  });
  
  const sortedRoutines = sortTopologically(routines, objects);
  
  return [...sortedNonRoutines, ...sortedRoutines];
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
      const schema = obj.classified?.schema || 'dbo';
      if (schema.toLowerCase() !== 'dbo' && schema.toLowerCase() !== 'sys' && schema.toLowerCase() !== 'public') {
        await pool.request().query(`
          IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = '${schema}')
          BEGIN
            EXEC('CREATE SCHEMA [${schema}]')
          END
        `);
      }
      const batches = tsql.split(/^\s*GO\s*$/gim).map(b => b.trim()).filter(b => b.length > 0);
      for (const batch of batches) {
        await pool.request().query(batch);
      }
      if (onProgress) {
        onProgress({ object: obj, objectType: type, status: 'success', current, total });
      }
    } catch (err) {
      console.error(`DEPLOYMENT FAILURE for ${type} '${name}':`, err.message);
      console.error(`FAILED T-SQL:\n${tsql}\n`);
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
