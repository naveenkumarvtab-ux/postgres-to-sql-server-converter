const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
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

    // Compile and write trigger migration log
    try {
      const triggerLogDir = 'C:\\MigrationToSQL\\exports';
      if (!fs.existsSync(triggerLogDir)) {
        fs.mkdirSync(triggerLogDir, { recursive: true });
      }
      
      let triggerLog = "Source Schema | Source Trigger Name | Source Parent Table | Trigger Source | Reason for generation | Target Trigger Name | Migration Status\n";
      triggerLog += "---|---|---|---|---|---|---\n";
      
      const explicitTrgs = objects.filter(o => o.classified?.type === 'TRIGGER');
      explicitTrgs.forEach(obj => {
        const schema = obj.classified?.schema || 'dbo';
        const name = obj.classified?.name || 'Unknown';
        const tableName = obj.classified?.tableName || obj.parsed?.tableName || 'Unknown';
        
        let migrationStatus = 'SUCCESS';
        if (deployResult.errors) {
          const hasErr = deployResult.errors.some(
            e => e.object?.toLowerCase() === `${schema}.${name}`.toLowerCase() || e.object?.toLowerCase() === name.toLowerCase()
          );
          if (hasErr) migrationStatus = 'FAILED';
        }
        
        triggerLog += `${schema} | ${name} | ${tableName} | EXPLICIT | N/A | ${name} | ${migrationStatus}\n`;
      });
      
      objects.forEach(obj => {
        if (obj.classified?.type === 'TABLE' && obj.parsed?.columns) {
          const hasOnUpdate = obj.parsed.columns.some(c => c.onUpdateExpr);
          if (hasOnUpdate) {
            const schema = obj.classified?.schema || 'dbo';
            const tableName = obj.classified?.name || 'Unknown';
            triggerLog += `${schema} | NULL | ${tableName} | GENERATED | ON UPDATE CURRENT_TIMESTAMP | NULL | SKIPPED (Bypassed per rule)\n`;
          }
        }
      });
      
      fs.writeFileSync(path.join(triggerLogDir, 'trigger_migration_log.txt'), triggerLog);

      // Compile and write object-level migration log
      let objectLog = "Object Type | Schema | Object Name | Source Status | Target Status | Migration Status | Error\n";
      objectLog += "---|---|---|---|---|---|---\n";
      
      objects.forEach(obj => {
        const type = obj.classified?.type || 'UNKNOWN';
        const schema = obj.classified?.schema || 'dbo';
        const name = obj.classified?.name || 'Unknown';
        
        let targetStatus = "FOUND";
        let migrationStatus = "MIGRATED";
        let errorMsg = 'N/A';
        
        if (deployResult.errors) {
          const deployErr = deployResult.errors.find(
            e => e.object?.toLowerCase() === `${schema}.${name}`.toLowerCase() || e.object?.toLowerCase() === name.toLowerCase()
          );
          if (deployErr) {
            targetStatus = "NOT_FOUND";
            migrationStatus = "FAILED";
            errorMsg = deployErr.error;
          }
        }
        
        objectLog += `${type} | ${schema} | ${name} | FOUND | ${targetStatus} | ${migrationStatus} | ${errorMsg}\n`;
      });
      
      fs.writeFileSync(path.join(triggerLogDir, 'object_level_migration_log.txt'), objectLog);
    } catch (logErr) {
      console.error('Error writing trigger migration log files:', logErr);
    }
    
    sendEvent('complete', 'Deployment completed', { 
      passed: validationResult.passed && !hasDeplErrors, 
      deployResult,
      compileResult: validationResult
    });
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
