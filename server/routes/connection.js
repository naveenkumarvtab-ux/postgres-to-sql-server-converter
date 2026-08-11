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

module.exports = router;
