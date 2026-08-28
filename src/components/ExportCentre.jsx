import React, { useState, useMemo, useEffect } from 'react';
import JSZip from 'jszip';
import { getApiUrl } from '../utils/api';

function sortTopologically(list, allObjects, circularWarnings = null) {
  const result = [];
  const visited = new Set();
  const visiting = new Set();

  function visit(obj) {
    if (!obj?.classified?.id) return;
    if (visited.has(obj.classified.id)) return;
    if (visiting.has(obj.classified.id)) {
      if (circularWarnings) {
        circularWarnings.push(`Circular dependency detected: Object '${obj.classified.name}' is part of a dependency loop.`);
      }
      return;
    }
    visiting.add(obj.classified.id);

    const rawTextLower = (obj.translation.tsql || obj.classified.raw || '').toLowerCase();
    allObjects.forEach(other => {
      if (!other?.classified?.id) return;
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
    if (obj?.classified?.id && !result.some(r => r.classified?.id === obj.classified.id)) {
      result.push(obj);
    }
  });
  return result;
}

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
  const [compileResults, setCompileResults] = useState(null);
  const [backupSessionId, setBackupSessionId] = useState(null);
  const [bypassErrors, setBypassErrors] = useState(false);
  const [activeDrillDown, setActiveDrillDown] = useState(null);
  const [customDbName, setCustomDbName] = useState(() => {
    const prefix = settings?.sqlServerConfig?.dbPrefix || 'Migration';
    return `${prefix}_Db`;
  });

  const pendingAiCount = useMemo(() => objects.filter(o => o.translation.requiresAi).length, [objects]);
  const errorCount = validationReport?.errors?.length || 0;
  
  const sqlConfig = settings?.sqlServerConfig || {};
  const isConnected = sqlConfig.isConnected;

  const categoryOrder = ['SCHEMA', 'EXTENSION', 'ENUM', 'DOMAIN', 'COMPOSITE', 'SEQUENCE', 'TABLE', 'CONSTRAINT', 'INDEX', 'VIEW', 'FUNCTION', 'PROCEDURE', 'TRIGGER', 'DATA', 'OTHER'];

  const resolveSchemaName = (origSchema) => {
    const s = origSchema || 'dbo';
    if (!preserveSchema || s.toLowerCase() === 'public') {
      return 'dbo';
    }
    return s;
  };

  const getReferencedObjects = (rawSql, activeObjId) => {
    const refs = [];
    if (!rawSql) return refs;
    const cleanSql = rawSql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*/g, '');
    const words = cleanSql.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) || [];
    const uniqueWords = new Set(words.map(w => w.toLowerCase()));

    objects.forEach(other => {
      if (other.classified.id === activeObjId) return;
      const otherName = other.classified.name.toLowerCase();
      const otherSchema = resolveSchemaName(other.classified.schema).toLowerCase();
      const otherFullName = `${otherSchema}.${otherName}`;

      if (uniqueWords.has(otherName) || cleanSql.toLowerCase().includes(otherFullName)) {
        refs.push(other);
      }
    });
    return refs;
  };

  const getObjectFailureDetail = (obj) => {
    const name = obj.classified.name;
    const schema = resolveSchemaName(obj.classified.schema);
    const fullName = `${schema}.${name}`.toLowerCase();
    const nameLower = name.toLowerCase();
    const type = obj.classified.type;

    const deployErr = deployResults?.errors?.find(
      e => (e.object?.toLowerCase() === fullName || e.object?.toLowerCase() === nameLower) &&
           e.objectType === type
    );
    if (deployErr) {
      const errLower = deployErr.error.toLowerCase();
      const isDep = errLower.includes('invalid object name') || errLower.includes('could not find') || errLower.includes('dependency');
      if (!isDep) {
        return { error: deployErr.error, phase: 'Deployment' };
      }
    }

    const compileErr = compileResults?.compilationErrors?.find(
      e => e.object?.toLowerCase() === fullName || e.object?.toLowerCase() === nameLower || e.object?.toLowerCase() === `[${schema}].[${name}]`.toLowerCase()
    );
    if (compileErr) {
      const errLower = compileErr.error.toLowerCase();
      const isDep = errLower.includes('invalid object name') || errLower.includes('could not find') || errLower.includes('dependency');
      if (!isDep) {
        return { error: compileErr.error, phase: 'Validation' };
      }
    }

    return null;
  };

  const findRootCause = (obj, visited = new Set(), isFirstCall = true) => {
    if (visited.has(obj.classified.id)) return null;
    visited.add(obj.classified.id);

    if (!isFirstCall) {
      const failureDetail = getObjectFailureDetail(obj);
      if (failureDetail) {
        return { obj, detail: failureDetail };
      }
    }

    const deps = getReferencedObjects(obj.classified.raw, obj.classified.id);
    for (const dep of deps) {
      const oName = dep.classified.name.toLowerCase();
      const oSchema = resolveSchemaName(dep.classified.schema).toLowerCase();
      const oFullName = `${oSchema}.${oName}`;
      
      const inDeploy = deployResults?.errors?.some(
        e => (e.object?.toLowerCase() === oFullName || e.object?.toLowerCase() === oName) &&
             e.objectType === dep.classified.type
      );
      const inCompile = compileResults?.compilationErrors?.some(
        e => e.object?.toLowerCase() === oFullName || e.object?.toLowerCase() === oName || e.object?.toLowerCase() === `[${oSchema}].[${dep.classified.name}]`.toLowerCase()
      );
      if (inDeploy || inCompile) {
        const root = findRootCause(dep, visited, false);
        if (root) return root;
      }
    }
    return null;
  };

  const getDetailedObjectStatus = (obj) => {
    let name = obj.classified.name;
    if (name.includes('.')) {
      name = name.split('.').pop();
    }
    const schema = resolveSchemaName(obj.classified.schema);
    const type = obj.classified.type;
    const fullName = `${schema}.${name}`.toLowerCase();

    // Pattern B check: Skip checking catalog and fail if object is unconverted or requires AI
    const isUnconverted = obj.translation.requiresAi || 
                          (obj.translation.tsql && (
                            obj.translation.tsql.includes('PENDING AI TRANSLATION') || 
                            obj.translation.tsql.includes('NOT CONVERTED')
                          ));
    if (isUnconverted) {
      return {
        translation: obj.translation.requiresAi && !settings.apiKey ? 'PENDING' : 'FAILED',
        deployment: 'SKIPPED',
        validation: 'SKIPPED',
        status: 'Skipped',
        error: obj.translation.requiresAi ? 'Requires AI key for translation' : 'Not converted (unsupported feature)',
        category: 'SKIPPED_BY_RULE'
      };
    }

    // 1. Translation status
    let translation = 'SUCCESS';
    let translationCategory = 'SUCCESS';
    let translationError = null;

    if (obj.translation.requiresAi && !settings.apiKey) {
      translation = 'PENDING';
      translationCategory = 'SKIPPED_BY_RULE';
      translationError = 'Skipped: Requires AI key for translation';
    } else if (obj.translation.requiresAi) {
      if (!obj.translation.tsql || obj.translation.tsql.includes('PENDING AI TRANSLATION')) {
        translation = 'FAILED';
        translationCategory = 'AI_EMPTY_RESPONSE';
        translationError = 'Gemini returned empty or placeholder response';
      }
    } else if (obj.translation.tsql && obj.translation.tsql.includes('-- ERROR')) {
      translation = 'FAILED';
      translationCategory = 'TRANSLATION_ERROR';
      translationError = 'SQL translation contains conversion errors';
    }

    // 2. Deployment status
    let deployment = 'PENDING';
    let deploymentCategory = 'PENDING';
    let deploymentError = null;

    if (deployResults) {
      if (translation === 'FAILED') {
        deployment = 'FAILED';
        deploymentCategory = 'SKIPPED_AFTER_PREVIOUS_FAILURE';
        deploymentError = 'Skipped deployment due to translation failure';
      } else {
        const deployErr = deployResults.errors?.find(
          e => (e.object?.toLowerCase() === fullName || e.object?.toLowerCase() === name.toLowerCase()) &&
               e.objectType === type
        );
        if (deployErr) {
          deployment = 'FAILED';
          const isDep = deployErr.error.toLowerCase().includes('invalid object name') || deployErr.error.toLowerCase().includes('could not find');
          deploymentCategory = isDep ? 'MISSING_DEPENDENCY' : 'SQL_EXECUTION_ERROR';
          deploymentError = deployErr.error;
        } else {
          deployment = 'SUCCESS';
          deploymentCategory = 'SUCCESS';
        }
      }
    }

    // 3. Validation status
    let validation = 'PENDING';
    let validationCategory = 'PENDING';
    let validationError = null;

    if (compileResults) {
      if (deployment === 'FAILED') {
        validation = 'FAILED';
        validationCategory = 'SKIPPED_AFTER_PREVIOUS_FAILURE';
        validationError = 'Skipped validation due to deployment failure';
      } else {
        const compileErr = compileResults.compilationErrors?.find(
          e => e.object?.toLowerCase() === fullName || e.object?.toLowerCase() === name.toLowerCase() || e.object?.toLowerCase() === `[${schema}].[${name}]`.toLowerCase()
        );
        const depErr = compileResults.unresolvedDependencies?.find(
          e => e.object?.toLowerCase() === fullName || e.object?.toLowerCase() === name.toLowerCase() || e.object?.toLowerCase() === `${schema}.${name}`.toLowerCase()
        );
        
        if (depErr) {
          validation = 'FAILED';
          validationCategory = 'MISSING_DEPENDENCY';
          validationError = `Missing dependency: ${depErr.dependency}`;
        } else if (compileErr) {
          validation = 'FAILED';
          const isDep = compileErr.error.toLowerCase().includes('invalid object name') || compileErr.error.toLowerCase().includes('could not find');
          validationCategory = isDep ? 'MISSING_DEPENDENCY' : 'SQL_EXECUTION_ERROR';
          validationError = compileErr.error;
        } else {
          const checkInList = (list) => {
            if (!list) return false;
            return list.some(n => {
              if (!n) return false;
              const nName = typeof n === 'string' ? n : (n.name || '');
              const nSchema = typeof n === 'string' ? 'dbo' : (n.schema || 'dbo');
              if (typeof n === 'string' && n.includes('.')) {
                const parts = n.split('.');
                return parts[1].toLowerCase() === name.toLowerCase() && parts[0].toLowerCase() === schema.toLowerCase();
              }
              if (type === 'SCHEMA') return nName.toLowerCase() === name.toLowerCase();
              return nName.toLowerCase() === name.toLowerCase() && nSchema.toLowerCase() === schema.toLowerCase();
            });
          };

          const categoryMap = {
            SCHEMA: 'schemas',
            TABLE: 'tables',
            VIEW: 'views',
            PROCEDURE: 'procedures',
            FUNCTION: 'functions',
            TRIGGER: 'triggers',
            CONSTRAINT: 'constraints',
            INDEX: 'indexes',
            SEQUENCE: 'sequences'
          };
          const isTempTable = (type === 'TABLE' && (obj.classified.parsed?.isGlobalTemp || obj.classified.parsed?.isLocalTemp));
          const listKey = categoryMap[type];
          let isCreated = false;
          
          if (isTempTable) {
            isCreated = (deployment === 'SUCCESS');
          } else if (listKey) {
            isCreated = checkInList(compileResults.deployedObjects?.[listKey]);
            if (!isCreated && (type === 'FUNCTION' || type === 'PROCEDURE')) {
              const otherKey = type === 'FUNCTION' ? 'procedures' : 'functions';
              isCreated = checkInList(compileResults.deployedObjects?.[otherKey]);
            }
          } else {
            isCreated = true;
          }

          if (isCreated) {
            validation = 'SUCCESS';
            validationCategory = 'SUCCESS';
          } else {
            validation = 'FAILED';
            validationCategory = 'UNKNOWN';
            validationError = 'Object definition not found in SQL Server catalog';
          }
        }
      }
    }

    // Unified summary status
    let status = 'Skipped';
    let error = null;
    let category = 'SUCCESS';

    if (translation === 'FAILED' || deployment === 'FAILED' || validation === 'FAILED') {
      status = (validationCategory === 'MISSING_DEPENDENCY' || deploymentCategory === 'MISSING_DEPENDENCY') ? 'Dependency Missing' : 'Failed';
      error = (validationCategory === 'SKIPPED_AFTER_PREVIOUS_FAILURE') 
        ? (deploymentError || translationError || validationError) 
        : ((deploymentCategory === 'SKIPPED_AFTER_PREVIOUS_FAILURE')
          ? (translationError || deploymentError || validationError)
          : (validationError || deploymentError || translationError));
      category = validationCategory !== 'PENDING' ? validationCategory : (deploymentCategory !== 'PENDING' ? deploymentCategory : translationCategory);

      if (status === 'Failed' || status === 'Dependency Missing') {
        const directFailure = getObjectFailureDetail(obj);
        if (!directFailure) {
          const root = findRootCause(obj);
          if (root) {
            error = `Skipped: depends on [${root.obj.classified.schema || 'dbo'}].[${root.obj.classified.name}] (${root.obj.classified.type}) which failed to deploy.`;
            status = 'Dependency Missing';
          }
        }
      }
    } else if (translation === 'SUCCESS' && deployment === 'SUCCESS' && validation === 'SUCCESS') {
      status = 'Verified';
      category = 'SUCCESS';
      const isTempTable = (type === 'TABLE' && (obj.classified.parsed?.isGlobalTemp || obj.classified.parsed?.isLocalTemp));
      if (isTempTable) {
        error = '✓ PASS (Session-scoped temp table — not stored in global catalog)';
      }
    } else {
      status = 'Skipped';
      category = translationCategory !== 'SUCCESS' ? translationCategory : 'PENDING';
      error = translationError;
    }

    return {
      translation,
      deployment,
      validation,
      status,
      error,
      category
    };
  };

  const getObjectStatusAndError = (obj) => {
    const res = getDetailedObjectStatus(obj);
    return { status: res.status, error: res.error };
  };

  const breakdownCategories = [
    { label: 'Schemas', type: 'SCHEMA' },
    { label: 'Tables', type: 'TABLE' },
    { label: 'Views', type: 'VIEW' },
    { label: 'Stored Procedures', type: 'PROCEDURE' },
    { label: 'Functions', type: 'FUNCTION' },
    { label: 'Triggers', type: 'TRIGGER' },
    { label: 'Constraints & Keys', type: 'CONSTRAINT' },
    { label: 'Indexes', type: 'INDEX' },
    { label: 'Sequences', type: 'SEQUENCE' },
    { label: 'Custom Types/Domains/Enums', type: 'CUSTOM_TYPE' }
  ];

  const categoryStats = useMemo(() => {
    return breakdownCategories.map(cat => {
      let catObjects = [];
      if (cat.type === 'SEQUENCE') {
        catObjects = objects.filter(o => o.classified.type === 'SEQUENCE');
      } else if (cat.type === 'CUSTOM_TYPE') {
        catObjects = objects.filter(o => ['ENUM', 'DOMAIN', 'COMPOSITE'].includes(o.classified.type));
      } else if (cat.type === 'FUNCTION') {
        catObjects = objects.filter(o => o.classified.type === 'FUNCTION' && !o.classified.parsed?.returnsTrigger);
      } else {
        catObjects = objects.filter(o => o.classified.type === cat.type);
      }


      let migrated = 0;
      let failed = 0;
      let skipped = 0;
      const items = catObjects.map(obj => {
        const detail = getDetailedObjectStatus(obj);
        if (detail.status === 'Verified') migrated++;
        else if (detail.status === 'Failed' || detail.status === 'Dependency Missing') failed++;
        else skipped++;
        return {
          id: obj.classified.id || `${obj.classified.schema}.${obj.classified.name}`,
          schema: obj.classified.schema || 'dbo',
          name: obj.classified.name,
          status: detail.status,
          error: detail.error,
          translation: detail.translation,
          deployment: detail.deployment,
          validation: detail.validation,
          category: detail.category
        };
      });

      const totalCount = catObjects.length;

      let targetCount = 0;
      if (compileResults) {
        targetCount = migrated;
      }

      const missing = Math.max(0, totalCount - targetCount);
      const extra = Math.max(0, targetCount - totalCount);
      const successRate = totalCount > 0 ? Math.round((migrated / totalCount) * 100) : 100;

      return {
        ...cat,
        sourceCount: totalCount,
        targetCount,
        migrated,
        missing,
        failed,
        extra,
        skipped,
        successRate,
        items
      };
    });
  }, [objects, deployResults, compileResults]);

  const totalStats = useMemo(() => {
    let source = 0;
    let migrated = 0;
    let failed = 0;
    let skipped = 0;

    categoryStats.forEach(cat => {
      source += cat.sourceCount;
      migrated += cat.migrated;
      failed += cat.failed;
      skipped += cat.skipped;
    });

    const rate = source > 0 ? Math.round((migrated / source) * 100) : 100;

    return { source, migrated, failed, skipped, rate };
  }, [categoryStats]);

  const firstDeploymentError = useMemo(() => {
    if (deployResults?.errors && deployResults.errors.length > 0) {
      const tblErr = deployResults.errors.find(e => e.objectType === 'TABLE');
      if (tblErr) return { name: tblErr.object, type: 'TABLE', phase: 'Deployment', error: tblErr.error };
      const otherErr = deployResults.errors[0];
      return { name: otherErr.object, type: otherErr.objectType, phase: 'Deployment', error: otherErr.error };
    }
    if (compileResults?.compilationErrors && compileResults.compilationErrors.length > 0) {
      const tblErr = compileResults.compilationErrors.find(e => e.objectType === 'TABLE');
      if (tblErr) return { name: tblErr.object, type: 'TABLE', phase: 'Validation', error: tblErr.error };
      const otherErr = compileResults.compilationErrors[0];
      return { name: otherErr.object, type: otherErr.objectType, phase: 'Validation', error: otherErr.error };
    }
    return null;
  }, [deployResults, compileResults]);

  const failedObjects = useMemo(() => {
    const list = [];
    objects.forEach(obj => {
      const isUnconverted = obj.translation.requiresAi || 
                            (obj.translation.tsql && (
                              obj.translation.tsql.includes('PENDING AI TRANSLATION') || 
                              obj.translation.tsql.includes('NOT CONVERTED')
                            ));
      if (isUnconverted) {
        return; // Exclude Pattern B
      }

      const res = getDetailedObjectStatus(obj);
      if (res.status === 'Failed' || res.status === 'Dependency Missing') {
        let name = obj.classified.name;
        if (name.includes('.')) {
          name = name.split('.').pop();
        }
        
        const rootCause = findRootCause(obj);
        
        list.push({
          id: obj.classified.id || `${resolveSchemaName(obj.classified.schema)}.${obj.classified.name}`,
          name: name,
          schema: resolveSchemaName(obj.classified.schema),
          type: obj.classified.type,
          status: res.status,
          error: res.error,
          rootCause: rootCause ? {
            id: rootCause.obj.classified.id || `${resolveSchemaName(rootCause.obj.classified.schema)}.${rootCause.obj.classified.name}`,
            name: rootCause.obj.classified.name,
            schema: resolveSchemaName(rootCause.obj.classified.schema),
            type: rootCause.obj.classified.type,
            error: rootCause.detail.error
          } : null
        });
      }
    });
    return list;
  }, [objects, getDetailedObjectStatus]);

  const drillDownCat = useMemo(() => {
    if (!activeDrillDown) return null;
    return categoryStats.find(cat => cat.type === activeDrillDown);
  }, [categoryStats, activeDrillDown]);

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
    const circularWarnings = [];
    ['SCHEMA', 'EXTENSION', 'ENUM', 'DOMAIN', 'COMPOSITE', 'SEQUENCE', 'TABLE', 'CONSTRAINT', 'INDEX'].forEach(type => {
      const list = grouped[type];
      if (list && list.length > 0) sortedByType[type] = sortTopologically(list, objects, circularWarnings);
    });

    const routinesList = [...grouped['VIEW'], ...grouped['FUNCTION'], ...grouped['PROCEDURE'], ...grouped['TRIGGER']];
    const sortedRoutines = routinesList.length > 0 ? sortTopologically(routinesList, objects, circularWarnings) : [];
    
    if (circularWarnings.length > 0) {
      circularWarnings.forEach(w => {
        warningsList.push({ type: 'CIRCULAR_DEPENDENCY', name: 'Routines Dependency Graph', text: w });
      });
    }

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
      console.error('Error generating zip:', err);
    }
  };

  const generateMarkdownReport = () => {
    const summary = reportData.stats;
    const warningsList = reportData.warningsList;
    const errorsList = validationReport?.errors || [];
    const manualFixesList = validationReport?.manualFixes || [];

    let details = '';

    if (errorsList.length > 0) {
      details += `### Syntax Errors (${errorsList.length})\n`;
      errorsList.forEach(err => {
        details += `- **[${err.type}] ${err.object}**: ${err.error}\n`;
      });
      details += '\n';
    }

    if (warningsList.length > 0) {
      details += `### Compiler Warnings (${warningsList.length})\n`;
      warningsList.forEach(w => {
        details += `- **[${w.type}] ${w.name}**: ${w.text}\n`;
      });
      details += '\n';
    }

    if (manualFixesList.length > 0) {
      details += `### Manual Adjustments Required (${manualFixesList.length})\n`;
      manualFixesList.forEach(mf => {
        details += `- **[${mf.type}] ${mf.object}**: ${mf.description}\n`;
      });
      details += '\n';
    }

    if (!details) {
      details = 'No critical syntax errors, compiler warnings, or manual adjustments required.\n';
    }

    const triggerLogSection = generateTriggerLog();
    const objectLogSection = generateDetailedObjectReport();

    return `# SQL Server Migration Assessment Report
Generated from: ${originalFileName}
Dialect: ${sourceDialect.toUpperCase()}

## Conversion Summary
- Total Objects Parsed: ${summary.total}
- Tables Converted: ${summary.TABLE}
- Constraints Converted: ${summary.CONSTRAINT}
- Sequences Converted: ${summary.SEQUENCE}
- Programmable Objects (Views/Procedures/Functions/Triggers): ${summary.complex}
- Translation Warnings Flagged: ${summary.warnings}

## Post-Conversion Validation Summary
- Syntax Errors: ${errorsList.length}
- Warnings: ${warningsList.length}
- Manual Checks Needed: ${manualFixesList.length}

## Detailed Validation Findings
${details}

## Trigger Migration Log
${triggerLogSection}

## Detailed Object-Level Migration Log
${objectLogSection}`;
  };

  const generateDetailedObjectReport = () => {
    let log = "Object Type | Schema | Object Name | Source Status | Target Status | Migration Status | Error\n";
    log += "---|---|---|---|---|---|---\n";

    objects.forEach(obj => {
      const type = obj.classified.type;
      const schema = obj.classified.schema || 'dbo';
      const name = obj.classified.name;
      
      const { status, error } = getObjectStatusAndError(obj);
      
      let sourceStatus = "FOUND";
      let targetStatus = status === 'Verified' ? "FOUND" : "NOT_FOUND";
      let migrationStatus = "FAILED";
      
      if (status === 'Verified') {
        migrationStatus = "MIGRATED";
      } else if (status === 'Skipped') {
        migrationStatus = "MISSING";
      } else if (status === 'Failed') {
        migrationStatus = "FAILED";
      }
      
      log += `${type} | ${schema} | ${name} | ${sourceStatus} | ${targetStatus} | ${migrationStatus} | ${error || 'N/A'}\n`;
    });

    if (compileResults?.deployedObjects) {
      const categoryMap = {
        SCHEMA: 'schemas',
        TABLE: 'tables',
        VIEW: 'views',
        PROCEDURE: 'procedures',
        FUNCTION: 'functions',
        TRIGGER: 'triggers',
        CONSTRAINT: 'constraints',
        INDEX: 'indexes',
        SEQUENCE: 'sequences'
      };
      
      Object.keys(categoryMap).forEach(type => {
        const listKey = categoryMap[type];
        const foundList = compileResults.deployedObjects[listKey] || [];
        foundList.forEach(targetObj => {
          const tName = targetObj.name;
          const tSchema = targetObj.schema || 'dbo';
          
          const existsInSource = objects.some(o => 
            o.classified.type === type && 
            o.classified.name.toLowerCase() === tName.toLowerCase() && 
            (o.classified.schema || 'dbo').toLowerCase() === tSchema.toLowerCase()
          );
          
          if (!existsInSource) {
            log += `${type} | ${tSchema} | ${tName} | NOT_FOUND | FOUND | EXTRA | N/A\n`;
          }
        });
      });
    }

    return log;
  };

  const downloadObjectLog = () => {
    const logText = generateDetailedObjectReport();
    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = originalFileName.replace(/\.[^/.]+$/, "") + '_object_migration_log.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const generateTriggerLog = () => {
    let log = "Source Schema | Source Trigger Name | Source Parent Table | Trigger Source | Reason for generation | Target Trigger Name | Migration Status\n";
    log += "---|---|---|---|---|---|---\n";

    const explicitTriggers = objects.filter(o => o.classified.type === 'TRIGGER');
    explicitTriggers.forEach(obj => {
      const schema = obj.classified.schema || 'dbo';
      const name = obj.classified.name;
      const tableName = obj.classified.tableName || obj.parsed?.tableName || 'Unknown';
      
      const { status } = getObjectStatusAndError(obj);
      const migrationStatus = status === 'Verified' ? 'SUCCESS' : (status === 'Failed' ? 'FAILED' : 'SKIPPED');

      log += `${schema} | ${name} | ${tableName} | EXPLICIT | N/A | ${name} | ${migrationStatus}\n`;
    });

    objects.forEach(obj => {
      if (obj.classified.type === 'TABLE' && obj.parsed?.columns) {
        const hasOnUpdate = obj.parsed.columns.some(c => c.onUpdateExpr);
        if (hasOnUpdate) {
          const schema = obj.classified.schema || 'dbo';
          const tableName = obj.classified.name;
          log += `${schema} | NULL | ${tableName} | GENERATED | ON UPDATE CURRENT_TIMESTAMP | NULL | SKIPPED (Bypassed per rule)\n`;
        }
      }
    });

    return log;
  };

  const downloadTriggerLog = () => {
    const logText = generateTriggerLog();
    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = originalFileName.replace(/\.[^/.]+$/, "") + '_trigger_migration_log.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
    if (!isConnected || ((!bypassErrors && errorCount > 0) || (!bypassErrors && pendingAiCount > 0))) return;
    
    setDeployPhase('deploying');
    setDeployProgress(0);
    setDeployTotal(objects.length);
    setDeployLogs([]);
    setDeployResults(null);
    setCompileResults(null);
    setBackupSessionId(null);

    const dbName = customDbName.trim() || `${sqlConfig.dbPrefix || 'Migration'}_Db`;
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
                setCompileResults(evt.data.compileResult);
                
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
      let errMsg = `Operation failed: ${err.message}`;
      if (err.message.toLowerCase().includes('fetch') && window.location.protocol === 'https:') {
        errMsg = `Operation failed: Local Agent connection blocked. Because this site is running on HTTPS (${window.location.host}), your browser blocks direct HTTP requests to the local server (Mixed Content). To deploy, please run the application locally (via 'npm run dev:full' or double-clicking the startup script) and access it at http://localhost:5173 or http://localhost:3000 instead.`;
      }
      setDeployLogs(prev => [...prev, { type: 'error', msg: errMsg }]);
    }
  };

  return (
    <div className="export-centre">
      {errorCount > 0 && (
        <div className={`hard-rule-banner glass-panel ${bypassErrors ? 'warning-banner' : ''}`} style={bypassErrors ? { borderLeftColor: 'var(--warning)', background: 'rgba(245, 158, 11, 0.05)' } : {}}>
          {bypassErrors ? (
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="var(--warning)" strokeWidth="2" fill="none">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          )}
          <div>
            <strong style={{ display: 'block', fontSize: '1rem', marginBottom: '0.2rem', color: bypassErrors ? 'var(--warning)' : 'var(--error)' }}>
              {bypassErrors ? '⚠️ Database Deployment Override Active' : 'Database export blocked'}
            </strong>
            <span style={{ fontSize: '0.85rem' }}>
              {bypassErrors 
                ? `Proceeding with deployment despite ${errorCount} compilation/validation errors. Output .BAK will be watermarked as DRAFT.`
                : `Resolve all ${errorCount} errors before generating .BAK`}
            </span>
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
                  <div style={{ marginBottom: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.4rem', maxWidth: '350px' }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                      Target Database Name
                    </label>
                    <input
                      type="text"
                      className="form-control"
                      value={customDbName}
                      onChange={(e) => setCustomDbName(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                      placeholder="e.g. MyMigrationDb"
                      style={{ 
                        padding: '0.5rem 0.75rem', 
                        fontSize: '0.85rem', 
                        borderRadius: '6px', 
                        border: '1px solid var(--panel-border)', 
                        background: 'var(--panel-tab-bg)', 
                        color: 'var(--text-primary)',
                        width: '100%',
                        boxSizing: 'border-box'
                      }}
                    />
                    <small style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      Specify the name of the database to create on SQL Server for deployment.
                    </small>
                  </div>

                  <button 
                    className={`btn btn-primary deploy-btn ${((!bypassErrors && errorCount > 0) || (!bypassErrors && pendingAiCount > 0)) ? 'disabled' : ''}`}
                    onClick={startDeployment}
                    disabled={(!bypassErrors && errorCount > 0) || (!bypassErrors && pendingAiCount > 0)}
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
                        <span>Force deploy and generate .BAK (Bypass errors & pending translations)</span>
                      </label>
                    </div>
                  )}
                </>
              )}

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

                  {deployPhase === 'backing_up' && (
                    <div className="deploy-progress">
                      <div className="progress-text">Generating SQL Server Backup (.BAK)...</div>
                      <div className="progress-bar">
                        <div className="progress-bar-fill" style={{ width: '85%', animation: 'pulse 1.5s infinite' }}></div>
                      </div>
                    </div>
                  )}

                  {deployPhase === 'completed' && (
                    <div className="migration-summary-dashboard">
                      <h4 className="dashboard-title">Migration Summary Dashboard</h4>
                      
                      <div className="dashboard-cards-grid">
                        <div className="dashboard-card success-rate-card">
                          <div className="card-label">Overall Success Rate</div>
                          <div className="card-value">{totalStats.rate}%</div>
                          <div className="card-desc">{totalStats.migrated} of {totalStats.source} objects verified</div>
                        </div>
                        <div className="dashboard-card verified-card">
                          <div className="card-label">Verified Objects</div>
                          <div className="card-value text-success">{totalStats.migrated}</div>
                          <div className="card-desc">Created in target database</div>
                        </div>
                        <div className="dashboard-card failed-card">
                          <div className="card-label">Failed Objects</div>
                          <div className="card-value text-error">{totalStats.failed}</div>
                          <div className="card-desc">Failed compilation or creation</div>
                        </div>
                        <div className="dashboard-card skipped-card">
                          <div className="card-label">Skipped Objects</div>
                          <div className="card-value text-warning">{totalStats.skipped}</div>
                          <div className="card-desc">Skipped during deployment</div>
                        </div>
                      </div>

                      {firstDeploymentError && (
                        <div className="hard-rule-banner glass-panel error-banner" style={{ borderLeftColor: 'var(--error)', background: 'rgba(239, 68, 68, 0.05)', marginBottom: '1.5rem', padding: '1rem', display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                          <svg viewBox="0 0 24 24" width="24" height="24" stroke="var(--error)" strokeWidth="2" fill="none" style={{ flexShrink: 0, marginTop: '0.2rem' }}>
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="8" x2="12" y2="12" />
                            <line x1="12" y1="16" x2="12.01" y2="16" />
                          </svg>
                          <div>
                            <strong style={{ display: 'block', fontSize: '1.05rem', color: 'var(--error)', marginBottom: '0.25rem' }}>
                              Critical {firstDeploymentError.phase} Error in {firstDeploymentError.type}: [ {firstDeploymentError.name} ]
                            </strong>
                            <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontFamily: 'monospace', display: 'block', wordBreak: 'break-all' }}>
                              {firstDeploymentError.error}
                            </span>
                            <small style={{ display: 'block', marginTop: '0.5rem', color: 'var(--text-secondary)' }}>
                              ⚠️ This failure likely caused downstream views, programmable objects, and foreign keys to fail due to missing dependencies.
                            </small>
                          </div>
                        </div>
                      )}

                      {!activeDrillDown ? (
                        <div className="breakdown-table-container">
                          <h5>Object Type Breakdown</h5>
                          <table className="object-counts-table">
                            <thead>
                              <tr>
                                <th>Object Type</th>
                                <th>Source Count</th>
                                <th>Target Count</th>
                                <th>Migrated</th>
                                <th>Missing</th>
                                <th>Failed</th>
                                <th>Extra</th>
                                <th>Success %</th>
                                <th>Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {categoryStats.map(cat => (
                                <tr key={cat.label}>
                                  <td><strong>{cat.label}</strong></td>
                                  <td>{cat.sourceCount}</td>
                                  <td>{cat.targetCount}</td>
                                  <td className="text-success">{cat.migrated}</td>
                                  <td className={cat.missing > 0 ? "text-warning" : ""}>{cat.missing}</td>
                                  <td className={cat.failed > 0 ? "text-error" : ""}>{cat.failed}</td>
                                  <td className={cat.extra > 0 ? "text-error" : ""}>{cat.extra}</td>
                                  <td>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                      <div className="success-bar-container" style={{ width: '60px', height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                                        <div className="success-bar-fill" style={{ height: '100%', background: 'var(--success)', width: `${cat.successRate}%` }}></div>
                                      </div>
                                      <span>{cat.successRate}%</span>
                                    </div>
                                  </td>
                                  <td>
                                    <button 
                                      className="btn btn-secondary btn-sm"
                                      onClick={() => setActiveDrillDown(cat.type)}
                                      disabled={cat.sourceCount === 0}
                                      style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                                    >
                                      View Details ➔
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="drilldown-table-container">
                          <div className="drilldown-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <h5>Details for: {drillDownCat?.label}</h5>
                            <button 
                              className="btn btn-secondary btn-sm"
                              onClick={() => setActiveDrillDown(null)}
                            >
                              ← Back to Summary
                            </button>
                          </div>
                          
                          <div style={{ maxHeight: '350px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                            <table className="object-counts-table" style={{ margin: 0 }}>
                              <thead>
                                <tr>
                                  <th>Schema</th>
                                  <th>Object Name</th>
                                  <th>Translation</th>
                                  <th>Deployment</th>
                                  <th>Validation</th>
                                  <th>Category</th>
                                  <th>Error / Reason</th>
                                </tr>
                              </thead>
                              <tbody>
                                {drillDownCat?.items.map(item => (
                                  <tr key={item.id}>
                                    <td><code>{item.schema}</code></td>
                                    <td><code>{item.name}</code></td>
                                    <td>
                                      <span className={`status-badge ${item.translation.toLowerCase()}`}>
                                        {item.translation}
                                      </span>
                                    </td>
                                    <td>
                                      <span className={`status-badge ${item.deployment.toLowerCase()}`}>
                                        {item.deployment}
                                      </span>
                                    </td>
                                    <td>
                                      <span className={`status-badge ${item.validation.toLowerCase().replace(/\s+/g, '-')}`}>
                                        {item.validation}
                                      </span>
                                    </td>
                                    <td>
                                      <code style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                        {item.category}
                                      </code>
                                    </td>
                                    <td className="error-cell-text" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                      {item.error ? <code>{item.error}</code> : <span style={{ color: 'var(--success)' }}>✓ OK</span>}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      <div className="deploy-success-actions" style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                        {backupSessionId && (
                          <a 
                            href={getApiUrl(`/api/backup/download/${backupSessionId}`)} 
                            className={`btn ${bypassErrors ? 'btn-warning' : 'btn-primary'}`}
                            style={bypassErrors ? { backgroundColor: 'var(--warning)', borderColor: 'var(--warning)', color: '#000', fontWeight: '800' } : {}}
                            download
                          >
                            {bypassErrors ? '⚠️ Download Draft .BAK' : 'Download .BAK'}
                          </a>
                        )}
                        <button className="btn btn-secondary" onClick={downloadReportFile}>
                          Download Validation Report
                        </button>
                        <button className="btn btn-secondary" onClick={downloadTriggerLog}>
                          Download Trigger Log
                        </button>
                        <button className="btn btn-secondary" onClick={downloadObjectLog}>
                          Download Object Log
                        </button>
                        <button 
                          className="btn btn-secondary"
                          onClick={() => {
                            setDeployPhase(null);
                            setCompileResults(null);
                            setActiveDrillDown(null);
                            setDeployLogs([]);
                          }}
                        >
                          New Deployment
                        </button>
                      </div>

                      {failedObjects.length > 0 && (
                        <div className="failed-objects-list-container glass-panel" style={{ marginTop: '2rem', borderTop: '2px solid var(--error)', padding: '1.5rem' }}>
                          <h5 style={{ color: 'var(--error)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none">
                              <circle cx="12" cy="12" r="10" />
                              <line x1="12" y1="8" x2="12" y2="12" />
                              <line x1="12" y1="16" x2="12.01" y2="16" />
                            </svg>
                            Objects Requiring Attention ({failedObjects.length})
                          </h5>
                          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
                            The following objects failed to deploy or validate. Fix the <strong>Root Cause Failures</strong> first to automatically resolve downstream dependencies.
                          </p>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                            {/* Group 1: Root Cause Failures */}
                            <div className="failed-group-card" style={{ border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 'var(--radius)', padding: '1rem', background: 'rgba(239, 68, 68, 0.02)' }}>
                              <h6 style={{ color: 'var(--error)', marginBottom: '0.75rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span>🔴 Root Cause Failures (Must Fix First)</span>
                                <span className="status-badge failed" style={{ fontSize: '0.75rem', padding: '0.1rem 0.4rem' }}>
                                  {failedObjects.filter(f => !f.rootCause).length}
                                </span>
                              </h6>
                              <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                                <table className="object-counts-table" style={{ margin: 0 }}>
                                  <thead>
                                    <tr>
                                      <th>Type</th>
                                      <th>Schema</th>
                                      <th>Name</th>
                                      <th>Error Message</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {failedObjects.filter(f => !f.rootCause).map((item) => {
                                      const downstreamCount = failedObjects.filter(d => d.rootCause && d.rootCause.id === item.id).length;
                                      return (
                                        <tr key={item.id}>
                                          <td><span className="status-badge failed">{item.type}</span></td>
                                          <td><code>{item.schema}</code></td>
                                          <td>
                                            <strong><code>{item.name}</code></strong>
                                            {downstreamCount > 0 && (
                                              <span className="status-badge warning" style={{ marginLeft: '0.5rem', fontSize: '0.7rem', padding: '0.1rem 0.3rem', verticalAlign: 'middle' }}>
                                                Blocks {downstreamCount} downstream item{downstreamCount > 1 ? 's' : ''}
                                              </span>
                                            )}
                                          </td>
                                          <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'left' }}>
                                            <code>{item.error}</code>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                    {failedObjects.filter(f => !f.rootCause).length === 0 && (
                                      <tr>
                                        <td colSpan="4" style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '1rem' }}>No direct root-cause failures found.</td>
                                      </tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </div>

                            {/* Group 2: Cascading / Blocked Failures */}
                            <div className="failed-group-card" style={{ border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: 'var(--radius)', padding: '1rem', background: 'rgba(245, 158, 11, 0.01)' }}>
                              <h6 style={{ color: 'var(--warning)', marginBottom: '0.75rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span>⚠️ Cascading / Blocked Objects</span>
                                <span className="status-badge warning" style={{ fontSize: '0.75rem', padding: '0.1rem 0.4rem', color: '#000', backgroundColor: 'var(--warning)' }}>
                                  {failedObjects.filter(f => f.rootCause).length}
                                </span>
                              </h6>
                              <div style={{ maxHeight: '250px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                                <table className="object-counts-table" style={{ margin: 0 }}>
                                  <thead>
                                    <tr>
                                      <th>Type</th>
                                      <th>Schema</th>
                                      <th>Name</th>
                                      <th>Blocked By (Root Cause)</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {failedObjects.filter(f => f.rootCause).map((item) => (
                                      <tr key={item.id}>
                                        <td><span className="status-badge skipped">{item.type}</span></td>
                                        <td><code>{item.schema}</code></td>
                                        <td><code>{item.name}</code></td>
                                        <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'left' }}>
                                          <span>Skipped: depends on </span>
                                          <strong><code>[{item.rootCause.schema}].[{item.rootCause.name}]</code></strong>
                                          <span> ({item.rootCause.type}) which failed to deploy.</span>
                                        </td>
                                      </tr>
                                    ))}
                                    {failedObjects.filter(f => f.rootCause).length === 0 && (
                                      <tr>
                                        <td colSpan="4" style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '1rem' }}>No cascading failures.</td>
                                      </tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {deployPhase !== 'completed' && (
                    <div className="deploy-log">
                      {deployLogs.map((log, i) => (
                        <div key={i} className={`deploy-log-entry ${log.type}`}>
                          {log.msg}
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {deployPhase === 'completed' && (
                    <details className="deploy-log-details" style={{ marginTop: '1.5rem' }}>
                      <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                        View Raw Deployment Logs ({deployLogs.length} entries)
                      </summary>
                      <div className="deploy-log" style={{ marginTop: '0.5rem', maxHeight: '180px' }}>
                        {deployLogs.map((log, i) => (
                          <div key={i} className={`deploy-log-entry ${log.type}`}>
                            {log.msg}
                          </div>
                        ))}
                      </div>
                    </details>
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
