import React, { useState, useEffect, useMemo } from 'react';
import Header from './components/Header';
import SettingsPanel from './components/SettingsPanel';
import UploadZone from './components/UploadZone';
import Workspace from './components/Workspace';
import SummaryReport from './components/SummaryReport';
import AuthModal from './components/AuthModal';
import ResetPasswordModal from './components/ResetPasswordModal';
import { supabase } from './utils/supabaseClient';
import { splitSqlStatements, classifyStatement } from './utils/parser';
import { translateObject, resolveDependencies } from './utils/translator';
import { translatePLpgSQLWithAI } from './utils/gemini';

export default function App() {
  const [step, setStep] = useState('upload'); // upload | workspace | summary
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [objects, setObjects] = useState([]);
  const [isTranslatingMap, setIsTranslatingMap] = useState({});
  const [metadata, setMetadata] = useState(null);
  const [isBulkTranslating, setIsBulkTranslating] = useState(false);
  const [user, setUser] = useState(null);
  const [authBypassed, setAuthBypassed] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [resetToken, setResetToken] = useState(null);
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

    return () => subscription.unsubscribe();
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
        return parsed;
      } catch (e) {
        console.error('Failed to parse settings', e);
      }
    }
    return {
      apiKey: '',
      useUnicode: true,
      model: 'gemini-3.1-flash-lite'
    };
  });

  // Persist settings
  useEffect(() => {
    localStorage.setItem('transpile_db_settings', JSON.stringify(settings));
  }, [settings]);

  const handleUpdateSettings = (newSettings) => {
    setSettings(prev => ({
      ...prev,
      ...newSettings
    }));
  };

  const handleFilesUploaded = (sqlContent, fileName, uploadedMetadata) => {
    setMetadata(uploadedMetadata);
    
    // 1. Split SQL statements safely
    const rawStatements = splitSqlStatements(sqlContent);
    
    // 2. First pass: classify statements and gather all custom enums
    const classifiedStatements = rawStatements.map(stmt => classifyStatement(stmt));
    
    const enumsMap = {};
    const domainsMap = {};
    const compositesMap = {};
    classifiedStatements.forEach(obj => {
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

    // 2b. Merge Trigger functions with Trigger definitions
    const triggerFunctions = classifiedStatements.filter(obj => obj.type === 'FUNCTION' && obj.parsed.returnsTrigger === true);
    
    classifiedStatements.forEach(obj => {
      if (obj.type === 'TRIGGER' && obj.parsed.triggerFunctionName) {
        const matchingFunc = triggerFunctions.find(func => {
          const sameName = func.name.toLowerCase() === obj.parsed.triggerFunctionName.toLowerCase();
          const sameSchema = func.schema.toLowerCase() === obj.parsed.triggerFunctionSchema.toLowerCase();
          
          // Fallback if the trigger's referenced function schema is unqualified ('public')
          // in which case it resides in either 'public' or the trigger's own schema
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

    // 3. Second pass: translate statements passing the enums context
    const processedObjects = classifiedStatements.map(classified => {
      const translation = translateObject(classified, settings.useUnicode, uploadedMetadata, enumsMap, domainsMap, compositesMap);
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
      const triggerFunctionSql = objToTranslate.classified.type === 'TRIGGER' ? 
                                 objToTranslate.classified.parsed.functionBody : null;

      const translatedSql = await translatePLpgSQLWithAI({
        apiKey: settings.apiKey,
        objectType: objToTranslate.classified.type,
        objectName: objToTranslate.classified.name,
        originalSql: objToTranslate.classified.raw,
        triggerFunctionSql,
        model: settings.model
      });

      setObjects(prev => prev.map(obj => {
        if (obj.classified.id === id) {
          let finalTsql = translatedSql.trim();
          if (!finalTsql.toUpperCase().endsWith('GO')) {
            finalTsql += '\nGO';
          }
          return {
            ...obj,
            translation: {
              ...obj.translation,
              tsql: finalTsql,
              requiresAi: false
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

    for (const obj of pendingObjects) {
      const id = obj.classified.id;
      setIsTranslatingMap(prev => ({ ...prev, [id]: true }));

      try {
        const triggerFunctionSql = obj.classified.type === 'TRIGGER' ? 
                                   obj.classified.parsed.functionBody : null;

        const translatedSql = await translatePLpgSQLWithAI({
          apiKey: settings.apiKey,
          objectType: obj.classified.type,
          objectName: obj.classified.name,
          originalSql: obj.classified.raw,
          triggerFunctionSql,
          model: settings.model
        });

        let finalTsql = translatedSql.trim();
        if (!finalTsql.toUpperCase().endsWith('GO')) {
          finalTsql += '\nGO';
        }

        setObjects(prev => prev.map(item => {
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
        }));
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
          />
        )}
        {step === 'summary' && (
          <SummaryReport 
            objects={resolvedObjects} 
            onReset={handleReset}
            onBackToWorkspace={() => setStep('workspace')}
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
