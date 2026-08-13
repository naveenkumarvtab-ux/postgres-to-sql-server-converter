const express = require('express');
const path = require('path');
const { sessions } = require('../services/sessionStore');
const { getPool } = require('../config/database');
const { generateBackup, verifyBackup, cleanupBackup } = require('../services/backupManager');

const router = express.Router();

router.post('/generate', async (req, res) => {
  const { sessionId, bypassErrors } = req.body;
  
  const session = sessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  const hasCompileErrors = session.compileResult && 
    (!session.compileResult.passed || 
     session.compileResult.compilationErrors.length > 0 || 
     session.compileResult.unresolvedDependencies.length > 0);
  
  const hasDeployErrors = session.deployResult && session.deployResult.totalErrors > 0;
     
  if (!bypassErrors && (hasCompileErrors || hasDeployErrors || session.status === 'error' || session.status === 'failed')) {
    return res.status(403).json({ error: 'Cannot generate backup for database with deployment or compilation errors' });
  }
  
  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  
  const sendEvent = (phase, message, data = {}) => {
    res.write(`data: ${JSON.stringify({ type: 'progress', phase, message, data })}\n\n`);
  };
  
  sendEvent('init', 'Initializing backup');
  
  try {
    const pool = await getPool();
    const outputDir = path.join('C:\\MigrationToSQL\\exports');
    
    sendEvent('backup', 'Generating .BAK file');
    const backupPath = await generateBackup(pool, session.dbName, outputDir, (progressMsg) => {
      sendEvent('backup', progressMsg);
    });
    
    sendEvent('verify', 'Verifying backup');
    const verification = await verifyBackup(pool, backupPath);
    
    if (verification.verified) {
      session.backupPath = backupPath;
      session.bypassErrors = !!bypassErrors;
      sessions.set(sessionId, session);
      sendEvent('complete', 'Backup completed successfully', { verification });
    } else {
      sendEvent('error', 'Backup verification failed', { verification });
    }
    
    res.end();
  } catch (err) {
    console.error('Backup error:', err);
    sendEvent('error', err.message);
    res.end();
  }
});

router.get('/download/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  
  if (!session || !session.backupPath) {
    return res.status(404).json({ error: 'Backup not found for this session' });
  }
  
  const isDraft = !!session.bypassErrors;
  const downloadName = isDraft 
    ? `DRAFT-INCOMPLETE-DO-NOT-DEPLOY-${session.dbName}.bak`
    : `${session.dbName}.bak`;

  res.download(session.backupPath, downloadName, (err) => {
    if (err) {
      console.error('Error downloading backup:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error downloading file' });
      }
    }
  });
});

router.post('/cleanup/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  
  if (!session || !session.backupPath) {
    return res.status(404).json({ error: 'Backup not found for this session' });
  }
  
  const success = cleanupBackup(session.backupPath);
  if (success) {
    session.backupPath = null;
    sessions.set(sessionId, session);
    res.json({ success: true, message: 'Backup file removed' });
  } else {
    res.status(500).json({ error: 'Failed to remove backup file' });
  }
});

module.exports = router;
