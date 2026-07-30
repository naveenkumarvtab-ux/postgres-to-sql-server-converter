import React, { useState, useRef } from 'react';

export default function UploadZone({ onFilesUploaded }) {
  const [dragActive, setDragActive] = useState(false);
  const [sqlFile, setSqlFile] = useState(null);
  const [metaFile, setMetaFile] = useState(null);
  
  const sqlInputRef = useRef(null);
  const metaInputRef = useRef(null);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const files = Array.from(e.dataTransfer.files);
      const sql = files.find(f => f.name.endsWith('.sql'));
      const meta = files.find(f => f.name.endsWith('.json') || f.name.endsWith('.csv'));
      
      if (sql) setSqlFile(sql);
      if (meta) setMetaFile(meta);
    }
  };

  const handleSqlChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setSqlFile(e.target.files[0]);
    }
  };

  const handleMetaChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setMetaFile(e.target.files[0]);
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
          onFilesUploaded(sqlContent, sqlFile.name, parsedMeta);
        };
        metaReader.readAsText(metaFile);
      } else {
        onFilesUploaded(sqlContent, sqlFile.name, null);
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
            PostgreSQL <span className="title-arrow">➜</span> SQL Server
          </h2>
          <p className="hero-desc">
            Enterprise-grade automated migration. Upload your PostgreSQL scripts, run the analysis
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
            <span className="phase-pill">Phase 3: Validate & Export</span>
          </div>
        </div>

        <div className="step-stepper">
          <div className="step-pill completed">
            <span className="step-circle">✓</span>
            <span className="step-text">Instructions</span>
          </div>
          <div className="step-pill active">
            <span className="step-circle">2</span>
            <span className="step-text">Upload files</span>
          </div>
          <div className="step-pill">
            <span className="step-circle">3</span>
            <span className="step-text">Workspace Analysis</span>
          </div>
        </div>
      </div>

      {/* 📂 Drag & Drop Schema Area */}
      <div 
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
          <h3>Prepare your PostgreSQL migration package</h3>
          <p className="dropzone-sub">
            Drag & drop your PostgreSQL `.sql` schema dump script, and optional CSV/JSON column metadata definitions.
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
              <p>{sqlFile ? sqlFile.name : 'Choose primary PostgreSQL file'}</p>
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
              accept=".csv,.json" 
              onChange={handleMetaChange} 
            />
            <div className="slot-icon">
              <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" strokeWidth="2.5" fill="none">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </div>
            <div className="slot-info">
              <h4>Optional Metadata (.csv / .json)</h4>
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
      `}</style>
    </div>
  );
}
