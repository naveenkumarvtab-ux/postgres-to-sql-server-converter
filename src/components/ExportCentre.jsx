import React, { useState, useMemo, useEffect } from 'react';
import JSZip from 'jszip';

function sortTopologically(list, allObjects) {
  const result = [];
  const visited = new Set();
  const visiting = new Set();

  function visit(obj) {
    if (visited.has(obj.classified.id)) return;
    if (visiting.has(obj.classified.id)) return;
    visiting.add(obj.classified.id);

    const rawTextLower = (obj.translation.tsql || obj.classified.raw || '').toLowerCase();
    allObjects.forEach(other => {
      if (other.classified.id === obj.classified.id) return;
      const otherName = other.classified.name.toLowerCase();
      const escapedName = otherName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escapedName}\\b`, 'i');

      if (regex.test(rawTextLower)) {
        visit(other);
      }
    });

    visiting.delete(obj.classified.id);
    visited.add(obj.classified.id);
    if (list.some(o => o.classified.id === obj.classified.id)) {
      result.push(obj);
    }
  }

  list.forEach(obj => visit(obj));
  list.forEach(obj => {
    if (!result.some(r => r.classified.id === obj.classified.id)) {
      result.push(obj);
    }
  });
  return result;
}

const getApiUrl = (path) => {
  const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  return isLocalDev ? path : `http://127.0.0.1:3001${path}`;
};

export default function ExportCentre({ 
  objects, 
  validationReport, 
  settings, 
  sourceDialect, 
  originalFileName, 
  preserveSchema,
  onOpenSettings
}) {
  const [deployPhase, setDeployPhase] = useState(null); // 'deploying', 'backing_up', 'completed', 'failed'
  const [deployProgress, setDeployProgress] = useState(0);
  const [deployTotal, setDeployTotal] = useState(0);
  const [deployLogs, setDeployLogs] = useState([]);
  const [deployResults, setDeployResults] = useState(null);
  const [backupSessionId, setBackupSessionId] = useState(null);
  const [bypassErrors, setBypassErrors] = useState(false);
  
  const pendingAiCount = useMemo(() => objects.filter(o => o.translation.requiresAi).length, [objects]);
  const errorCount = validationReport?.errors?.length || 0;
  
  const sqlConfig = settings?.sqlServerConfig || {};
  const isConnected = sqlConfig.isConnected;

  const categoryOrder = ['SCHEMA', 'EXTENSION', 'ENUM', 'DOMAIN', 'COMPOSITE', 'SEQUENCE', 'TABLE', 'CONSTRAINT', 'INDEX', 'VIEW', 'FUNCTION', 'PROCEDURE', 'TRIGGER', 'DATA', 'OTHER'];

  const reportData = useMemo(() => {
    const stats = { total: objects.length, SCHEMA: 0, EXTENSION: 0, ENUM: 0, DOMAIN: 0, COMPOSITE: 0, SEQUENCE: 0, TABLE: 0, INDEX: 0, CONSTRAINT: 0, complex: 0, warnings: 0 };
    const warningsList = [];
    const orderedScripts = [];
    const grouped = {};
    categoryOrder.forEach(type => { grouped[type] = []; });

    objects.forEach(obj => {
      if (stats[obj.classified.type] !== undefined) stats[obj.classified.type]++;
      if (['VIEW', 'FUNCTION', 'PROCEDURE', 'TRIGGER'].includes(obj.classified.type)) stats.complex++;
      if (obj.translation.warnings && obj.translation.warnings.length > 0) {
        stats.warnings += obj.translation.warnings.length;
        obj.translation.warnings.forEach(warn => {
          warningsList.push({ type: obj.classified.type, name: `${obj.classified.schema}.${obj.classified.name}`, text: warn });
        });
      }
      if (grouped[obj.classified.type]) {
        grouped[obj.classified.type].push(obj);
      } else {
        grouped['OTHER'].push(obj);
      }
    });

    if (preserveSchema) {
      const detectedSchemas = new Set();
      objects.forEach(obj => {
        if (obj.classified.schema && obj.classified.schema.toLowerCase() !== 'dbo' && obj.classified.schema.toLowerCase() !== 'public') {
          detectedSchemas.add(obj.classified.schema.toLowerCase());
        }
      });
      if (detectedSchemas.size > 0) {
        orderedScripts.push(`\n-- =========================================================\n-- CREATE SCHEMAS\n-- =========================================================\n`);
        detectedSchemas.forEach(s => {
          orderedScripts.push(`IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = '${s}')\nBEGIN\n    EXEC('CREATE SCHEMA [${s}]');\nEND\nGO\n`);
        });
      }
    }

    const stripInlineDrops = (tsql) => {
      if (!tsql) return tsql;
      return tsql.replace(/^DROP\s+(TABLE|SEQUENCE|INDEX|VIEW|FUNCTION|PROCEDURE|TRIGGER)\s+IF\s+EXISTS\s+[^;]*;\s*\n?GO\s*\n?/gim, '')
                 .replace(/^ALTER\s+TABLE\s+[^\n]*DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+[^;]*;\s*\n?GO\s*\n?/gim, '')
                 .replace(/^DROP\s+INDEX\s+IF\s+EXISTS\s+[^\n]*;\s*\n?GO\s*\n?/gim, '').trim();
    };

    const extractDropStatement = (tsql) => {
      if (!tsql) return null;
      const drops = [];
      const dropRegex = /^(DROP\s+(?:TABLE|SEQUENCE|VIEW|FUNCTION|PROCEDURE|TRIGGER)\s+IF\s+EXISTS\s+[^;]*;\s*\n?GO)/gim;
      let m; while ((m = dropRegex.exec(tsql)) !== null) drops.push(m[1].trim());
      const constraintDropRegex = /^(ALTER\s+TABLE\s+[^\n]*DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+[^;]*;\s*\n?GO)/gim;
      while ((m = constraintDropRegex.exec(tsql)) !== null) drops.push(m[1].trim());
      const indexDropRegex = /^(DROP\s+INDEX\s+IF\s+EXISTS\s+[^\n]*;\s*\n?GO)/gim;
      while ((m = indexDropRegex.exec(tsql)) !== null) drops.push(m[1].trim());
      return drops.length > 0 ? drops.join('\n') : null;
    };

    const sortedByType = {};
    ['SCHEMA', 'EXTENSION', 'ENUM', 'DOMAIN', 'COMPOSITE', 'SEQUENCE', 'TABLE', 'CONSTRAINT', 'INDEX'].forEach(type => {
      const list = grouped[type];
      if (list && list.length > 0) sortedByType[type] = sortTopologically(list, objects);
    });

    const routinesList = [...grouped['VIEW'], ...grouped['FUNCTION'], ...grouped['PROCEDURE'], ...grouped['TRIGGER']];
    const sortedRoutines = routinesList.length > 0 ? sortTopologically(routinesList, objects) : [];

    const allDroppableCategories = ['INDEX', 'CONSTRAINT', 'TABLE', 'SEQUENCE'];
    const reverseDrops = [];

    if (sortedRoutines.length > 0) {
      const reversedRoutines = [...sortedRoutines].reverse();
      reversedRoutines.forEach(obj => {
        const dropStmt = extractDropStatement(obj.translation.tsql);
        if (dropStmt) {
          reverseDrops.push(`-- Drop: [${obj.classified.type}] ${obj.classified.schema}.${obj.classified.name}`);
          reverseDrops.push(dropStmt);
        } else {
          if (['VIEW', 'FUNCTION', 'PROCEDURE', 'TRIGGER'].includes(obj.classified.type)) {
            reverseDrops.push(`-- Drop: [${obj.classified.type}] ${obj.classified.schema}.${obj.classified.name}`);
            reverseDrops.push(`DROP ${obj.classified.type} IF EXISTS [${obj.classified.schema}].[${obj.classified.name}];\nGO`);
          }
        }
      });
    }

    const reversedDropsCategories = [...allDroppableCategories].reverse();
    reversedDropsCategories.forEach(type => {
      const list = sortedByType[type];
      if (list && list.length > 0) {
        const reversedList = [...list].reverse();
        reversedList.forEach(obj => {
          const dropStmt = extractDropStatement(obj.translation.tsql);
          if (dropStmt) {
            reverseDrops.push(`-- Drop: [${obj.classified.type}] ${obj.classified.schema}.${obj.classified.name}`);
            reverseDrops.push(dropStmt);
          } else {
            if (obj.classified.type === 'TABLE') {
              reverseDrops.push(`-- Drop: TABLE ${obj.classified.schema}.${obj.classified.name}`);
              reverseDrops.push(`DROP TABLE IF EXISTS [${obj.classified.schema}].[${obj.classified.name}];\nGO`);
            }
          }
        });
      }
    });

    const dropScript = reverseDrops.length > 0 ? reverseDrops.join('\n') + '\n\n' : '';
    const createScripts = [];

    ['SCHEMA', 'EXTENSION', 'ENUM', 'DOMAIN', 'COMPOSITE', 'SEQUENCE', 'TABLE', 'CONSTRAINT', 'INDEX'].forEach(type => {
      const list = sortedByType[type];
      if (list && list.length > 0) {
        createScripts.push(`\n-- =========================================================\n-- CREATE ${type}S\n-- =========================================================\n`);
        list.forEach(obj => {
          createScripts.push(`-- Creating: [${obj.classified.type}] ${obj.classified.schema}.${obj.classified.name}`);
          createScripts.push(stripInlineDrops(obj.translation.tsql));
        });
      }
    });

    if (sortedRoutines.length > 0) {
      createScripts.push(`\n-- =========================================================\n-- CREATE VIEWS & PROGRAMMABLE OBJECTS\n-- =========================================================\n`);
      sortedRoutines.forEach(obj => {
        createScripts.push(`-- Creating: [${obj.classified.type}] ${obj.classified.schema}.${obj.classified.name}`);
        createScripts.push(stripInlineDrops(obj.translation.tsql));
      });
    }

    const combinedSql = dropScript + orderedScripts.join('\n') + createScripts.join('\n\n') + '\n';
    return { stats, warningsList, combinedSql };
  }, [objects, preserveSchema]);

  const downloadSqlFile = () => {
    const blob = new Blob([reportData.combinedSql], { type: 'text/sql' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = originalFileName.replace(/\.[^/.]+$/, "") + '_sql_server.sql';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadZipFile = async () => {
    const zip = new JSZip();
    const folder = zip.folder("sql_server_migration");
    const groupedByFile = {};

    objects.forEach(obj => {
      const f = obj.classified.sourceFile || 'schema.sql';
      if (!groupedByFile[f]) groupedByFile[f] = [];
      groupedByFile[f].push(obj);
    });

    Object.keys(groupedByFile).forEach(fileName => {
      const list = groupedByFile[fileName];
      const dropList = [];
      const createList = [];

      list.forEach(obj => {
        if (['VIEW', 'FUNCTION', 'PROCEDURE', 'TRIGGER'].includes(obj.classified.type)) {
          dropList.push(`DROP ${obj.classified.type} IF EXISTS [${obj.classified.schema}].[${obj.classified.name}];\nGO`);
        } else if (obj.classified.type === 'TABLE') {
          dropList.push(`DROP TABLE IF EXISTS [${obj.classified.schema}].[${obj.classified.name}];\nGO`);
        }
        createList.push(obj.translation.tsql);
      });

      const fileContent = `-- DROPS\n${dropList.join('\n')}\n\n-- CREATES\n${createList.join('\n\n')}`;
      folder.file(fileName.replace(/\.[^/.]+$/, "") + '_sql_server.sql', fileContent);
    });

    const reportBlob = new Blob([generateMarkdownReport()], { type: 'text/markdown' });
    folder.file("migration_report.md", reportBlob);

    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = originalFileName.replace(/\.[^/.]+$/, "") + '_migration_package.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const generateMarkdownReport = () => {
    return `# SQL Server Migration Assessment Report
Generated from: ${originalFileName}
Dialect: ${sourceDialect.toUpperCase()}

## Conversion Summary
- Total Objects Parsed: ${reportData.stats.total}
- Tables Converted: ${reportData.stats.TABLE}
- Constraints Converted: ${reportData.stats.CONSTRAINT}
- Sequences Converted: ${reportData.stats.SEQUENCE}
- Programmable Objects (Views/Procedures/Functions/Triggers): ${reportData.stats.complex}
- Translation Warnings Flagged: ${reportData.stats.warnings}

## Object Type Breakdown
${Object.keys(reportData.stats).filter(k => k !== 'total' && k !== 'complex' && reportData.stats[k] > 0).map(k => `- ${k}: ${reportData.stats[k]}`).join('\n')}

## Post-Conversion Validation Summary
- Syntax Errors: ${validationReport?.errors?.length || 0}
- Warnings: ${validationReport?.warnings?.length || 0}
- Manual Checks Needed: ${validationReport?.manualFixes?.length || 0}

## Details of Flagged Warnings & Manual Adjustments
${reportData.warningsList.length === 0 ? '_No logical compiler warnings flagged._' : reportData.warningsList.map((w, idx) => `${idx + 1}. **[${w.type}] ${w.name}**\n   - Warning: ${w.text}`).join('\n')}
`;
  };

  const downloadReportFile = () => {
    const reportText = generateMarkdownReport();
    const blob = new Blob([reportText], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = originalFileName.replace(/\.[^/.]+$/, "") + '_migration_report.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copySqlToClipboard = () => {
    navigator.clipboard.writeText(reportData.combinedSql);
    alert('Combined T-SQL script copied to clipboard!');
  };

  const getCompatLevel = (profile) => {
    const map = { sql2016: 130, sql2017: 140, sql2019: 150, sql2022: 160, sql2025: 170, azureMI: 160, azureDB: 160 };
    return map[profile] || 160;
  };

  const startDeployment = async () => {
    if (!isConnected || ((!bypassErrors && errorCount > 0) || pendingAiCount > 0)) return;
    
    setDeployPhase('deploying');
    setDeployProgress(0);
    setDeployTotal(objects.length);
    setDeployLogs([]);
    setDeployResults(null);
    setBackupSessionId(null);

    const dbName = `${sqlConfig.dbPrefix}_${Date.now()}`;
    let activeSessionId = null;
    
    try {
      // 1. Deploy Objects via SSE
      const deployRes = await fetch(getApiUrl('/api/deploy/start'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          objects, 
          dbName, 
          compatLevel: getCompatLevel(sqlConfig.targetProfile), 
          settings: sqlConfig,
          bypassErrors
        })
      });

      if (!deployRes.ok) throw new Error('Deployment failed to start');

      const reader = deployRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop(); // keep remainder
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const evt = JSON.parse(line.substring(6));
              if (evt.phase === 'init') {
                if (evt.data?.sessionId) {
                  activeSessionId = evt.data.sessionId;
                }
                setDeployLogs(prev => [...prev, { type: 'info', msg: evt.message }]);
              } else if (evt.phase === 'deploy') {
                setDeployProgress(evt.data.current);
                if (evt.data.status === 'error') {
                  setDeployLogs(prev => [...prev, { type: 'error', msg: `Deploy failed for [${evt.data.objectType}] ${evt.data.object?.classified?.name}: ${evt.data.error}` }]);
                } else {
                  setDeployLogs(prev => [...prev, { type: 'info', msg: `Deployed ${evt.data.object?.classified?.name || 'Object'}` }]);
                }
              } else if (evt.phase === 'compile') {
                setDeployLogs(prev => [...prev, { type: 'info', msg: `Validating compilation: ${evt.message}` }]);
                if (evt.data?.errors && evt.data.errors.length > 0) {
                  evt.data.errors.forEach(err => {
                    setDeployLogs(prev => [...prev, { type: 'error', msg: `Compile error in ${err.object}: ${err.error}` }]);
                  });
                }
              } else if (evt.phase === 'dependencies') {
                setDeployLogs(prev => [...prev, { type: 'info', msg: `Checking references: ${evt.message}` }]);
                if (evt.data?.dependencies && evt.data.dependencies.length > 0) {
                  evt.data.dependencies.forEach(dep => {
                    setDeployLogs(prev => [...prev, { type: 'error', msg: `Missing reference: ${dep.referencing_object} references missing ${dep.missing_reference}` }]);
                  });
                }
              } else if (evt.phase === 'counts') {
                setDeployLogs(prev => [...prev, { type: 'info', msg: `Objects verified in database.` }]);
              } else if (evt.phase === 'error') {
                setDeployLogs(prev => [...prev, { type: 'error', msg: `Deployment Error: ${evt.message}` }]);
              } else if (evt.phase === 'complete') {
                setDeployPhase('backing_up');
                setDeployResults(evt.data.deployResult);
                
                // 2. Start Backup via SSE
                const backupRes = await fetch(getApiUrl('/api/backup/generate'), {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ sessionId: activeSessionId, bypassErrors })
                });

                if (!backupRes.ok) {
                  const errorData = await backupRes.json();
                  throw new Error(errorData.error || 'Backup failed to start');
                }

                const backupReader = backupRes.body.getReader();
                const backupDecoder = new TextDecoder();
                let backupBuffer = '';
                
                while (true) {
                  const { value: bVal, done: bDone } = await backupReader.read();
                  if (bDone) break;
                  
                  backupBuffer += backupDecoder.decode(bVal, { stream: true });
                  const bLines = backupBuffer.split('\n\n');
                  backupBuffer = bLines.pop();
                  
                  for (const bLine of bLines) {
                    if (bLine.startsWith('data: ')) {
                      const bEvt = JSON.parse(bLine.substring(6));
                      if (bEvt.phase === 'backup') {
                        setDeployLogs(prev => [...prev, { type: 'info', msg: `Backup progress: ${bEvt.message}` }]);
                      } else if (bEvt.phase === 'complete') {
                        setDeployPhase('completed');
                        setBackupSessionId(activeSessionId);
                        setDeployLogs(prev => [...prev, { type: 'success', msg: `Backup generated successfully` }]);
                      } else if (bEvt.phase === 'error') {
                        throw new Error(bEvt.message);
                      }
                    }
                  }
                }
              }
            } catch (e) {
              console.error('Failed to parse SSE event', e);
            }
          }
        }
      }
    } catch (err) {
      setDeployPhase('failed');
      setDeployLogs(prev => [...prev, { type: 'error', msg: `Operation failed: ${err.message}` }]);
    }
  };

  return (
    <div className="export-centre">
      {errorCount > 0 && (
        <div className="hard-rule-banner glass-panel">
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div>
            <strong style={{ display: 'block', fontSize: '1rem', marginBottom: '0.2rem' }}>Database export blocked</strong>
            <span style={{ fontSize: '0.85rem' }}>Resolve all {errorCount} errors before generating .BAK</span>
          </div>
        </div>
      )}

      <div className="export-centre-grid">
        <div className="export-centre-section glass-panel">
          <h3>Migration Package</h3>
          <p className="section-desc">Download converted T-SQL scripts for manual execution.</p>
          
          <div className="export-actions">
            <button className="btn btn-primary" onClick={downloadSqlFile}>
              Download Combined SQL
            </button>
            <button className="btn btn-secondary" onClick={downloadZipFile}>
              Download ZIP Archive
            </button>
            <button className="btn btn-secondary" onClick={downloadReportFile}>
              Download Migration Report
            </button>
            <button className="btn btn-secondary" onClick={copySqlToClipboard}>
              Copy to Clipboard
            </button>
          </div>
        </div>

        <div className="export-centre-section glass-panel">
          <h3>SQL Server Database</h3>
          <p className="section-desc">Deploy directly to SQL Server and generate a .BAK file.</p>

          {!isConnected ? (
            <div className="connection-prompt">
              <p>Configure SQL Server connection in Settings</p>
              <button className="btn btn-secondary" onClick={onOpenSettings}>
                Open Settings
              </button>
            </div>
          ) : (
            <div className="deploy-panel">
              <div className="connection-info">
                <span className="connection-dot connected"></span>
                <span>Connected to {sqlConfig.server} ({sqlConfig.serverInfo})</span>
              </div>

              {deployPhase === null && (
                <>
                  <button 
                    className={`btn btn-primary deploy-btn ${((!bypassErrors && errorCount > 0) || pendingAiCount > 0) ? 'disabled' : ''}`}
                    onClick={startDeployment}
                    disabled={(!bypassErrors && errorCount > 0) || pendingAiCount > 0}
                  >
                    Deploy & Generate .BAK
                  </button>
                  
                  {errorCount > 0 && (
                    <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center' }}>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={bypassErrors}
                          onChange={(e) => setBypassErrors(e.target.checked)}
                          style={{ accentColor: 'var(--primary)', width: '16px', height: '16px', cursor: 'pointer' }}
                        />
                        <span>Force deploy and generate .BAK (Bypass errors)</span>
                      </label>
                    </div>
                  )}
                </>
              )}

              {errorCount > 0 && !bypassErrors && <p className="deploy-warning">Cannot generate .BAK: {errorCount} objects have errors</p>}
              {errorCount > 0 && bypassErrors && <p className="deploy-warning" style={{ color: 'var(--warning)' }}>Warning: Force deploying with {errorCount} errors. Some objects may fail to create.</p>}
              {pendingAiCount > 0 && <p className="deploy-warning">{pendingAiCount} objects pending AI translation</p>}

              {deployPhase !== null && (
                <div className="deploy-progress-container">
                  <div className="phase-indicator">
                    <div className={`phase-step ${['deploying', 'backing_up', 'completed'].includes(deployPhase) ? 'active' : ''} ${['backing_up', 'completed'].includes(deployPhase) ? 'completed' : ''}`}>Deploying</div>
                    <div className={`phase-step ${['backing_up', 'completed'].includes(deployPhase) ? 'active' : ''} ${deployPhase === 'completed' ? 'completed' : ''}`}>Backing Up</div>
                    <div className={`phase-step ${deployPhase === 'completed' ? 'active completed' : ''}`}>Complete</div>
                  </div>

                  {deployPhase === 'deploying' && (
                    <div className="deploy-progress">
                      <div className="progress-text">Deploying: {deployProgress}/{deployTotal} objects</div>
                      <div className="progress-bar">
                        <div className="progress-bar-fill" style={{ width: `${(deployProgress / deployTotal) * 100}%` }}></div>
                      </div>
                    </div>
                  )}

                  <div className="deploy-log">
                    {deployLogs.map((log, i) => (
                      <div key={i} className={`deploy-log-entry ${log.type}`}>
                        {log.msg}
                      </div>
                    ))}
                  </div>

                  {deployPhase === 'completed' && (
                    <div className="deploy-success-actions">
                      {backupSessionId && (
                        <a href={getApiUrl(`/api/backup/download/${backupSessionId}`)} className="btn btn-primary" download>
                          Download .BAK
                        </a>
                      )}
                      <button className="btn btn-secondary" onClick={downloadReportFile}>
                        Download Validation Report
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
