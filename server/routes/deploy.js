const express = require('express');
const crypto = require('crypto');
const { sessions } = require('../services/sessionStore');
const { getPool } = require('../config/database');
const { createDisposableDatabase, deployObjects, dropDisposableDatabase } = require('../services/deploymentEngine');
const { runAllValidations } = require('../services/compileValidator');

const router = express.Router();

router.post('/start', async (req, res) => {
  const { objects, dbName, compatLevel, settings } = req.body;
  
  if (!objects || !dbName) {
    return res.status(400).json({ error: 'Missing objects or dbName' });
  }
  
  const sessionId = crypto.randomUUID();
  
  sessions.set(sessionId, {
    dbName,
    objects,
    status: 'initializing'
  });
  
  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  
  const sendEvent = (phase, message, data = {}) => {
    res.write(`data: ${JSON.stringify({ type: 'progress', phase, message, data })}\n\n`);
  };
  
  sendEvent('init', 'Session initialized', { sessionId });
  
  try {
    const pool = await getPool();
    
    // 1. Create Disposable Database
    sendEvent('init', `Creating database ${dbName}`);
    await createDisposableDatabase(pool, dbName, compatLevel || 150);
    
    // 2. Deploy Objects
    sendEvent('deploy', 'Deploying objects');
    const deployResult = await deployObjects(pool, dbName, objects, (progress) => {
      sendEvent('deploy', `Deploying ${progress.objectType}: ${progress.object?.classified?.name || 'Unknown'}`, progress);
    });
    
    // 3. Compile Validation
    sendEvent('compile', 'Validating compilation');
    const validationResult = await runAllValidations(pool, dbName);
    
    if (validationResult.compilationErrors.length > 0) {
      sendEvent('compile', 'Compilation errors found', { errors: validationResult.compilationErrors });
    }
    
    // 4. Unresolved Dependencies
    sendEvent('dependencies', 'Checking dependencies');
    if (validationResult.unresolvedDependencies.length > 0) {
      sendEvent('dependencies', 'Unresolved dependencies found', { dependencies: validationResult.unresolvedDependencies });
    }
    
    // 5. Object Counts
    sendEvent('counts', 'Fetching object counts', { counts: validationResult.objectCounts });
    
    // Store final state
    const sessionData = sessions.get(sessionId);
    const hasDeplErrors = deployResult.totalErrors > 0;
    sessionData.status = (validationResult.passed && !hasDeplErrors) ? 'success' : 'failed';
    sessionData.deployResult = deployResult;
    sessionData.compileResult = validationResult;
    sessions.set(sessionId, sessionData);
    
    sendEvent('complete', 'Deployment completed', { passed: validationResult.passed && !hasDeplErrors, deployResult });
    res.end();
    
  } catch (err) {
    console.error('Deployment error:', err);
    sendEvent('error', err.message);
    const sessionData = sessions.get(sessionId);
    if (sessionData) {
      sessionData.status = 'error';
      sessionData.error = err.message;
      sessions.set(sessionId, sessionData);
    }
    res.end();
  }
});

router.post('/cleanup/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  try {
    const pool = await getPool();
    await dropDisposableDatabase(pool, session.dbName);
    sessions.delete(sessionId);
    res.json({ success: true, message: 'Database dropped and session cleaned up' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
