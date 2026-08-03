import React, { useState, useRef } from 'react';
import JSZip from 'jszip';

export default function UploadZone({ onFilesUploaded }) {
  const [dragActive, setDragActive] = useState(false);
  const [sqlFile, setSqlFile] = useState(null);
  const [metaFile, setMetaFile] = useState(null);
  const [sourceDialect, setSourceDialect] = useState('postgres'); // postgres | oracle
  
  const sqlInputRef = useRef(null);
  const metaInputRef = useRef(null);
  const dropzoneRef = useRef(null);

  const scrollToDropzone = () => {
    dropzoneRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const processZipFile = async (file) => {
    try {
      const arrayBuffer = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (err) => reject(err);
        reader.readAsArrayBuffer(file);
      });
      const zip = await JSZip.loadAsync(arrayBuffer);
      
      const sqlZipFile = Object.values(zip.files).find(f => f.name.endsWith('.sql'));
      const metaZipFile = Object.values(zip.files).find(f => f.name.endsWith('.json') || f.name.endsWith('.csv'));
      
      let extractedSql = null;
      let extractedMeta = null;
      
      if (sqlZipFile) {
        const blob = await sqlZipFile.async('blob');
        extractedSql = new File([blob], sqlZipFile.name, { type: 'text/plain' });
      }
      
      if (metaZipFile) {
        const blob = await metaZipFile.async('blob');
        extractedMeta = new File([blob], metaZipFile.name, { type: 'text/plain' });
      }
      
      return { sql: extractedSql, meta: extractedMeta };
    } catch (err) {
      console.error('Error processing zip file:', err);
      return { sql: null, meta: null };
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const files = Array.from(e.dataTransfer.files);
      const zipFile = files.find(f => f.name.endsWith('.zip'));

      if (zipFile) {
        const { sql, meta } = await processZipFile(zipFile);
        if (sql) setSqlFile(sql);
        if (meta) {
          setMetaFile(meta);
        } else {
          setMetaFile(zipFile);
        }
      } else {
        const sql = files.find(f => f.name.endsWith('.sql'));
        const meta = files.find(f => f.name.endsWith('.json') || f.name.endsWith('.csv'));
        
        if (sql) setSqlFile(sql);
        if (meta) setMetaFile(meta);
      }
    }
  };

  const handleSqlChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setSqlFile(e.target.files[0]);
    }
  };

  const handleMetaChange = async (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.name.endsWith('.zip')) {
        const { sql, meta } = await processZipFile(file);
        if (sql) setSqlFile(sql);
        setMetaFile(file);
      } else {
        setMetaFile(file);
      }
    }
  };

  const removeSqlFile = (e) => {
    e.stopPropagation();
    setSqlFile(null);
    if (sqlInputRef.current) sqlInputRef.current.value = '';
  };

  const removeMetaFile = (e) => {
    e.stopPropagation();
    setMetaFile(null);
    if (metaInputRef.current) metaInputRef.current.value = '';
  };

  const handleProcess = () => {
    if (!sqlFile) return;

    const sqlReader = new FileReader();
    sqlReader.onload = (e) => {
      const sqlContent = e.target.result;
      
      if (metaFile) {
        const metaReader = new FileReader();
        if (metaFile.name.endsWith('.zip')) {
          metaReader.onload = async (e2) => {
            try {
              const arrayBuffer = e2.target.result;
              const zip = await JSZip.loadAsync(arrayBuffer);
              const zipFile = Object.values(zip.files).find(f => f.name.endsWith('.json') || f.name.endsWith('.csv'));
              if (zipFile) {
                const fileContent = await zipFile.async('string');
                let parsedMeta = null;
                if (zipFile.name.endsWith('.json')) {
                  parsedMeta = JSON.parse(fileContent);
                } else {
                  parsedMeta = parseCsv(fileContent);
                }
                onFilesUploaded(sqlContent, sqlFile.name, parsedMeta, sourceDialect);
              } else {
                alert('No .json or .csv metadata file found inside the uploaded ZIP folder!');
                onFilesUploaded(sqlContent, sqlFile.name, null, sourceDialect);
              }
            } catch (err) {
              console.error('Failed to parse metadata from ZIP file:', err);
              alert('Error reading metadata ZIP: ' + err.message);
              onFilesUploaded(sqlContent, sqlFile.name, null, sourceDialect);
            }
          };
          metaReader.readAsArrayBuffer(metaFile);
        } else {
          metaReader.onload = (e2) => {
            const metaContent = e2.target.result;
            let parsedMeta = null;
            try {
              if (metaFile.name.endsWith('.json')) {
                parsedMeta = JSON.parse(metaContent);
              } else {
                // CSV basic parser
                parsedMeta = parseCsv(metaContent);
              }
            } catch (err) {
              console.error('Failed to parse metadata file:', err);
            }
            onFilesUploaded(sqlContent, sqlFile.name, parsedMeta, sourceDialect);
          };
          metaReader.readAsText(metaFile);
        }
      } else {
        onFilesUploaded(sqlContent, sqlFile.name, null, sourceDialect);
      }
    };
    sqlReader.readAsText(sqlFile);
  };

  // Simple CSV parser helper: returns array of row objects
  const parseCsv = (text) => {
    const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) return [];
    
    const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
    return lines.slice(1).map(line => {
      const values = line.split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = values[index] || '';
      });
      return obj;
    });
  };

  return (
    <div className="upload-container container">
      {/* 🚀 Hero Banner Section */}
      <div className="hero-banner glass-panel">
        <div className="hero-info">
          <span className="hero-badge-pill">
            <span className="hero-badge-dot"></span>
            AI MIGRATION ENGINE ACTIVE
          </span>
          <h2 className="hero-title">
            PostgreSQL & Oracle <span className="title-arrow">➜</span> SQL Server
          </h2>
          <p className="hero-desc">
            Enterprise-grade automated migration. Upload your PostgreSQL or Oracle schema scripts, run the analysis
            engine, and export a deployment-ready SQL Server T-SQL project with structure validation and dependency checks.
          </p>
        </div>

        <div className="hero-stats">
          <div className="stat-card">
            <div className="stat-icon-wrapper purple">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2.5" fill="none">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <div className="stat-meta">
              <span className="stat-val">100%</span>
              <span className="stat-label">Conversion accuracy</span>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon-wrapper orange">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2.5" fill="none">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </div>
            <div className="stat-meta">
              <span className="stat-val">10x</span>
              <span className="stat-label">Faster than manual</span>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon-wrapper blue">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2.5" fill="none">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </div>
            <div className="stat-meta">
              <span className="stat-val">3</span>
              <span className="stat-label">Core stages</span>
            </div>
          </div>
        </div>
      </div>

      {/* 🧭 Stage Navigation & Stepper */}
      <div className="stage-navigation glass-panel">
        <div className="stage-nav-header">
          <div className="stage-title-group">
            <div className="stage-icon-circle">
              <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2.5" fill="none">
                <polygon points="12 2 2 7 12 12 22 7 12 2" />
                <polyline points="2 17 12 22 22 17" />
                <polyline points="2 12 12 17 22 12" />
              </svg>
            </div>
            <div className="stage-label-stack">
              <span className="stage-subtitle">PIPELINE NAVIGATION • STAGE 1 OF 3</span>
              <span className="stage-main-title">Instructions & Upload</span>
            </div>
          </div>

          <div className="phase-pills">
            <span className="phase-pill active">Phase 1: Capture & Upload</span>
            <span className="phase-pill">Phase 2: Analyze & Convert</span>
            <span className="phase-pill">Phase 3: Validate & Deploy</span>
          </div>
        </div>

        <div className="step-stepper">
          <div className="step-pill completed">
            <span className="step-circle">✓</span>
            <span className="step-text">Instructions</span>
          </div>
          <div className="step-pill active" onClick={scrollToDropzone} style={{ cursor: 'pointer' }}>
            <span className="step-circle">2</span>
            <span className="step-text">Upload files</span>
          </div>
          <div className="step-pill">
            <span className="step-circle">3</span>
            <span className="step-text">Workspace Analysis</span>
          </div>
        </div>
      </div>

      {/* 🧭 Dialect Selector Cards */}
      <div className="dialect-selector-section glass-panel">
        <span className="dialect-section-tag">CHOOSE SOURCE DIALECT</span>
        <h3 className="dialect-section-title">Select your source database dialect</h3>
        <div className="dialect-cards-grid">
          <div 
            className={`dialect-card ${sourceDialect === 'postgres' ? 'active' : ''}`}
            onClick={() => setSourceDialect('postgres')}
          >
            <div className="dialect-card-icon postgres-icon">🐘</div>
            <div className="dialect-card-meta">
              <h4>PostgreSQL</h4>
              <p>Transpile PostgreSQL PL/pgSQL schemas, custom domains, functions, and enums.</p>
            </div>
            {sourceDialect === 'postgres' && <span className="dialect-check-badge">✓</span>}
          </div>

          <div 
            className={`dialect-card ${sourceDialect === 'oracle' ? 'active' : ''}`}
            onClick={() => setSourceDialect('oracle')}
          >
            <div className="dialect-card-icon oracle-icon">🔴</div>
            <div className="dialect-card-meta">
              <h4>Oracle Database</h4>
              <p>Transpile Oracle PL/SQL packages, functions, sequences, and synonyms.</p>
            </div>
            {sourceDialect === 'oracle' && <span className="dialect-check-badge">✓</span>}
          </div>
        </div>
      </div>

      {/* 📋 Preparation Instructions Header Section */}
      <div className="prep-banner-card glass-panel">
        <div className="prep-banner-info">
          <span className="prep-banner-tag">BEFORE YOU UPLOAD</span>
          <h2 className="prep-banner-title">Prepare a complete {sourceDialect === 'postgres' ? 'PostgreSQL' : 'Oracle'} migration package</h2>
          <p className="prep-banner-desc">
            A {sourceDialect === 'postgres' ? 'PostgreSQL' : 'Oracle'} schema DDL script (.sql) is the core input file. While the converter works end-to-end with a single script, uploading a JSON/CSV file containing table metadata enables advanced column expansion. Clean all credentials and passwords before uploading.
          </p>
        </div>
        <button className="btn btn-primary prep-continue-btn" onClick={scrollToDropzone}>
          Continue to Upload ➜
        </button>
      </div>

      {/* 🛡️ Two Column: Extraction Modes & Security Preparation */}
      <div className="prep-grid-columns">
        {/* Left Column: Extraction Modes */}
        <div className="prep-column-left glass-panel">
          <h3 className="prep-column-title">
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2.5" fill="none" style={{ marginRight: '0.4rem', verticalAlign: 'middle' }}>
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
            Supported extraction modes
          </h3>

          <div className="mode-item">
            <div className="mode-header">
              <span className="mode-name">Mode A — DDL Script only</span>
              <span className="mode-badge recommended">Recommended</span>
            </div>
            <p className="mode-desc">Upload the primary DDL script file containing table, view, constraint, and index definitions generated with {sourceDialect === 'postgres' ? 'pg_dump' : 'expdp or DBMS_METADATA'}.</p>
          </div>

          <div className="mode-item">
            <div className="mode-header">
              <span className="mode-name">Mode B — DDL + Custom Mappings</span>
              <span className="mode-badge supported">Supported</span>
            </div>
            <p className="mode-desc">{sourceDialect === 'postgres' ? 'Upload custom enum types, user domains, and composite types to map data constraints accurately.' : 'Upload sequence offsets and package scopes to map procedural constraints accurately.'}</p>
          </div>

          <div className="mode-item">
            <div className="mode-header">
              <span className="mode-name">Mode C — Metadata Mappings</span>
              <span className="mode-badge supported">Supported</span>
            </div>
            <p className="mode-desc">Provide a list of tables and columns to automatically expand SELECT * wildcards to explicit columns.</p>
          </div>
        </div>

        {/* Right Column: Security Prep */}
        <div className="prep-column-right glass-panel">
          <h3 className="prep-column-title">
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2.5" fill="none" style={{ marginRight: '0.4rem', verticalAlign: 'middle' }}>
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            Security preparation
          </h3>
          
          <div className="security-guidelines">
            <p>Remove credentials, database connection strings, tokens, and personal user data before uploading. Replace secrets with placeholders such as <code>&lt;SQL_PASSWORD&gt;</code>.</p>
            <p>Include table structures, data types, indexes, and constraints, but do not include insert data statements with sensitive client information.</p>
            <p>Where trigger logic is used, include only the script definition needed for trigger compilation and mask custom user identifiers.</p>
          </div>

          <div className="security-alert-box">
            <span className="alert-icon">⚠️</span>
            <p className="alert-text">
              Trigger functions and complex {sourceDialect === 'postgres' ? 'PL/pgSQL' : 'PL/SQL'} code blocks are isolated for AI translation, but they are processed client-side. No sensitive schema data is persisted on any server.
            </p>
          </div>
        </div>
      </div>

      {/* 🎯 Scope-Dependent Requirements Banner */}
      <div className="scope-banner-card">
        <div className="scope-icon-wrapper">
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2.5" fill="none">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        </div>
        <div className="scope-banner-meta">
          <h4 className="scope-banner-title">Minimum input: one DDL script file</h4>
          <p className="scope-banner-desc">
            For structure migration, a single .sql schema dump file is sufficient. It is processed end-to-end for table structure, indexes, keys, functions, and views.
          </p>
        </div>
      </div>

      {/* 📂 Additional Files Grid */}
      <div className="additional-section-header">
        <span className="additional-section-sub">SCOPE-DEPENDENT REQUIREMENTS</span>
        <h3 className="additional-section-title">
          Additional inputs for advanced database migration analysis
          <span className="additional-badge">3 requirement groups</span>
        </h3>
      </div>

      <div className="additional-cards-grid">
        {/* Card 1 */}
        <div className="additional-card">
          <div className="add-card-icon red">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2.5" fill="none">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <h4>{sourceDialect === 'postgres' ? 'PostgreSQL DDL schema dump' : 'Oracle DDL schema dump'}</h4>
          <p className="add-card-code">
            <code>{sourceDialect === 'postgres' ? 'table_definitions.sql' : 'oracle_schema.sql'}</code> generated with <code>{sourceDialect === 'postgres' ? 'pg_dump --schema-only' : 'expdp CONTENT=METADATA_ONLY'}</code>.
          </p>
          <p className="add-card-desc">
            This is the machine-readable source for tables, constraints, defaults, primary/foreign keys, schema layouts, and database properties.
          </p>
        </div>

        {/* Card 2 */}
        <div className="additional-card">
          <div className="add-card-icon red">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2.5" fill="none">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
          </div>
          <h4>{sourceDialect === 'postgres' ? 'Procedural logic' : 'Packages & PL/SQL body'}</h4>
          <p className="add-card-code">
            <code>{sourceDialect === 'postgres' ? 'functions.sql' : 'packages.sql'}</code> containing procedural trigger/package definitions.
          </p>
          <p className="add-card-desc">
            {sourceDialect === 'postgres'
              ? 'Required to reconstruct trigger sequences, variables, conditional evaluations, loops, composite returns, and calculated fields.'
              : 'Required to reconstruct package structures, triggers using :NEW/:OLD variables, loop cursor controls, exception branching, and calculations.'}
          </p>
        </div>

        {/* Card 3 */}
        <div className="additional-card">
          <div className="add-card-icon red">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2.5" fill="none">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <h4>Column metadata map</h4>
          <p className="add-card-code">
            <code>table_metadata.csv</code> mapping table names and custom columns.
          </p>
          <p className="add-card-desc">
            Required to identify exact column indices, resolve datatype conversions, specify target sizes, and manage null constraints.
          </p>
        </div>
      </div>

      {/* Recommended Lists */}
      <div className="prep-lists-footer glass-panel">
        <div className="list-col">
          <h4 className="list-title">
            <span className="list-check-dot green"></span>
            Recommended files
          </h4>
          <ul className="list-items">
            <li>
              <strong>Original DDL Script:</strong> Keep the source DDL script unmodified in syntax.
            </li>
            <li>
              <strong>Constraint Mappings:</strong> Ensure foreign keys are present to parse execution dependencies correctly.
            </li>
          </ul>
        </div>

        <div className="list-col">
          <h4 className="list-title">
            <span className="list-check-dot blue"></span>
            Optional supporting files
          </h4>
          <ul className="list-items">
            <li>
              <strong>Metadata CSV/JSON:</strong> Crucial for table schema lookup and dynamic wildcards expansion.
            </li>
            <li>
              <strong>User Mappings:</strong> For mapping legacy {sourceDialect === 'postgres' ? 'Postgres' : 'Oracle'} user accounts to SQL Server logins.
            </li>
          </ul>
        </div>
      </div>

      {/* 📂 Drag & Drop Schema Area */}
      <div 
        ref={dropzoneRef}
        className={`dropzone glass-panel ${dragActive ? 'drag-active' : ''}`}
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
      >
        <div className="dropzone-content">
          <div className="dropzone-icon-circle">
            <svg className="upload-icon" viewBox="0 0 24 24" width="32" height="32" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <h3>Prepare your {sourceDialect === 'postgres' ? 'PostgreSQL' : 'Oracle'} migration package</h3>
          <p className="dropzone-sub">
            Drag & drop your {sourceDialect === 'postgres' ? 'PostgreSQL' : 'Oracle'} `.sql` schema dump script, and optional CSV/JSON column metadata definitions.
          </p>
        </div>

        <div className="upload-slots">
          {/* SQL Slot */}
          <div className={`file-slot ${sqlFile ? 'has-file' : ''}`} onClick={() => sqlInputRef.current?.click()}>
            <input 
              type="file" 
              ref={sqlInputRef} 
              style={{ display: 'none' }} 
              accept=".sql" 
              onChange={handleSqlChange} 
            />
            <div className="slot-icon">
              <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" strokeWidth="2.5" fill="none">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </div>
            <div className="slot-info">
              <h4>Schema Script (.sql)</h4>
              <p>{sqlFile ? sqlFile.name : `Choose primary ${sourceDialect === 'postgres' ? 'PostgreSQL' : 'Oracle'} file`}</p>
            </div>
            {sqlFile && (
              <button className="btn-remove" onClick={removeSqlFile} aria-label="Remove SQL file" title="Remove SQL file">
                ✕
              </button>
            )}
          </div>

          {/* Meta Slot */}
          <div className={`file-slot ${metaFile ? 'has-file' : ''}`} onClick={() => metaInputRef.current?.click()}>
            <input 
              type="file" 
              ref={metaInputRef} 
              style={{ display: 'none' }} 
              accept=".csv,.json,.zip" 
              onChange={handleMetaChange} 
            />
            <div className="slot-icon">
              <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" strokeWidth="2.5" fill="none">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </div>
            <div className="slot-info">
              <h4>Optional Metadata (.csv / .json / .zip)</h4>
              <p>{metaFile ? metaFile.name : 'Choose column metadata definitions'}</p>
            </div>
            {metaFile && (
              <button className="btn-remove" onClick={removeMetaFile} aria-label="Remove metadata file" title="Remove metadata file">
                ✕
              </button>
            )}
          </div>
        </div>

        <button 
          className="btn btn-primary btn-process" 
          disabled={!sqlFile}
          onClick={handleProcess}
        >
          Continue to Workspace
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: '0.3rem' }}>
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </button>
      </div>

      <style>{`
        .upload-container {
          padding-top: 2rem;
          padding-bottom: 4rem;
          max-width: 1100px !important;
          animation: fadeIn 0.4s ease-out;
          display: flex;
          flex-direction: column;
          gap: 2rem;
        }

        /* 🚀 Hero Banner */
        .hero-banner {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 2.5rem;
          background: var(--panel-bg);
          border-radius: var(--radius-lg);
          border: 1px solid var(--panel-border);
          box-shadow: var(--shadow-md);
        }
        @media (max-width: 900px) {
          .hero-banner {
            flex-direction: column;
            gap: 2rem;
            align-items: flex-start;
          }
        }
        .hero-info {
          flex: 1;
          max-width: 620px;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 0.85rem;
        }
        .hero-badge-pill {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          font-size: 0.7rem;
          font-weight: 700;
          color: var(--primary);
          background: rgba(79, 70, 229, 0.08);
          padding: 0.25rem 0.65rem;
          border-radius: 30px;
        }
        .hero-badge-dot {
          width: 6px;
          height: 6px;
          background: var(--primary);
          border-radius: 50%;
          display: inline-block;
        }
        .hero-title {
          font-size: 2.5rem;
          font-weight: 900;
          color: var(--text-primary);
          letter-spacing: -0.02em;
        }
        .title-arrow {
          color: var(--text-secondary);
          opacity: 0.8;
          font-weight: 300;
        }
        .hero-desc {
          font-size: 0.95rem;
          line-height: 1.6;
          color: var(--text-secondary);
        }
        .hero-stats {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          min-width: 260px;
        }
        .stat-card {
          display: flex;
          align-items: center;
          gap: 0.85rem;
          padding: 0.85rem 1.25rem;
          background: var(--panel-tab-bg);
          border: 1px solid var(--panel-border);
          border-radius: var(--radius-md);
        }
        .stat-icon-wrapper {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .stat-icon-wrapper.purple { background: rgba(79, 70, 229, 0.1); color: var(--primary); }
        .stat-icon-wrapper.orange { background: rgba(245, 158, 11, 0.1); color: var(--warning); }
        .stat-icon-wrapper.blue { background: rgba(14, 165, 233, 0.1); color: var(--secondary); }
        .stat-meta {
          display: flex;
          flex-direction: column;
        }
        .stat-val {
          font-size: 1.1rem;
          font-weight: 800;
          color: var(--text-primary);
          line-height: 1.1;
        }
        .stat-label {
          font-size: 0.72rem;
          font-weight: 600;
          color: var(--text-secondary);
        }

        /* 🧭 Stage Navigation & Stepper */
        .stage-navigation {
          padding: 1.5rem 2rem;
          background: var(--panel-bg);
          border-radius: var(--radius-md);
          border: 1px solid var(--panel-border);
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .stage-nav-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        @media (max-width: 900px) {
          .stage-nav-header {
            flex-direction: column;
            align-items: flex-start;
            gap: 1rem;
          }
        }
        .stage-title-group {
          display: flex;
          align-items: center;
          gap: 0.85rem;
        }
        .stage-icon-circle {
          width: 36px;
          height: 36px;
          background: rgba(79, 70, 229, 0.08);
          color: var(--primary);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .stage-label-stack {
          display: flex;
          flex-direction: column;
        }
        .stage-subtitle {
          font-size: 0.65rem;
          font-weight: 700;
          color: var(--text-muted);
          letter-spacing: 0.05em;
        }
        .stage-main-title {
          font-size: 1.1rem;
          font-weight: 800;
          color: var(--text-primary);
        }
        .phase-pills {
          display: flex;
          gap: 0.5rem;
          background: var(--panel-tab-bg);
          padding: 0.25rem;
          border-radius: 30px;
          border: 1px solid var(--panel-border);
        }
        .phase-pill {
          padding: 0.35rem 0.85rem;
          font-size: 0.75rem;
          font-weight: 700;
          color: var(--text-secondary);
          border-radius: 30px;
        }
        .phase-pill.active {
          background: var(--primary);
          color: #fff;
        }
        .step-stepper {
          display: flex;
          gap: 1rem;
          border-top: 1px solid var(--panel-border);
          padding-top: 1.25rem;
        }
        @media (max-width: 640px) {
          .step-stepper {
            flex-direction: column;
            gap: 0.75rem;
          }
        }
        .step-pill {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 0.65rem;
          padding: 0.65rem 1.25rem;
          background: var(--panel-tab-bg);
          border: 1px solid var(--panel-border);
          border-radius: 30px;
          color: var(--text-muted);
          font-size: 0.85rem;
          font-weight: 600;
        }
        .step-pill.active {
          background: rgba(79, 70, 229, 0.04);
          border-color: var(--primary);
          color: var(--primary);
        }
        .step-pill.completed {
          background: var(--success-bg);
          border-color: var(--success-border);
          color: var(--success);
        }
        .step-circle {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #fff;
          border: 1px solid currentColor;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.72rem;
          font-weight: 800;
        }
        .step-pill.active .step-circle {
          background: var(--primary);
          color: #fff;
          border-color: var(--primary);
        }
        .step-pill.completed .step-circle {
          background: var(--success);
          color: #fff;
          border-color: var(--success);
        }

        /* 📂 Drag & Drop Schema Area */
        .dropzone {
          padding: 3rem 2rem;
          text-align: center;
          border: 2px dashed var(--panel-border);
          transition: all 0.3s;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2rem;
          background: var(--panel-bg);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-md);
        }
        .dropzone.drag-active {
          border-color: var(--primary);
          background: rgba(79, 70, 229, 0.02);
          transform: scale(1.005);
        }
        .dropzone-content {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.85rem;
          max-width: 500px;
        }
        .dropzone-icon-circle {
          width: 60px;
          height: 60px;
          background: rgba(79, 70, 229, 0.06);
          color: var(--primary);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 0.5rem;
        }
        .dropzone-content h3 {
          font-size: 1.35rem;
          font-weight: 800;
          color: var(--text-primary);
        }
        .dropzone-sub {
          font-size: 0.85rem;
          color: var(--text-secondary);
          line-height: 1.5;
        }
        .upload-slots {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1.5rem;
          width: 100%;
          max-width: 720px;
        }
        @media (max-width: 640px) {
          .upload-slots {
            grid-template-columns: 1fr;
          }
        }
        .file-slot {
          padding: 1.25rem;
          display: flex;
          align-items: center;
          gap: 1rem;
          cursor: pointer;
          text-align: left;
          background: var(--panel-tab-bg);
          border: 1px solid var(--panel-border);
          border-radius: var(--radius-md);
          position: relative;
          user-select: none;
          transition: all var(--transition-fast);
        }
        .file-slot:hover {
          border-color: var(--panel-border-hover);
          transform: translateY(-1px);
        }
        .file-slot.has-file {
          border-color: rgba(79, 70, 229, 0.25);
          background: rgba(79, 70, 229, 0.03);
        }
        .slot-icon {
          color: var(--text-muted);
          flex-shrink: 0;
        }
        .file-slot.has-file .slot-icon {
          color: var(--primary);
        }
        .slot-info h4 {
          font-size: 0.88rem;
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 0.15rem;
        }
        .slot-info p {
          font-size: 0.75rem;
          color: var(--text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 200px;
        }
        .btn-remove {
          position: absolute;
          right: 12px;
          background: var(--panel-bg);
          color: var(--text-secondary);
          border: 1px solid var(--panel-border);
          border-radius: 50%;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          font-size: 0.65rem;
          font-weight: bold;
          transition: all 0.2s;
        }
        .btn-remove:hover {
          background: var(--error-bg);
          color: var(--error);
          border-color: var(--error-border);
        }
        .btn-process {
          width: 100%;
          max-width: 280px;
          border-radius: 30px;
          padding: 0.85rem 1.75rem;
          font-size: 0.95rem;
          box-shadow: var(--shadow-sm);
        }

        /* 📋 Preparation Banner Card */
        .prep-banner-card {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 2.5rem;
          background: var(--panel-bg);
          border-radius: var(--radius-lg);
          border: 1px solid var(--panel-border);
          box-shadow: var(--shadow-md);
          text-align: left;
        }
        @media (max-width: 900px) {
          .prep-banner-card {
            flex-direction: column;
            gap: 1.5rem;
            align-items: flex-start;
          }
        }
        .prep-banner-info {
          flex: 1;
          max-width: 720px;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 0.65rem;
        }
        .prep-banner-tag {
          font-size: 0.72rem;
          font-weight: 800;
          color: var(--primary);
          letter-spacing: 0.05em;
        }
        .prep-banner-title {
          font-size: 1.85rem;
          font-weight: 900;
          color: var(--text-primary);
          letter-spacing: -0.015em;
        }
        .prep-banner-desc {
          font-size: 0.92rem;
          line-height: 1.6;
          color: var(--text-secondary);
        }
        .prep-continue-btn {
          border-radius: 30px;
          padding: 0.75rem 1.5rem;
          font-size: 0.9rem;
          box-shadow: var(--shadow-sm);
          flex-shrink: 0;
        }

        /* 🛡️ Prep Columns Grid */
        .prep-grid-columns {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 2rem;
          width: 100%;
          text-align: left;
        }
        @media (max-width: 900px) {
          .prep-grid-columns {
            grid-template-columns: 1fr;
          }
        }
        .prep-column-left, .prep-column-right {
          padding: 2rem;
          background: var(--panel-bg);
          border-radius: var(--radius-lg);
          border: 1px solid var(--panel-border);
          box-shadow: var(--shadow-md);
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .prep-column-title {
          font-size: 1.25rem;
          font-weight: 800;
          color: var(--text-primary);
          display: flex;
          align-items: center;
        }
        
        .mode-item {
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
          border-bottom: 1px solid var(--panel-border);
          padding-bottom: 1rem;
        }
        .mode-item:last-child {
          border-bottom: none;
          padding-bottom: 0;
        }
        .mode-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .mode-name {
          font-size: 0.9rem;
          font-weight: 700;
          color: var(--text-primary);
        }
        .mode-badge {
          font-size: 0.65rem;
          font-weight: 700;
          padding: 0.15rem 0.5rem;
          border-radius: 30px;
          text-transform: uppercase;
        }
        .mode-badge.recommended {
          background: rgba(79, 70, 229, 0.08);
          color: var(--primary);
        }
        .mode-badge.supported {
          background: #f1f5f9;
          color: var(--text-secondary);
        }
        .mode-desc {
          font-size: 0.8rem;
          line-height: 1.5;
          color: var(--text-secondary);
        }

        .security-guidelines {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          font-size: 0.88rem;
          line-height: 1.6;
          color: var(--text-secondary);
        }
        .security-guidelines code {
          background: var(--panel-tab-bg);
          padding: 0.1rem 0.3rem;
          border-radius: 4px;
          font-size: 0.8rem;
        }
        .security-alert-box {
          display: flex;
          gap: 0.75rem;
          padding: 1rem;
          background: var(--warning-bg);
          border: 1px solid var(--warning-border);
          border-radius: var(--radius-md);
        }
        .alert-icon {
          font-size: 1.1rem;
        }
        .alert-text {
          font-size: 0.8rem;
          line-height: 1.5;
          color: #b45309;
          font-weight: 500;
        }

        /* 🎯 Scope Banner Card */
        .scope-banner-card {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1.25rem 2rem;
          background: #e0f2fe;
          border: 1px solid #bae6fd;
          border-radius: var(--radius-md);
          text-align: left;
        }
        .scope-icon-wrapper {
          width: 36px;
          height: 36px;
          background: #bae6fd;
          color: #0369a1;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .scope-banner-meta {
          display: flex;
          flex-direction: column;
        }
        .scope-banner-title {
          font-size: 0.95rem;
          font-weight: 800;
          color: #0369a1;
        }
        .scope-banner-desc {
          font-size: 0.8rem;
          color: #0e7490;
        }

        /* 📂 Additional Files Grid */
        .additional-section-header {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          border-top: 1px solid var(--panel-border);
          padding-top: 2rem;
          text-align: left;
        }
        .additional-section-sub {
          font-size: 0.65rem;
          font-weight: 700;
          color: var(--error);
          letter-spacing: 0.05em;
        }
        .additional-section-title {
          font-size: 1.35rem;
          font-weight: 800;
          color: var(--text-primary);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        @media (max-width: 640px) {
          .additional-section-title {
            flex-direction: column;
            align-items: flex-start;
            gap: 0.5rem;
          }
        }
        .additional-badge {
          font-size: 0.68rem;
          font-weight: 700;
          background: rgba(239, 68, 68, 0.08);
          color: var(--error);
          padding: 0.25rem 0.65rem;
          border-radius: 30px;
          text-transform: uppercase;
        }

        .additional-cards-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1.5rem;
          width: 100%;
          text-align: left;
        }
        @media (max-width: 900px) {
          .additional-cards-grid {
            grid-template-columns: 1fr;
          }
        }
        .additional-card {
          padding: 2rem;
          background: var(--panel-bg);
          border-radius: var(--radius-lg);
          border: 1px solid var(--panel-border);
          box-shadow: var(--shadow-sm);
          display: flex;
          flex-direction: column;
          gap: 0.85rem;
          border-top: 3px solid var(--error);
        }
        .add-card-icon {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .add-card-icon.red {
          background: rgba(239, 68, 68, 0.08);
          color: var(--error);
        }
        .additional-card h4 {
          font-size: 1.05rem;
          font-weight: 800;
          color: var(--text-primary);
        }
        .add-card-code {
          font-family: var(--font-mono);
          font-size: 0.78rem;
          color: var(--text-secondary);
        }
        .add-card-code code {
          background: var(--panel-tab-bg);
          padding: 0.1rem 0.3rem;
          border-radius: 4px;
        }
        .add-card-desc {
          font-size: 0.82rem;
          line-height: 1.5;
          color: var(--text-secondary);
        }

        /* Recommended Lists Footer */
        .prep-lists-footer {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 2.5rem;
          padding: 2rem;
          background: var(--panel-bg);
          border-radius: var(--radius-lg);
          border: 1px solid var(--panel-border);
          box-shadow: var(--shadow-sm);
          text-align: left;
        }
        @media (max-width: 768px) {
          .prep-lists-footer {
            grid-template-columns: 1fr;
            gap: 1.5rem;
          }
        }
        .list-col {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .list-title {
          font-size: 0.95rem;
          font-weight: 800;
          color: var(--text-primary);
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .list-check-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }
        .list-check-dot.green { background: var(--success); }
        .list-check-dot.blue { background: var(--secondary); }
        .list-items {
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          padding-left: 0.5rem;
        }
        .list-items li {
          font-size: 0.82rem;
          color: var(--text-secondary);
          line-height: 1.5;
          position: relative;
          padding-left: 1rem;
        }
        .list-items li::before {
          content: '•';
          position: absolute;
          left: 0;
          color: var(--text-muted);
        }

        /* 🧭 Dialect Selector Card Styles */
        .dialect-selector-section {
          padding: 2rem;
          background: var(--panel-bg);
          border-radius: var(--radius-lg);
          border: 1px solid var(--panel-border);
          box-shadow: var(--shadow-md);
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          text-align: left;
        }
        .dialect-section-tag {
          font-size: 0.72rem;
          font-weight: 800;
          color: var(--primary);
          letter-spacing: 0.05em;
        }
        .dialect-section-title {
          font-size: 1.35rem;
          font-weight: 800;
          color: var(--text-primary);
        }
        .dialect-cards-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1.5rem;
          width: 100%;
        }
        @media (max-width: 640px) {
          .dialect-cards-grid {
            grid-template-columns: 1fr;
          }
        }
        .dialect-card {
          padding: 1.5rem;
          background: var(--panel-tab-bg);
          border: 2px solid var(--panel-border);
          border-radius: var(--radius-md);
          display: flex;
          align-items: center;
          gap: 1.25rem;
          cursor: pointer;
          position: relative;
          transition: all var(--transition-fast);
        }
        .dialect-card:hover {
          border-color: var(--panel-border-hover);
          transform: translateY(-1px);
        }
        .dialect-card.active {
          background: var(--panel-bg);
          border-color: var(--primary);
          box-shadow: 0 4px 14px var(--primary-glow);
        }
        .dialect-card-icon {
          font-size: 1.85rem;
          width: 48px;
          height: 48px;
          background: var(--panel-bg);
          border-radius: var(--radius-sm);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: var(--shadow-sm);
        }
        .dialect-card-meta {
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
          text-align: left;
        }
        .dialect-card-meta h4 {
          font-size: 1.05rem;
          font-weight: 800;
          color: var(--text-primary);
        }
        .dialect-card-meta p {
          font-size: 0.8rem;
          color: var(--text-secondary);
          line-height: 1.4;
        }
        .dialect-check-badge {
          position: absolute;
          top: 12px;
          right: 12px;
          width: 20px;
          height: 20px;
          background: var(--primary);
          color: #ffffff;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.72rem;
          font-weight: bold;
        }
      `}</style>
    </div>
  );
}
