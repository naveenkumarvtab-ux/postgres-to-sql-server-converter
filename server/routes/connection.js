const express = require('express');
const { testConnection, getPool } = require('../config/database');

const router = express.Router();

router.post('/test', async (req, res) => {
  const { server, authMode, username, password } = req.body;
  
  const config = {
    server: server || 'localhost',
    database: 'master',
    options: {
      trustedConnection: authMode !== 'sql',
      trustServerCertificate: true
    }
  };
  
  if (authMode === 'sql') {
    config.user = username;
    config.password = password;
  }
  
  try {
    const result = await testConnection(config);
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/status', async (req, res) => {
  try {
    const pool = await getPool();
    if (pool && pool.connected) {
      res.json({ status: 'connected' });
    } else {
      res.json({ status: 'disconnected' });
    }
  } catch (err) {
    res.json({ status: 'error', error: err.message });
  }
});

router.post('/cleanup-all', async (req, res) => {
  try {
    const pool = await getPool();
    const dbsResult = await pool.request().query(`
      SELECT name 
      FROM sys.databases 
      WHERE name LIKE 'Migration[_]%'
    `);
    const dbs = dbsResult.recordset.map(r => r.name);
    
    let droppedCount = 0;
    for (const dbName of dbs) {
      try {
        await pool.request().query(`
          IF DB_ID('${dbName}') IS NOT NULL
          BEGIN
            ALTER DATABASE [${dbName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
            DROP DATABASE [${dbName}];
          END
        `);
        droppedCount++;
      } catch (err) {
        console.error(`Failed to drop database ${dbName}:`, err);
      }
    }
    
    res.json({ success: true, message: `Successfully pruned ${droppedCount} temporary databases.`, droppedCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
