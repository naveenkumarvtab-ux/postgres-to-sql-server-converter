import React, { useState, useEffect, useMemo } from 'react';
import Header from './components/Header';
import SettingsPanel from './components/SettingsPanel';
import UploadZone from './components/UploadZone';
import Workspace from './components/Workspace';
import SummaryReport from './components/SummaryReport';
import AuthModal from './components/AuthModal';
import ResetPasswordModal from './components/ResetPasswordModal';
import { supabase } from './utils/supabaseClient';
import { splitSqlStatements, classifyStatement, splitOraclePackageBody, buildSchemaMap } from './utils/parser';
import { translateObject, resolveDependencies, applySqlConversionRules, validateFunctionTsql } from './utils/translator';
import { translatePLpgSQLWithAI } from './utils/gemini';
import { validateMigration } from './utils/validator';

export default function App() {
  const [step, setStep] = useState('upload'); // upload | workspace | summary
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [objects, setObjects] = useState([]);
  const [rawClassified, setRawClassified] = useState([]);
  const [isTranslatingMap, setIsTranslatingMap] = useState({});
  const [metadata, setMetadata] = useState(null);
  const [isBulkTranslating, setIsBulkTranslating] = useState(false);
  const [user, setUser] = useState(null);
  const [authBypassed, setAuthBypassed] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [sourceDialect, setSourceDialect] = useState('postgres'); // postgres | oracle
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [resetToken, setResetToken] = useState(null);
  const [validationReport, setValidationReport] = useState(null);
  const [originalFileName, setOriginalFileName] = useState('schema.sql');

  useEffect(() => {
    if (objects.length === 0) {
      setValidationReport(null);
      return;
    }
    const items = objects.map(o => ({
      name: o.classified.name,
      schema: o.classified.schema,
      type: o.classified.type,
      tsql: o.translation.tsql,
      requiresAi: o.translation.requiresAi,
      parsed: o.classified.parsed
    }));
    const report = validateMigration(items, sourceDialect);
    setValidationReport(report);
  }, [objects]);
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('transpile_db_theme') || 'dark';
  });

  useEffect(() => {
    if (theme === 'light') {
      document.body.classList.add('light-theme');
    } else {
      document.body.classList.remove('light-theme');
    }
    localStorage.setItem('transpile_db_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  // Inactivity timeout handler (30 minutes of no user interactions)
  useEffect(() => {
    if (!user && !authBypassed) return;

    let timeoutId;
    const INACTIVITY_LIMIT = 30 * 60 * 1000; // 30 minutes in milliseconds

    const handleLogout = () => {
      if (user) {
        supabase.auth.signOut();
      }
      setUser(null);
      setAuthBypassed(false);
      alert('You have been logged out due to 30 minutes of inactivity.');
    };

    const resetTimer = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(handleLogout, INACTIVITY_LIMIT);
    };

    // Listen to mouse movement, key presses, clicks, and touches
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    const addListeners = () => {
      events.forEach(event => window.addEventListener(event, resetTimer));
    };
    const removeListeners = () => {
      events.forEach(event => window.removeEventListener(event, resetTimer));
    };

    addListeners();
    resetTimer();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      removeListeners();
    };
  }, [user, authBypassed]);

  useEffect(() => {
    // Check if there is a custom Brevo reset token in the URL search query params
    const params = new URLSearchParams(window.location.search);
    const token = params.get('reset_token');
    if (token) {
      setResetToken(token);
      setIsResettingPassword(true);
    }

    // Check current session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    }).catch(() => {
      setAuthLoading(false);
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
      
      if (event === 'PASSWORD_RECOVERY') {
        setIsResettingPassword(true);
      }
    });

    const handleGoToSummary = () => setStep('summary');
    window.addEventListener('trigger-go-to-summary', handleGoToSummary);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('trigger-go-to-summary', handleGoToSummary);
    };
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setAuthBypassed(false);
  };

  // Settings state (hydrated from localStorage)
  const [settings, setSettings] = useState(() => {
    const saved = localStorage.getItem('transpile_db_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (!['gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-3.1-pro'].includes(parsed.model)) {
          parsed.model = 'gemini-3.1-flash-lite';
        }
        if (parsed.preserveSchema === undefined) {
          parsed.preserveSchema = true;
        }
        return parsed;
      } catch (e) {
        console.error('Failed to parse settings', e);
      }
    }
    return {
      apiKey: '',
      useUnicode: true,
      model: 'gemini-3.1-flash-lite',
      deploymentMode: 'migration',
      sqlServerVersion: '2017+',
      preserveSchema: true,
      sqlServerConfig: {
        server: 'localhost',
        authMode: 'windows',
        username: '',
        password: '',
        dbPrefix: 'Migration',
        backupDir: 'C:\\MigrationToSQL\\exports',
        targetProfile: 'sql2022',
        isConnected: false,
        serverInfo: null
      }
    };
  });

  // Persist settings
  useEffect(() => {
    localStorage.setItem('transpile_db_settings', JSON.stringify(settings));
  }, [settings]);

  const handleUpdateSettings = (newSettings) => {
    setSettings(prev => {
      const updated = { ...prev, ...newSettings };
      
      // Dynamic re-translation on settings change
      if (rawClassified.length > 0 && (newSettings.useUnicode !== undefined || newSettings.deploymentMode !== undefined || newSettings.sqlServerVersion !== undefined)) {
        const tableColumnsMap = {};
        rawClassified.forEach(obj => {
          if (obj.type === 'TABLE' && obj.parsed && obj.parsed.columns) {
            const key = `${obj.schema}.${obj.name}`.toLowerCase();
            tableColumnsMap[key] = obj.parsed.columns.map(c => c.name);
          }
        });
        if (metadata) {
          if (Array.isArray(metadata)) {
            metadata.forEach(item => {
              const tbl = item.table || item.tableName || item.table_name;
              const col = item.column || item.columnName || item.column_name;
              if (tbl && col) {
                const key = tbl.toLowerCase();
                if (!tableColumnsMap[key]) tableColumnsMap[key] = [];
                if (!tableColumnsMap[key].includes(col)) {
                  tableColumnsMap[key].push(col);
                }
              }
            });
          }
        }

        const enumsMap = {};
        const domainsMap = {};
        const compositesMap = {};
        rawClassified.forEach(obj => {
          if (obj.type === 'ENUM') enumsMap[obj.name.toLowerCase()] = obj.parsed.values;
          if (obj.type === 'DOMAIN') {
            domainsMap[obj.name.toLowerCase()] = obj.parsed;
            domainsMap[`${obj.schema.toLowerCase()}.${obj.name.toLowerCase()}`] = obj.parsed;
          }
          if (obj.type === 'COMPOSITE') {
            compositesMap[obj.name.toLowerCase()] = obj.parsed.fields;
            compositesMap[`${obj.schema.toLowerCase()}.${obj.name.toLowerCase()}`] = obj.parsed.fields;
          }
        });

        const activeSchemaMap = buildSchemaMap(rawClassified, updated.preserveSchema);
        const metadataRepository = {
          tables: tableColumnsMap,
          views: new Set(),
          functions: new Set(),
          procedures: new Set(),
          triggers: new Set(),
          sequences: new Set(),
          schemas: new Set(Object.keys(activeSchemaMap))
        };
        rawClassified.forEach(cObj => {
          const k = `${cObj.schema.toLowerCase()}.${cObj.name.toLowerCase()}`;
          if (cObj.type === 'VIEW') metadataRepository.views.add(k);
          if (cObj.type === 'FUNCTION') metadataRepository.functions.add(k);
          if (cObj.type === 'PROCEDURE') metadataRepository.procedures.add(k);
          if (cObj.type === 'TRIGGER') metadataRepository.triggers.add(k);
          if (cObj.type === 'SEQUENCE') metadataRepository.sequences.add(k);
        });

        const filteredClassified = (updated.deploymentMode === 'view_only')
          ? rawClassified.filter(obj => obj.type === 'VIEW')
          : rawClassified;

        const newObjects = filteredClassified.map(classified => {
          const existing = objects.find(o => o.classified.id === classified.id);
          if (existing && existing.translation && !existing.translation.requiresAi && existing.translation.tsql && !existing.translation.tsql.includes('PENDING AI TRANSLATION')) {
            return existing;
          }
          const translation = translateObject(
            classified, 
            updated.useUnicode, 
            metadata, 
            enumsMap, 
            domainsMap, 
            compositesMap,
            activeSchemaMap,
            tableColumnsMap,
            updated.deploymentMode || 'migration',
            updated.sqlServerVersion || '2017+',
            sourceDialect,
            metadataRepository
          );
          return {
            classified,
            translation
          };
        });
        setObjects(newObjects);
      }
      
      return updated;
    });
  };

  const handleFilesUploaded = (sqlContentOrFiles, fileName, uploadedMetadata, uploadedDialect = 'postgres') => {
    setMetadata(uploadedMetadata);
    setSourceDialect(uploadedDialect);
    
    let filesToProcess = [];
    if (Array.isArray(sqlContentOrFiles)) {
      filesToProcess = sqlContentOrFiles;
      setOriginalFileName(fileName || 'schema.zip');
    } else {
      filesToProcess = [{ name: fileName || 'schema.sql', content: sqlContentOrFiles }];
      setOriginalFileName(fileName || 'schema.sql');
    }

    let finalClassStatements = [];

    filesToProcess.forEach(file => {
      // 1. Split SQL statements safely
      const rawStatements = splitSqlStatements(file.content, uploadedDialect);
      
      // 2. First pass: classify statements
      const classifiedStatements = rawStatements.map(stmt => {
        const obj = classifyStatement(stmt, uploadedDialect);
        obj.sourceFile = file.name; // Keep track of original source file!
        return obj;
      });
      
      // 2a. If dialect is Oracle, splice package body sub-members
      classifiedStatements.forEach(obj => {
        if (obj.type === 'ORACLE_PACKAGE_BODY') {
          finalClassStatements.push(obj);
          const members = splitOraclePackageBody(obj.raw, obj.name, obj.schema);
          members.forEach(m => {
            m.sourceFile = file.name;
          });
          finalClassStatements.push(...members);
        } else {
          finalClassStatements.push(obj);
        }
      });
    });

    // 2c. Extract inline foreign keys from tables and turn them into separate CONSTRAINT objects
    const fkStatements = [];
    const cleanIdentifier = (id) => id.replace(/[`"\[\]]/g, '').trim();

    finalClassStatements.forEach(obj => {
      if (obj.type === 'TABLE' && obj.parsed && obj.parsed.constraints) {
        const remainingConstraints = [];
        obj.parsed.constraints.forEach(cons => {
          const upperCons = cons.toUpperCase().trim();
          const isFk = upperCons.includes('FOREIGN KEY') || upperCons.startsWith('FOREIGN KEY');
          if (isFk) {
            // Find constraint name if any
            let constName = `fk_${obj.name}_${Math.random().toString(36).substring(2, 7)}`;
            const nameMatch = cons.match(/CONSTRAINT\s+([^\s;]+)\s+/i);
            if (nameMatch) {
              constName = cleanIdentifier(nameMatch[1]);
            }
            
            let fkBody = cons.trim();
            const fkMatch = fkBody.match(/CONSTRAINT\s+[^\s;]+\s+(FOREIGN\s+KEY.*)/i);
            if (fkMatch) {
              fkBody = fkMatch[1];
            }
            
            fkStatements.push({
              id: Math.random().toString(36).substring(2, 9),
              type: 'CONSTRAINT',
              name: constName,
              schema: obj.schema,
              raw: `ALTER TABLE \`${obj.schema}\`.\`${obj.name}\` ADD CONSTRAINT \`${constName}\` ${fkBody};`,
              clean: `ALTER TABLE ${obj.schema}.${obj.name} ADD CONSTRAINT ${constName} ${fkBody}`,
              parsed: {
                tableName: obj.name,
                definition: `CONSTRAINT \`${constName}\` ${fkBody}`
              },
              warnings: [],
              sourceFile: obj.sourceFile
            });
          } else {
            remainingConstraints.push(cons);
          }
        });
        obj.parsed.constraints = remainingConstraints;
      }
    });

    finalClassStatements.push(...fkStatements);

    // Uniqueness check for ALL constraint names database-wide
    const activeConstraintNames = new Set();
    const renameConstraint = (oldName, newName, obj) => {
      if (obj.type === 'CONSTRAINT') {
        obj.name = newName;
        obj.raw = obj.raw.replace(new RegExp(oldName, 'g'), newName);
        obj.clean = obj.clean.replace(new RegExp(oldName, 'g'), newName);
        if (obj.parsed && obj.parsed.definition) {
          obj.parsed.definition = obj.parsed.definition.replace(new RegExp(oldName, 'g'), newName);
        }
      } else if (obj.type === 'TABLE' && obj.parsed && obj.parsed.constraints) {
        obj.parsed.constraints = obj.parsed.constraints.map(cons => {
          const nameMatch = cons.match(/CONSTRAINT\s+([^\s;(]+)/i);
          if (nameMatch) {
            const currentName = cleanIdentifier(nameMatch[1]);
            if (currentName.toLowerCase() === oldName.toLowerCase()) {
              return cons.replace(new RegExp(currentName, 'g'), newName);
            }
          }
          return cons;
        });
      }
    };

    finalClassStatements.forEach(obj => {
      if (obj.type === 'CONSTRAINT') {
        const lowerName = obj.name.toLowerCase();
        if (activeConstraintNames.has(lowerName)) {
          let suffix = 2;
          let newName = `${obj.name}_${suffix}`;
          while (activeConstraintNames.has(newName.toLowerCase())) {
            suffix++;
            newName = `${obj.name}_${suffix}`;
          }
          renameConstraint(obj.name, newName, obj);
          activeConstraintNames.add(newName.toLowerCase());
        } else {
          activeConstraintNames.add(lowerName);
        }
      }
      if (obj.type === 'TABLE' && obj.parsed && obj.parsed.constraints) {
        obj.parsed.constraints.forEach((cons, idx) => {
          const nameMatch = cons.match(/CONSTRAINT\s+([^\s;(]+)/i);
          if (nameMatch) {
            const currentName = cleanIdentifier(nameMatch[1]);
            const lowerName = currentName.toLowerCase();
            if (activeConstraintNames.has(lowerName)) {
              let suffix = 2;
              let newName = `${currentName}_${suffix}`;
              while (activeConstraintNames.has(newName.toLowerCase())) {
                suffix++;
                newName = `${currentName}_${suffix}`;
              }
              obj.parsed.constraints[idx] = cons.replace(new RegExp(currentName, 'g'), newName);
              activeConstraintNames.add(newName.toLowerCase());
            } else {
              activeConstraintNames.add(lowerName);
            }
          }
        });
      }
    });

    // De-duplicate finalClassStatements to make sure we don't have identical raw statements

    const uniqueClassStatements = [];
    const seenRaw = new Set();
    finalClassStatements.forEach(stmt => {
      const key = `${stmt.type}:${stmt.schema}.${stmt.name}:${stmt.clean.substring(0, 100)}`;
      if (!seenRaw.has(key)) {
        seenRaw.add(key);
        uniqueClassStatements.push(stmt);
      }
    });
    finalClassStatements = uniqueClassStatements;


    const enumsMap = {};
    const domainsMap = {};
    const compositesMap = {};
    finalClassStatements.forEach(obj => {
      if (obj.type === 'ENUM') {
        enumsMap[obj.name.toLowerCase()] = obj.parsed.values;
      } else if (obj.type === 'DOMAIN') {
        domainsMap[obj.name.toLowerCase()] = obj.parsed;
        domainsMap[`${obj.schema.toLowerCase()}.${obj.name.toLowerCase()}`] = obj.parsed;
      } else if (obj.type === 'COMPOSITE') {
        compositesMap[obj.name.toLowerCase()] = obj.parsed.fields;
        compositesMap[`${obj.schema.toLowerCase()}.${obj.name.toLowerCase()}`] = obj.parsed.fields;
      }
    });

    // 2b. Merge Trigger functions with Trigger definitions (Postgres only)
    if (uploadedDialect === 'postgres') {
      const triggerFunctions = finalClassStatements.filter(obj => obj.type === 'FUNCTION' && obj.parsed.returnsTrigger === true);
      
      finalClassStatements.forEach(obj => {
        if (obj.type === 'TRIGGER' && obj.parsed.triggerFunctionName) {
          const matchingFunc = triggerFunctions.find(func => {
            const sameName = func.name.toLowerCase() === obj.parsed.triggerFunctionName.toLowerCase();
            const sameSchema = func.schema.toLowerCase() === obj.parsed.triggerFunctionSchema.toLowerCase();
            
            const isTriggerUnqualified = obj.parsed.triggerFunctionSchema.toLowerCase() === 'public';
            const triggerSchemaMatches = func.schema.toLowerCase() === obj.schema.toLowerCase();
            
            return sameName && (sameSchema || (isTriggerUnqualified && triggerSchemaMatches));
          });
          if (matchingFunc) {
            obj.parsed.functionBody = matchingFunc.raw;
            matchingFunc.parsed.isMergedIntoTrigger = true;
            matchingFunc.parsed.mergedTriggerName = obj.name;
          }
        }
      });
    }

    setRawClassified(finalClassStatements);

    // Gather all columns map from parsed tables
    const tableColumnsMap = {};
    finalClassStatements.forEach(obj => {
      if (obj.type === 'TABLE' && obj.parsed && obj.parsed.columns) {
        const key = `${obj.schema}.${obj.name}`.toLowerCase();
        tableColumnsMap[key] = obj.parsed.columns.map(c => c.name);
      }
    });

    if (uploadedMetadata) {
      if (Array.isArray(uploadedMetadata)) {
        uploadedMetadata.forEach(item => {
          const tbl = item.table || item.tableName || item.table_name;
          const col = item.column || item.columnName || item.column_name;
          if (tbl && col) {
            const key = tbl.toLowerCase();
            if (!tableColumnsMap[key]) tableColumnsMap[key] = [];
            if (!tableColumnsMap[key].includes(col)) {
              tableColumnsMap[key].push(col);
            }
          }
        });
      }
    }

    const activeSchemaMap = buildSchemaMap(finalClassStatements, settings.preserveSchema);
    const metadataRepository = {
      tables: tableColumnsMap,
      views: new Set(),
      functions: new Set(),
      procedures: new Set(),
      triggers: new Set(),
      sequences: new Set(),
      schemas: new Set(Object.keys(activeSchemaMap))
    };
    finalClassStatements.forEach(cObj => {
      const k = `${cObj.schema.toLowerCase()}.${cObj.name.toLowerCase()}`;
      if (cObj.type === 'VIEW') metadataRepository.views.add(k);
      if (cObj.type === 'FUNCTION') metadataRepository.functions.add(k);
      if (cObj.type === 'PROCEDURE') metadataRepository.procedures.add(k);
      if (cObj.type === 'TRIGGER') metadataRepository.triggers.add(k);
      if (cObj.type === 'SEQUENCE') metadataRepository.sequences.add(k);
    });

    const filteredClassStatements = (settings.deploymentMode === 'view_only')
      ? finalClassStatements.filter(obj => obj.type === 'VIEW')
      : finalClassStatements;

    // 3. Second pass: translate statements passing the context
    const processedObjects = filteredClassStatements.map(classified => {
      const translation = translateObject(
        classified, 
        settings.useUnicode, 
        uploadedMetadata, 
        enumsMap, 
        domainsMap, 
        compositesMap,
        activeSchemaMap,
        tableColumnsMap,
        settings.deploymentMode || 'migration',
        settings.sqlServerVersion || '2017+',
        uploadedDialect,
        metadataRepository
      );
      return {
        classified,
        translation
      };
    });

    setObjects(processedObjects);
    setStep('workspace');
  };

  const handleUpdateObjectSql = (id, newSql) => {
    setObjects(prev => prev.map(obj => {
      if (obj.classified.id === id) {
        return {
          ...obj,
          translation: {
            ...obj.translation,
            tsql: newSql
          }
        };
      }
      return obj;
    }));
  };

  const translateAndSelfCorrect = async (objToTranslate, currentObjects, maxRetries = 2) => {
    let retries = 0;
    let validationFeedback = null;
    let finalTsql = '';

    const triggerFunctionSql = objToTranslate.classified.type === 'TRIGGER' ? 
                               objToTranslate.classified.parsed.functionBody : null;

    let tableDdl = null;
    if (objToTranslate.classified.type === 'TRIGGER') {
      const tblName = objToTranslate.classified.parsed.tableName;
      if (tblName) {
        const tblObj = currentObjects.find(o => o.classified.type === 'TABLE' && o.classified.name.toLowerCase() === tblName.toLowerCase());
        if (tblObj) {
          tableDdl = tblObj.classified.raw;
        }
      }
    }

    const activeSchemaMap = buildSchemaMap(currentObjects.map(o => o.classified), settings.preserveSchema);

    while (retries <= maxRetries) {
      const translatedSql = await translatePLpgSQLWithAI({
        apiKey: settings.apiKey,
        objectType: objToTranslate.classified.type,
        objectName: objToTranslate.classified.name,
        originalSql: objToTranslate.classified.raw,
        triggerFunctionSql,
        tableDdl,
        model: settings.model,
        sourceDialect: sourceDialect,
        validationFeedback: validationFeedback,
        schemaMap: activeSchemaMap
      });

      finalTsql = applySqlConversionRules(
        translatedSql,
        settings.useUnicode !== false,
        activeSchemaMap,
        {},
        settings.targetProfile || '2017+',
        null
      ).trim();
      
      if (!finalTsql.toUpperCase().endsWith('GO')) {
        finalTsql += '\nGO';
      }

      // Check validation
      const testObjects = currentObjects.map(o => {
        if (o.classified.id === objToTranslate.classified.id) {
          return {
            schema: o.classified.schema,
            name: o.classified.name,
            type: o.classified.type,
            tsql: finalTsql,
            parsed: o.classified.parsed
          };
        }
        return {
          schema: o.classified.schema,
          name: o.classified.name,
          type: o.translation.tsql ? o.classified.type : null, // keep type to validate if translated
          tsql: o.translation.tsql,
          parsed: o.classified.parsed
        };
      });

      const validationReport = validateMigration(testObjects, sourceDialect);
      const objLabel = `[${objToTranslate.classified.schema}].[${objToTranslate.classified.name}] (${objToTranslate.classified.type})`;
      const objErrors = validationReport.errors.filter(e => e.objectName === objLabel);

      if (objErrors.length === 0 || retries === maxRetries) {
        return finalTsql;
      }

      validationFeedback = objErrors.map(e => `- ${e.description}`).join('\n');
      console.warn(`Validation failed for ${objToTranslate.classified.name}. Retrying... Errors:\n${validationFeedback}`);
      retries++;
    }

    return finalTsql;
  };

  const handleAiTranslateObject = async (id) => {
    const objToTranslate = objects.find(o => o.classified.id === id);
    if (!objToTranslate) return;

    if (!settings.apiKey) {
      alert('Google Gemini API Key is missing! Please click the Settings gear icon at the top right to configure your API Key.');
      setIsSettingsOpen(true);
      return;
    }

    setIsTranslatingMap(prev => ({ ...prev, [id]: true }));

    try {
      const finalTsql = await translateAndSelfCorrect(objToTranslate, objects);

      setObjects(prev => prev.map(obj => {
        if (obj.classified.id === id) {
          const warnings = [...(obj.translation.warnings || [])].filter(
            w => !w.includes('requires translation') && !w.includes('PL/pgSQL database object')
          );
          if (obj.classified.type === 'FUNCTION') {
            validateFunctionTsql(finalTsql, obj.classified.name, warnings);
          }
          return {
            ...obj,
            translation: {
              ...obj.translation,
              tsql: finalTsql,
              requiresAi: false,
              warnings
            }
          };
        }
        return obj;
      }));
    } catch (err) {
      alert(`AI Translation failed: ${err.message}`);
    } finally {
      setIsTranslatingMap(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleBulkTranslate = async () => {
    if (!settings.apiKey) {
      alert('Google Gemini API Key is missing! Please click the Settings gear icon in the top right to configure your API Key.');
      setIsSettingsOpen(true);
      return;
    }

    const pendingObjects = objects.filter(o => o.translation.requiresAi);
    if (pendingObjects.length === 0) return;

    setIsBulkTranslating(true);

    let currentObjects = [...objects];

    for (const obj of pendingObjects) {
      const id = obj.classified.id;
      setIsTranslatingMap(prev => ({ ...prev, [id]: true }));

      try {
        const finalTsql = await translateAndSelfCorrect(obj, currentObjects);

        currentObjects = currentObjects.map(item => {
          if (item.classified.id === id) {
            return {
              ...item,
              translation: {
                ...item.translation,
                tsql: finalTsql,
                requiresAi: false
              }
            };
          }
          return item;
        });

        setObjects(currentObjects);
        
        // Add a 4.5-second delay between requests to stay under the 15 RPM Free Tier limit
        if (obj !== pendingObjects[pendingObjects.length - 1]) {
          await new Promise(resolve => setTimeout(resolve, 4500));
        }
      } catch (err) {
        console.error(`AI Bulk Translation failed for object ${obj.classified.name}:`, err);
      } finally {
        setIsTranslatingMap(prev => ({ ...prev, [id]: false }));
      }
    }

    setIsBulkTranslating(false);
  };

  const handleReset = () => {
    if (window.confirm('Are you sure you want to start over? Your current translations and modifications will be cleared.')) {
      setObjects([]);
      setStep('upload');
      setMetadata(null);
      setIsTranslatingMap({});
      setValidationReport(null);
    }
  };

  const resolvedObjects = useMemo(() => {
    return resolveDependencies(objects);
  }, [objects]);

  const pendingCount = useMemo(() => {
    return resolvedObjects.filter(o => o.translation.requiresAi).length;
  }, [resolvedObjects]);

  if (authLoading) {
    return (
      <div className="auth-overlay">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
          <span className="loading-spinner" style={{ width: '40px', height: '40px', borderWidth: '4px' }}></span>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Initializing secure session...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-root">
      <Header 
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenSettings={() => setIsSettingsOpen(true)} 
        activeStep={step}
        onReset={handleReset}
        parsedCount={resolvedObjects.length}
        onBulkTranslate={handleBulkTranslate}
        isBulkTranslating={isBulkTranslating}
        pendingCount={pendingCount}
        user={user}
        onSignOut={handleSignOut}
      />

      {/* Step Navigation Indicator */}
      <div className="step-indicator-container">
        <div className="container step-indicator-flex">
          <div className={`step-item ${step === 'upload' ? 'active' : ''} ${step !== 'upload' ? 'completed' : ''}`}>
            <span className="step-num">{step !== 'upload' ? '✓' : '1'}</span>
            <span className="step-text">Upload Schema</span>
          </div>
          <div className="step-line"></div>
          <div className={`step-item ${step === 'workspace' ? 'active' : ''} ${step === 'summary' ? 'completed' : ''}`}>
            <span className="step-num">{step === 'summary' ? '✓' : '2'}</span>
            <span className="step-text">Workspace Translation</span>
          </div>
          <div className="step-line"></div>
          <div className={`step-item ${step === 'summary' ? 'active' : ''}`}>
            <span className="step-num">3</span>
            <span className="step-text">Review & Export</span>
          </div>
        </div>
      </div>

      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        user={user}
      />

      <div className="app-main-content">
        {step === 'upload' && (
          <UploadZone onFilesUploaded={handleFilesUploaded} />
        )}
        {step === 'workspace' && (
          <Workspace
            objects={resolvedObjects}
            onUpdateObjectSql={handleUpdateObjectSql}
            onAiTranslateObject={handleAiTranslateObject}
            isTranslatingMap={isTranslatingMap}
            hasApiKey={!!settings.apiKey}
            onGoToSummary={() => setStep('summary')}
            onBackToUpload={handleReset}
            sourceDialect={sourceDialect}
          />
        )}
        {step === 'summary' && (
          <SummaryReport 
            objects={resolvedObjects} 
            validationReport={validationReport}
            onReset={handleReset}
            onBackToWorkspace={() => setStep('workspace')}
            sourceDialect={sourceDialect}
            originalFileName={originalFileName}
            preserveSchema={settings.preserveSchema}
            settings={settings}
            onOpenSettings={() => setIsSettingsOpen(true)}
          />
        )}
      </div>

      {!user && !authBypassed && !isResettingPassword && (
        <AuthModal 
          onAuthSuccess={(u) => setUser(u)}
          onBypass={() => setAuthBypassed(true)}
        />
      )}

      {isResettingPassword && (
        <ResetPasswordModal 
          resetToken={resetToken}
          onClose={() => {
            setIsResettingPassword(false);
            setResetToken(null);
            // Clear custom URL parameter without reloading
            window.history.replaceState({}, document.title, window.location.pathname);
          }}
        />
      )}

      <style>{`
        .app-root {
          display: flex;
          flex-direction: column;
          min-height: 100vh;
        }
        .app-main-content {
          flex: 1;
          display: flex;
          flex-direction: column;
        }
      `}</style>
    </div>
  );
}
