import React, { useState, useMemo } from 'react';
import JSZip from 'jszip';
import ExportCentre from './ExportCentre';

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
      const otherFull = `${other.classified.schema}.${other.classified.name}`.toLowerCase();
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

export default function SummaryReport({ objects, validationReport, onReset, onBackToWorkspace, sourceDialect, originalFileName, preserveSchema, settings, onOpenSettings }) {
  const [activeTab, setActiveTab] = useState('metrics');
  const [allowExportAnyway, setAllowExportAnyway] = useState(false);
  const [downloadFormat, setDownloadFormat] = useState(() => {
    return originalFileName && originalFileName.endsWith('.zip') ? 'zip' : 'sql';
  });
  
  const pendingCount = useMemo(() => {
    return objects.filter(o => o.translation.requiresAi).length;
  }, [objects]);

  const categoryOrder = useMemo(() => {
    const all = ['SCHEMA', 'EXTENSION', 'ENUM', 'DOMAIN', 'COMPOSITE', 'SEQUENCE', 'TABLE', 'CONSTRAINT', 'INDEX', 'VIEW', 'FUNCTION', 'PROCEDURE', 'TRIGGER', 'DATA', 'OTHER'];
    if (settings?.deploymentMode === 'view_only') {
      return ['VIEW'];
    }
    return all;
  }, [settings?.deploymentMode]);

  const reportData = useMemo(() => {
    const stats = {
      total: objects.length,
      SCHEMA: 0,
      EXTENSION: 0,
      ENUM: 0,
      DOMAIN: 0,
      COMPOSITE: 0,
      SEQUENCE: 0,
      TABLE: 0,
      INDEX: 0,
      CONSTRAINT: 0,
      complex: 0, 
      warnings: 0
    };

    const warningsList = [];
    const orderedScripts = [];

    const grouped = {};
    categoryOrder.forEach(type => {
      grouped[type] = [];
    });

    objects.forEach(obj => {
      if (stats[obj.classified.type] !== undefined) {
        stats[obj.classified.type]++;
      }
      if (['VIEW', 'FUNCTION', 'PROCEDURE', 'TRIGGER'].includes(obj.classified.type)) {
        stats.complex++;
      }

      if (obj.translation.warnings && obj.translation.warnings.length > 0) {
        stats.warnings += obj.translation.warnings.length;
        obj.translation.warnings.forEach(warn => {
          warningsList.push({
            type: obj.classified.type,
            name: `${obj.classified.schema}.${obj.classified.name}`,
            text: warn
          });
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
          orderedScripts.push(`IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = '${s}')`);
          orderedScripts.push(`BEGIN`);
          orderedScripts.push(`    EXEC('CREATE SCHEMA [${s}]');`);
          orderedScripts.push(`END\nGO\n`);
        });
      }
    }

    // Helper: strip inline DROP ... IF EXISTS statements from an object's T-SQL
    // so they can be emitted separately in reverse dependency order
    const stripInlineDrops = (tsql) => {
      if (!tsql) return tsql;
      return tsql
        .replace(/^DROP\s+(TABLE|SEQUENCE|INDEX|VIEW|FUNCTION|PROCEDURE|TRIGGER)\s+IF\s+EXISTS\s+[^;]*;\s*\n?GO\s*\n?/gim, '')
        .replace(/^ALTER\s+TABLE\s+[^\n]*DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+[^;]*;\s*\n?GO\s*\n?/gim, '')
        .replace(/^DROP\s+INDEX\s+IF\s+EXISTS\s+[^\n]*;\s*\n?GO\s*\n?/gim, '')
        .trim();
    };

    // Helper: extract the DROP statement from an object's T-SQL (returns null if none found)
    const extractDropStatement = (tsql) => {
      if (!tsql) return null;
      const drops = [];
      // Match DROP TABLE/SEQUENCE/VIEW/FUNCTION/PROCEDURE/TRIGGER IF EXISTS ...;GO
      const dropRegex = /^(DROP\s+(?:TABLE|SEQUENCE|VIEW|FUNCTION|PROCEDURE|TRIGGER)\s+IF\s+EXISTS\s+[^;]*;\s*\n?GO)/gim;
      let m;
      while ((m = dropRegex.exec(tsql)) !== null) {
        drops.push(m[1].trim());
      }
      // Match ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...;GO
      const constraintDropRegex = /^(ALTER\s+TABLE\s+[^\n]*DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+[^;]*;\s*\n?GO)/gim;
      while ((m = constraintDropRegex.exec(tsql)) !== null) {
        drops.push(m[1].trim());
      }
      // Match DROP INDEX IF EXISTS ...;GO
      const indexDropRegex = /^(DROP\s+INDEX\s+IF\s+EXISTS\s+[^\n]*;\s*\n?GO)/gim;
      while ((m = indexDropRegex.exec(tsql)) !== null) {
        drops.push(m[1].trim());
      }
      return drops.length > 0 ? drops.join('\n') : null;
    };

    // --- Phase 1: Sort all object categories ---
    const sortedByType = {};
    ['SCHEMA', 'EXTENSION', 'ENUM', 'DOMAIN', 'COMPOSITE', 'SEQUENCE', 'TABLE', 'CONSTRAINT', 'INDEX'].forEach(type => {
      const list = grouped[type];
      if (list && list.length > 0) {
        sortedByType[type] = sortTopologically(list, objects);
      }
    });

    const routinesList = [
      ...grouped['VIEW'],
      ...grouped['FUNCTION'],
      ...grouped['PROCEDURE'],
      ...grouped['TRIGGER']
    ];
    const sortedRoutines = routinesList.length > 0 ? sortTopologically(routinesList, objects) : [];

    // --- Phase 2: Emit DROP statements in REVERSE dependency order ---
    // Collect all droppable objects from routines + structural types that have DROP statements
    const allDroppableCategories = ['INDEX', 'CONSTRAINT', 'TABLE', 'SEQUENCE'];
    const reverseDrops = [];

    // Routines first (reverse of their creation order)
    if (sortedRoutines.length > 0) {
      const reversedRoutines = [...sortedRoutines].reverse();
      reversedRoutines.forEach(obj => {
        const tsql = obj.translation.tsql;
        const dropStmt = extractDropStatement(tsql);
        if (dropStmt) {
          reverseDrops.push(`-- Drop: [${obj.classified.type}] ${obj.classified.schema}.${obj.classified.name}`);
          reverseDrops.push(dropStmt);
        } else {
          // Generate a synthetic DROP for routines that use CREATE OR ALTER
          const type = obj.classified.type;
          const schema = obj.classified.schema;
          const name = obj.classified.name;
          if (['VIEW', 'FUNCTION', 'PROCEDURE', 'TRIGGER'].includes(type)) {
            reverseDrops.push(`-- Drop: [${type}] ${schema}.${name}`);
            reverseDrops.push(`DROP ${type} IF EXISTS [${schema}].[${name}];\nGO`);
          }
        }
      });
    }

    // Structural objects in reverse order (indexes, constraints, tables, sequences)
    allDroppableCategories.forEach(type => {
      const sorted = sortedByType[type];
      if (sorted && sorted.length > 0) {
        const reversed = [...sorted].reverse();
        reversed.forEach(obj => {
          const tsql = obj.translation.tsql;
          const dropStmt = extractDropStatement(tsql);
          if (dropStmt) {
            reverseDrops.push(`-- Drop: [${obj.classified.type}] ${obj.classified.schema}.${obj.classified.name}`);
            reverseDrops.push(dropStmt);
          } else if (type === 'TABLE') {
            // Generate synthetic DROP for tables in deployment mode (IF NOT EXISTS)
            reverseDrops.push(`-- Drop: [TABLE] ${obj.classified.schema}.${obj.classified.name}`);
            reverseDrops.push(`DROP TABLE IF EXISTS [${obj.classified.schema}].[${obj.classified.name}];\nGO`);
          }
        });
      }
    });

    if (reverseDrops.length > 0) {
      orderedScripts.push(`\n-- =========================================================\n-- DROP EXISTING OBJECTS (reverse dependency order)\n-- Child/dependent objects are dropped before their parents\n-- to avoid foreign key constraint violations on re-run.\n-- =========================================================\n`);
      reverseDrops.forEach(line => orderedScripts.push(line));
      orderedScripts.push('');
    }

    // --- Phase 3: Emit CREATE statements in FORWARD dependency order ---
    ['SCHEMA', 'EXTENSION', 'ENUM', 'DOMAIN', 'COMPOSITE', 'SEQUENCE', 'TABLE', 'CONSTRAINT', 'INDEX'].forEach(type => {
      const sortedList = sortedByType[type];
      if (sortedList && sortedList.length > 0) {
        orderedScripts.push(`\n-- =========================================================\n-- TYPE: ${type}\n-- =========================================================\n`);
        sortedList.forEach(obj => {
          orderedScripts.push(`-- Object: [${obj.classified.type}] ${obj.classified.schema}.${obj.classified.name}`);
          // Strip inline DROP statements since they were already emitted above
          const cleanTsql = stripInlineDrops(obj.translation.tsql);
          orderedScripts.push(cleanTsql);
          orderedScripts.push(''); 
        });
      }
    });

    if (sortedRoutines.length > 0) {
      orderedScripts.push(`\n-- =========================================================\n-- TYPE: ROUTINES (VIEWS, FUNCTIONS, PROCEDURES, TRIGGERS)\n-- =========================================================\n`);
      sortedRoutines.forEach(obj => {
        orderedScripts.push(`-- Object: [${obj.classified.type}] ${obj.classified.schema}.${obj.classified.name}`);
        orderedScripts.push(obj.translation.tsql);
        orderedScripts.push('');
      });
    }

    ['DATA', 'OTHER'].forEach(type => {
      const list = grouped[type];
      if (list && list.length > 0) {
        const sortedList = type === 'DATA' ? list : sortTopologically(list, objects);
        orderedScripts.push(`\n-- =========================================================\n-- TYPE: ${type}\n-- =========================================================\n`);
        sortedList.forEach(obj => {
          if (obj.translation.tsql) {
            orderedScripts.push(obj.translation.tsql);
            orderedScripts.push('');
          }
        });
      }
    });

    const combinedSql = orderedScripts.join('\n');

    return {
      stats,
      warningsList,
      combinedSql
    };
  }, [objects, preserveSchema]);

  const downloadZipFile = async () => {
    const zip = new JSZip();
    
    // Group objects by their source file
    const fileGroups = {};
    objects.forEach(obj => {
      const fileName = obj.classified.sourceFile || 'schema.sql';
      if (!fileGroups[fileName]) {
        fileGroups[fileName] = [];
      }
      fileGroups[fileName].push(obj);
    });
    
    // For each file group, sort topologically and assemble T-SQL content
    Object.keys(fileGroups).forEach(fileName => {
      const fileObjects = fileGroups[fileName];
      
      const dataObjects = fileObjects.filter(o => o.classified.type === 'DATA');
      const ddlObjects = fileObjects.filter(o => o.classified.type !== 'DATA');
      const sortedDdl = sortTopologically(ddlObjects, objects);
      const combinedObjects = [...sortedDdl, ...dataObjects];
      
      let tsqlContent = '';
      combinedObjects.forEach(obj => {
        if (obj.translation.tsql) {
          tsqlContent += obj.translation.tsql + '\n\n';
        }
      });
      
      let targetFileName = fileName;
      const lastDot = fileName.lastIndexOf('.');
      if (lastDot !== -1) {
        const ext = fileName.substring(lastDot);
        const namePart = fileName.substring(0, lastDot);
        targetFileName = `${namePart}_sql_server${ext}`;
      } else {
        targetFileName = `${fileName}_sql_server.sql`;
      }
      
      zip.file(targetFileName, tsqlContent.trim());
    });
    
    const mdReport = `# Database Schema Conversion Report
Generated by TranspileDB on ${new Date().toLocaleDateString()}

## Summary Metrics
- **Total Objects Parsed**: ${objects.length}
- **Dialect**: ${sourceDialect.toUpperCase()}

*Detailed report generated inside individual files.*
`;
    zip.file('migration_report.md', mdReport);
    
    try {
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      
      let zipName = 'converted_sql_server_schema.zip';
      if (originalFileName) {
        const lastDot = originalFileName.lastIndexOf('.');
        if (lastDot !== -1) {
          const namePart = originalFileName.substring(0, lastDot);
          zipName = `${namePart}_sql_server.zip`;
        } else {
          zipName = `${originalFileName}_sql_server.zip`;
        }
      }
      a.download = zipName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to generate ZIP archive:', err);
      alert('Error creating ZIP: ' + err.message);
    }
  };

  const downloadSqlFile = () => {
    if (downloadFormat === 'zip') {
      downloadZipFile();
      return;
    }

    const blob = new Blob([reportData.combinedSql], { type: 'text/sql' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'converted_sql_server_schema.sql';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadReportFile = () => {
    const mdReport = `# Database Schema Conversion Report
Generated by TranspileDB on ${new Date().toLocaleDateString()}

## 1. Summary Metrics
- **Total ${sourceDialect === 'postgres' ? 'PostgreSQL' : 'Oracle'} Objects Parsed**: ${reportData.stats.total}
- **Schemas**: ${reportData.stats.SCHEMA}
- **Extensions**: ${reportData.stats.EXTENSION}
- **Composite Types**: ${reportData.stats.COMPOSITE}
- **Sequences**: ${reportData.stats.SEQUENCE}
- **Tables**: ${reportData.stats.TABLE}
- **Indexes**: ${reportData.stats.INDEX}
- **Alter Table Constraints**: ${reportData.stats.CONSTRAINT}
- **${sourceDialect === 'postgres' ? 'PL/pgSQL' : 'PL/SQL'} Logic Objects**: ${reportData.stats.complex}
- **Total Warnings Flagged**: ${reportData.stats.warnings}

## 2. Items Requiring Manual Review (${reportData.warningsList.length})
${reportData.warningsList.length === 0 ? '_No warnings or manual actions required!_' : reportData.warningsList.map((w, i) => `${i + 1}. **[${w.type}] ${w.name}**: ${w.text}`).join('\n')}

---
_Note: Double check all functions and trigger behaviors before deploying to production. ${sourceDialect === 'postgres' ? 'PL/pgSQL' : 'PL/SQL'} to T-SQL transitions might require structural adjustments for cursor logic and set-based actions._
`;
    const blob = new Blob([mdReport], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'schema_conversion_report.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copySqlToClipboard = () => {
    navigator.clipboard.writeText(reportData.combinedSql);
    alert('Full T-SQL script copied to clipboard!');
  };

  return (
    <div className="summary-container container">
      <div className="summary-nav-header">
        <button className="btn btn-secondary" onClick={onBackToWorkspace} style={{ display: 'inline-flex', alignItems: 'center' }}>
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '0.5rem' }}>
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to Editor
        </button>
        <h2>Conversion Summary & Review</h2>
      </div>

      {/* Metric Cards */}
      <div className="summary-grid">
        <div className="metric-card glass-panel border-glow">
          <span className="metric-label">Objects Converted</span>
          <span className="metric-value">{reportData.stats.total}</span>
        </div>
        <div className="metric-card glass-panel">
          <span className="metric-label">Tables & Constraints</span>
          <span className="metric-value">{reportData.stats.TABLE + reportData.stats.CONSTRAINT}</span>
        </div>
        <div className="metric-card glass-panel">
          <span className="metric-label">AI Logic Objects</span>
          <span className="metric-value">{reportData.stats.complex}</span>
        </div>
        <div className="metric-card glass-panel highlight-warn">
          <span className="metric-label">Warnings Flagged</span>
          <span className="metric-value">{reportData.stats.warnings}</span>
        </div>
      </div>

      {/* Block/Warning banner if pending translation objects exist */}
      {pendingCount > 0 && (
        <div className="banner-alert danger glass-panel border-glow" style={{ margin: '1rem 0 1.5rem 0', padding: '1.25rem', border: '1px solid var(--error-border)', background: 'var(--error-bg)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div className="banner-title" style={{ color: 'var(--error)', display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '1rem', fontWeight: '800' }}>
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>Translation Incomplete: {pendingCount} Pending Objects</span>
          </div>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: '1.5', margin: 0 }}>
            There are still {pendingCount} database logic objects (views, functions, procedures, or triggers) waiting for AI translation. Exporting now will output a script with missing T-SQL logic.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button className="btn btn-primary btn-sm" onClick={onBackToWorkspace} style={{ padding: '0.5rem 1rem', fontSize: '0.8rem' }}>
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '0.4rem' }}>
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Go Back & Translate
            </button>
            {!allowExportAnyway ? (
              <button className="btn btn-secondary btn-sm" onClick={() => setAllowExportAnyway(true)} style={{ padding: '0.5rem 1rem', fontSize: '0.8rem' }}>
                Show Export Actions Anyway
              </button>
            ) : (
              <button className="btn btn-secondary btn-sm" onClick={() => setAllowExportAnyway(false)} style={{ padding: '0.5rem 1rem', fontSize: '0.8rem' }}>
                Keep Export Actions Blocked
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Panel */}
      <div className="summary-panel glass-panel">
        <div className="panel-tabs">
          <button 
            className={`tab-btn ${activeTab === 'metrics' ? 'active' : ''}`}
            onClick={() => setActiveTab('metrics')}
          >
            Review & Warnings
          </button>
          <button 
            className={`tab-btn ${activeTab === 'sql' ? 'active' : ''}`}
            onClick={() => setActiveTab('sql')}
          >
            Combined T-SQL Script
          </button>
          <button 
            className={`tab-btn ${activeTab === 'validation' ? 'active' : ''}`}
            onClick={() => setActiveTab('validation')}
          >
            Validation Report
          </button>

          <div className="panel-tab-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button className="btn btn-secondary btn-sm" onClick={downloadReportFile}>
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              Download Report
            </button>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <select
                value={downloadFormat}
                onChange={(e) => setDownloadFormat(e.target.value)}
                style={{
                  height: '32px',
                  padding: '0 8px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: '500',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  background: 'rgba(255, 255, 255, 0.05)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  outline: 'none'
                }}
              >
                <option value="sql">.sql (Combined Script)</option>
                <option value="zip">.zip (Folder Structure)</option>
              </select>

              <button 
                className={`btn btn-primary btn-sm ${pendingCount > 0 && !allowExportAnyway ? 'disabled' : ''}`} 
                onClick={downloadSqlFile}
                disabled={pendingCount > 0 && !allowExportAnyway}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download Script
              </button>
            </div>
          </div>
        </div>

        <div className="tab-content">
          {activeTab === 'metrics' ? (
            <div className="metrics-tab">
              {reportData.warningsList.length === 0 ? (
                <div className="success-banner">
                  <svg viewBox="0 0 24 24" width="32" height="32" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" className="success-icon">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  <div>
                    <h3>Schema converted successfully with zero errors!</h3>
                    <p>All {sourceDialect === 'postgres' ? 'PostgreSQL' : 'Oracle'} objects were translated without warnings. Your schema is fully compatible with SQL Server syntax.</p>
                  </div>
                </div>
              ) : (
                <div className="warnings-section">
                  <div className="section-header">
                    <h3>Review Items ({reportData.warningsList.length})</h3>
                    <p>The following items contain features without a direct SQL Server equivalent or required conversion adjustments. We recommend examining these objects carefully.</p>
                  </div>
                  <div className="warnings-scroll-list">
                    {reportData.warningsList.map((warn, i) => (
                      <div key={i} className="warning-item glass-panel">
                        <div className="warn-meta">
                          <span className="badge badge-secondary">{warn.type}</span>
                          <strong className="warn-obj-name">{warn.name}</strong>
                        </div>
                        <p className="warn-text">{warn.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : activeTab === 'sql' ? (
            <div className="sql-tab">
              <div className="sql-preview-header">
                <span>Ordered T-SQL Output Script</span>
                <button className="btn-action-copy" onClick={copySqlToClipboard}>
                  <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  Copy T-SQL Code
                </button>
              </div>
              <div className="sql-preview-box">
                <pre><code>{reportData.combinedSql}</code></pre>
              </div>
            </div>
          ) : (
            <div className="validation-tab" style={{ padding: '0.5rem 0' }}>
              <div className="section-header" style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ margin: '0 0 0.4rem 0', fontSize: '1.2rem', fontWeight: '800' }}>Post-Conversion Validation Report</h3>
                <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)' }}>The schema validation engine scanned the converted T-SQL code for compiler compatibility, broken references, data types, and PG-specific leaks.</p>
              </div>

              {/* 📊 Migration Validation Report Dashboard */}
              {(() => {
                const uniqueSchemas = new Set(objects.map(o => o.classified.schema ? o.classified.schema.toLowerCase() : 'public'));
                const schemasParsedCount = uniqueSchemas.size;
                const schemasCreatedCount = preserveSchema ? [...uniqueSchemas].filter(s => s !== 'dbo' && s !== 'public').length : 1;
                const tablesCount = objects.filter(o => o.classified.type === 'TABLE').length;
                const viewsCount = objects.filter(o => o.classified.type === 'VIEW').length;
                const functionsCount = objects.filter(o => o.classified.type === 'FUNCTION').length;
                const proceduresCount = objects.filter(o => o.classified.type === 'PROCEDURE').length;
                const triggersCount = objects.filter(o => o.classified.type === 'TRIGGER').length;
                
                const schemaRefFixedCount = objects.filter(o => o.classified.schema && o.classified.schema.toLowerCase() !== 'dbo').length;
                const brokenDepsCount = validationReport?.errors.filter(e => e.description.toLowerCase().includes('broken dependency') || e.description.toLowerCase().includes('does not exist')).length || 0;
                const depsResolvedPct = objects.length > 0 ? Math.round(((objects.length - brokenDepsCount) / objects.length) * 100) : 100;
                const missingTablesCount = validationReport?.errors.filter(e => e.description.toLowerCase().includes('referenced table or view') && e.description.toLowerCase().includes('does not exist')).length || 0;
                const missingColumnsCount = validationReport?.errors.filter(e => e.description.toLowerCase().includes('column') && e.description.toLowerCase().includes('does not exist')).length || 0;
                const compilationErrorsCount = validationReport?.errors.length || 0;
                const warningsCount = validationReport?.warnings.length || 0;

                return (
                  <div className="glass-panel" style={{ padding: '1.25rem', marginBottom: '1.5rem', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                      <div>
                        <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem', color: '#60a5fa', fontWeight: '700', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', paddingBottom: '0.4rem' }}>
                          Database Objects Parsed
                        </h4>
                        <table style={{ width: '100%', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                          <tbody>
                            <tr>
                              <td style={{ padding: '0.3rem 0' }}>Schemas Parsed</td>
                              <td style={{ textAlign: 'right', fontWeight: 'bold', color: 'var(--text-primary)' }}>{schemasParsedCount}</td>
                            </tr>
                            <tr>
                              <td style={{ padding: '0.3rem 0' }}>Schemas Created</td>
                              <td style={{ textAlign: 'right', fontWeight: 'bold', color: 'var(--text-primary)' }}>{schemasCreatedCount}</td>
                            </tr>
                            <tr>
                              <td style={{ padding: '0.3rem 0' }}>Tables Count</td>
                              <td style={{ textAlign: 'right', fontWeight: 'bold', color: 'var(--text-primary)' }}>{tablesCount}</td>
                            </tr>
                            <tr>
                              <td style={{ padding: '0.3rem 0' }}>Views Count</td>
                              <td style={{ textAlign: 'right', fontWeight: 'bold', color: 'var(--text-primary)' }}>{viewsCount}</td>
                            </tr>
                            <tr>
                              <td style={{ padding: '0.3rem 0' }}>Functions Count</td>
                              <td style={{ textAlign: 'right', fontWeight: 'bold', color: 'var(--text-primary)' }}>{functionsCount}</td>
                            </tr>
                            <tr>
                              <td style={{ padding: '0.3rem 0' }}>Procedures Count</td>
                              <td style={{ textAlign: 'right', fontWeight: 'bold', color: 'var(--text-primary)' }}>{proceduresCount}</td>
                            </tr>
                            <tr>
                              <td style={{ padding: '0.3rem 0' }}>Triggers Count</td>
                              <td style={{ textAlign: 'right', fontWeight: 'bold', color: 'var(--text-primary)' }}>{triggersCount}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      
                      <div>
                        <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem', color: '#60a5fa', fontWeight: '700', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', paddingBottom: '0.4rem' }}>
                          Validation & Integrity Status
                        </h4>
                        <table style={{ width: '100%', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                          <tbody>
                            <tr>
                              <td style={{ padding: '0.3rem 0' }}>Schema References Fixed</td>
                              <td style={{ textAlign: 'right', fontWeight: 'bold', color: 'var(--text-primary)' }}>{schemaRefFixedCount}</td>
                            </tr>
                            <tr>
                              <td style={{ padding: '0.3rem 0' }}>Dependencies Resolved</td>
                              <td style={{ textAlign: 'right', fontWeight: 'bold', color: depsResolvedPct === 100 ? 'var(--success)' : 'var(--warning)' }}>
                                {depsResolvedPct}%
                              </td>
                            </tr>
                            <tr>
                              <td style={{ padding: '0.3rem 0' }}>Missing Tables Detected</td>
                              <td style={{ textAlign: 'right', fontWeight: 'bold', color: missingTablesCount > 0 ? 'var(--error)' : 'var(--text-primary)' }}>{missingTablesCount}</td>
                            </tr>
                            <tr>
                              <td style={{ padding: '0.3rem 0' }}>Missing Columns Detected</td>
                              <td style={{ textAlign: 'right', fontWeight: 'bold', color: missingColumnsCount > 0 ? 'var(--error)' : 'var(--text-primary)' }}>{missingColumnsCount}</td>
                            </tr>
                            <tr>
                              <td style={{ padding: '0.3rem 0' }}>Compilation Errors</td>
                              <td style={{ textAlign: 'right', fontWeight: 'bold', color: compilationErrorsCount > 0 ? 'var(--error)' : 'var(--text-primary)' }}>{compilationErrorsCount}</td>
                            </tr>
                            <tr>
                              <td style={{ padding: '0.3rem 0' }}>Warnings Flaged</td>
                              <td style={{ textAlign: 'right', fontWeight: 'bold', color: warningsCount > 0 ? 'var(--warning)' : 'var(--text-primary)' }}>{warningsCount}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                );
              })()}
              
              <div className="validation-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                <div className="validation-card glass-panel" style={{ padding: '1rem', borderLeft: '4px solid var(--success)', borderRadius: 'var(--radius-sm)' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Passed Checks</span>
                  <div style={{ fontSize: '1.75rem', fontWeight: '800', margin: '0.25rem 0' }}>{validationReport?.successes.length || 0}</div>
                </div>
                <div className="validation-card glass-panel" style={{ padding: '1rem', borderLeft: '4px solid var(--warning)', borderRadius: 'var(--radius-sm)' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Syntax Warnings</span>
                  <div style={{ fontSize: '1.75rem', fontWeight: '800', margin: '0.25rem 0' }}>{validationReport?.warnings.length || 0}</div>
                </div>
                <div className="validation-card glass-panel" style={{ padding: '1rem', borderLeft: '4px solid var(--error)', borderRadius: 'var(--radius-sm)' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Syntax Errors</span>
                  <div style={{ fontSize: '1.75rem', fontWeight: '800', margin: '0.25rem 0' }}>{validationReport?.errors.length || 0}</div>
                </div>
                <div className="validation-card glass-panel" style={{ padding: '1rem', borderLeft: '4px solid #818cf8', borderRadius: 'var(--radius-sm)' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Manual Review Items</span>
                  <div style={{ fontSize: '1.75rem', fontWeight: '800', margin: '0.25rem 0' }}>{validationReport?.manualFixes.length || 0}</div>
                </div>
              </div>

              <div className="validation-list" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {validationReport?.errors.map((err, i) => (
                  <div key={`err-${i}`} className="validation-item error-item glass-panel" style={{ padding: '1rem', border: '1px solid var(--error-border)', background: 'rgba(239, 68, 68, 0.05)', display: 'flex', gap: '0.75rem', alignItems: 'flex-start', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ background: 'var(--error)', color: '#fff', borderRadius: '50%', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 'bold', flexShrink: 0 }}>X</div>
                    <div>
                      <strong style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.2rem' }}>{err.objectName}</strong>
                      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{err.description}</p>
                    </div>
                  </div>
                ))}

                {validationReport?.warnings.map((warn, i) => (
                  <div key={`warn-${i}`} className="validation-item warn-item glass-panel" style={{ padding: '1rem', border: '1px solid var(--warning-border)', background: 'rgba(245, 158, 11, 0.05)', display: 'flex', gap: '0.75rem', alignItems: 'flex-start', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ background: 'var(--warning)', color: '#fff', borderRadius: '50%', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 'bold', flexShrink: 0 }}>!</div>
                    <div>
                      <strong style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.2rem' }}>{warn.objectName}</strong>
                      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{warn.description}</p>
                    </div>
                  </div>
                ))}

                {validationReport?.manualFixes.map((fix, i) => (
                  <div key={`fix-${i}`} className="validation-item fix-item glass-panel" style={{ padding: '1rem', border: '1px solid #818cf8', background: 'rgba(129, 140, 248, 0.05)', display: 'flex', gap: '0.75rem', alignItems: 'flex-start', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ background: '#818cf8', color: '#fff', borderRadius: '50%', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 'bold', flexShrink: 0 }}>?</div>
                    <div>
                      <strong style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.2rem' }}>{fix.objectName}</strong>
                      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{fix.description}</p>
                    </div>
                  </div>
                ))}

                {(!validationReport || (validationReport.errors.length === 0 && validationReport.warnings.length === 0 && validationReport.manualFixes.length === 0)) && (
                  <div className="success-banner" style={{ display: 'flex', gap: '1rem', padding: '1.5rem', background: 'rgba(16, 185, 129, 0.05)', border: '1px solid var(--success-border)', borderRadius: 'var(--radius-md)', alignItems: 'center' }}>
                    <div style={{ fontSize: '2rem' }}>🎉</div>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 'bold' }}>All Validation Scans Passed!</h4>
                      <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Your T-SQL scripts did not trigger any structural index, type, reference, or parentheses errors.</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <ExportCentre 
        objects={objects} 
        validationReport={validationReport}
        settings={settings}
        sourceDialect={sourceDialect}
        originalFileName={originalFileName}
        preserveSchema={preserveSchema}
        onOpenSettings={onOpenSettings}
      />

      <style>{`
        .summary-container {
          padding-top: 2rem;
          padding-bottom: 4rem;
          display: flex;
          flex-direction: column;
          gap: 2rem;
          animation: fadeIn 0.4s ease-out;
        }
        
        .summary-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 1.25rem;
        }
        
        @media (max-width: 768px) {
          .summary-grid {
            grid-template-columns: 1fr 1fr;
          }
        }
        
        .metric-card {
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          background: var(--panel-bg);
          border: 1px solid var(--panel-border);
          border-radius: var(--radius-md);
        }
        
        .metric-label {
          font-size: 0.85rem;
          color: var(--text-secondary);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        
        .metric-value {
          font-size: 2.25rem;
          font-weight: 800;
          color: var(--text-primary);
          line-height: 1.1;
        }
        
        .border-glow {
          position: relative;
          box-shadow: var(--shadow-glow);
          border-color: rgba(99, 102, 241, 0.25);
        }
        
        .highlight-warn .metric-value {
          color: var(--warning);
        }
        
        .summary-panel {
          background: var(--panel-bg);
          border: 1px solid var(--panel-border);
          border-radius: var(--radius-lg);
          display: flex;
          flex-direction: column;
          min-height: 500px;
        }
        
        .panel-tabs {
          display: flex;
          align-items: center;
          border-bottom: 1px solid var(--panel-border);
          padding: 0 1.25rem;
          background: var(--panel-tab-bg, rgba(15, 23, 42, 0.3));
          border-radius: var(--radius-lg) var(--radius-lg) 0 0;
          flex-wrap: wrap;
        }
        
        .tab-btn {
          background: none;
          border: none;
          color: var(--text-secondary);
          font-family: var(--font-sans);
          font-weight: 600;
          font-size: 0.95rem;
          padding: 1.25rem 1.5rem;
          cursor: pointer;
          position: relative;
          transition: color 0.2s;
        }
        
        .tab-btn:hover {
          color: var(--text-primary);
        }
        
        .tab-btn.active {
          color: var(--primary);
        }
        
        .tab-btn.active::after {
          content: '';
          position: absolute;
          bottom: -1px;
          left: 0;
          right: 0;
          height: 2px;
          background: var(--primary);
          box-shadow: 0 0 8px var(--primary);
        }
        
        .panel-tab-actions {
          margin-left: auto;
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.75rem 0;
        }
        
        @media (max-width: 640px) {
          .panel-tab-actions {
            margin-left: 0;
            width: 100%;
            padding-bottom: 1rem;
          }
        }
        
        .btn-sm {
          padding: 0.45rem 1rem;
          font-size: 0.85rem;
          height: 34px;
        }
        
        .tab-content {
          padding: 1.75rem;
          flex: 1;
          display: flex;
          flex-direction: column;
        }
        
        .success-banner {
          background: var(--success-bg);
          border: 1px solid var(--success-border);
          border-radius: var(--radius-md);
          padding: 2rem;
          display: flex;
          gap: 1.5rem;
          align-items: flex-start;
          animation: fadeIn 0.3s ease-out;
        }
        
        .success-icon {
          color: var(--success);
          flex-shrink: 0;
        }
        
        .success-banner h3 {
          font-size: 1.2rem;
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 0.5rem;
        }
        
        .success-banner p {
          color: var(--text-secondary);
          line-height: 1.6;
          font-size: 0.95rem;
        }
        
        .warnings-section {
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          animation: fadeIn 0.3s ease-out;
        }
        
        .section-header h3 {
          font-size: 1.15rem;
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 0.25rem;
        }
        
        .section-header p {
          font-size: 0.85rem;
          color: var(--text-secondary);
        }
        
        .warnings-scroll-list {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          max-height: 420px;
          overflow-y: auto;
          padding-right: 0.5rem;
        }
        
        .warning-item {
          padding: 1rem 1.25rem;
          background: var(--warning-bg);
          border: 1px solid var(--warning-border);
          border-radius: var(--radius-sm);
        }
        
        .warning-item:hover {
          border-color: var(--warning-border);
        }
        
        .warn-meta {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-bottom: 0.4rem;
        }
        
        .warn-obj-name {
          font-size: 0.9rem;
          color: var(--text-primary);
        }
        
        .warn-text {
          font-size: 0.82rem;
          color: var(--text-secondary);
          line-height: 1.45;
        }
        
        .sql-tab {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          flex: 1;
        }
        
        .sql-preview-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.85rem;
          color: var(--text-secondary);
        }
        
        .btn-action-copy {
          background: none;
          border: none;
          color: var(--primary);
          cursor: pointer;
          font-family: var(--font-sans);
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 0.4rem;
          font-size: 0.85rem;
          transition: color 0.2s;
        }
        
        .btn-action-copy:hover {
          color: var(--primary-hover);
        }
        
        .sql-preview-box {
          background: var(--code-bg, rgba(8, 12, 24, 0.55));
          border: 1px solid var(--panel-border);
          border-radius: var(--radius-sm);
          padding: 1.25rem;
          font-family: var(--font-mono);
          font-size: 0.85rem;
          line-height: 1.5;
          max-height: 500px;
          overflow: auto;
          white-space: pre;
          color: var(--code-text, #cbd5e1);
        }
        
        .sql-preview-box code {
          background: none;
          padding: 0;
          color: var(--code-text, #cbd5e1);
        }
      `}</style>
    </div>
  );
}
