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
      <div className="upload-header">
        <h2>Convert Postgres schemas to T-SQL</h2>
        <p>Upload a PostgreSQL schema dump (.sql generated with pg_dump --schema-only). You can optionally upload a JSON/CSV file with column metadata mapping too.</p>
      </div>

      <div 
        className={`dropzone glass-panel ${dragActive ? 'drag-active' : ''}`}
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
      >
        <div className="dropzone-content">
          <svg className="upload-icon" viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <h3>Drag & Drop Schema Files Here</h3>
          <p className="dropzone-sub">Supports SQL schema dumps and metadata (CSV/JSON)</p>
          <div className="divider-text">or</div>
        </div>

        <div className="upload-slots">
          {/* SQL Slot */}
          <div className={`file-slot glass-panel ${sqlFile ? 'has-file' : ''}`} onClick={() => sqlInputRef.current?.click()}>
            <input 
              type="file" 
              ref={sqlInputRef} 
              style={{ display: 'none' }} 
              accept=".sql" 
              onChange={handleSqlChange} 
            />
            <div className="slot-icon">
              <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            </div>
            <div className="slot-info">
              <h4>Schema Script (.sql)</h4>
              <p>{sqlFile ? sqlFile.name : 'Choose primary PostgreSQL file'}</p>
            </div>
            {sqlFile && (
              <button className="btn-remove" onClick={removeSqlFile} aria-label="Remove SQL file" title="Remove SQL file">
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            )}
          </div>

          {/* Meta Slot */}
          <div className={`file-slot glass-panel ${metaFile ? 'has-file' : ''}`} onClick={() => metaInputRef.current?.click()}>
            <input 
              type="file" 
              ref={metaInputRef} 
              style={{ display: 'none' }} 
              accept=".csv,.json" 
              onChange={handleMetaChange} 
            />
            <div className="slot-icon">
              <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            </div>
            <div className="slot-info">
              <h4>Optional Metadata (.csv / .json)</h4>
              <p>{metaFile ? metaFile.name : 'Choose column metadata definitions'}</p>
            </div>
            {metaFile && (
              <button className="btn-remove" onClick={removeMetaFile} aria-label="Remove metadata file" title="Remove metadata file">
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            )}
          </div>
        </div>

        <button 
          className="btn btn-primary btn-process" 
          disabled={!sqlFile}
          onClick={handleProcess}
        >
          Parse & Convert Schema
          <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      <style>{`
        .upload-container {
          padding-top: 4rem;
          padding-bottom: 4rem;
          max-width: 800px !important;
          animation: fadeIn 0.4s ease-out;
        }
        
        .upload-header {
          text-align: center;
          margin-bottom: 3rem;
        }
        
        .upload-header h2 {
          font-size: 2.25rem;
          font-weight: 800;
          margin-bottom: 0.75rem;
          background: linear-gradient(135deg, var(--text-primary) 40%, var(--primary) 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        
        .upload-header p {
          color: var(--text-secondary);
          line-height: 1.6;
          font-size: 1.05rem;
        }
        
        .dropzone {
          padding: 3rem 2rem;
          text-align: center;
          border: 2px dashed var(--panel-border);
          transition: all 0.3s;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2rem;
          background: var(--dropzone-bg, rgba(13, 20, 38, 0.4));
          border-radius: var(--radius-md);
        }
        
        .dropzone.drag-active {
          border-color: var(--primary);
          background: rgba(99, 102, 241, 0.04);
          transform: scale(1.01);
          box-shadow: 0 0 30px rgba(99,102,241,0.08);
        }
        
        .dropzone-content {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.75rem;
        }
        
        .upload-icon {
          color: var(--primary);
          filter: drop-shadow(0 0 8px rgba(99,102,241,0.2));
          margin-bottom: 0.5rem;
        }
        
        .dropzone-content h3 {
          font-size: 1.25rem;
          font-weight: 700;
          color: var(--text-primary);
        }
        
        .dropzone-sub {
          font-size: 0.85rem;
          color: var(--text-muted);
        }
        
        .divider-text {
          font-size: 0.85rem;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin-top: 0.5rem;
          position: relative;
          width: 200px;
        }
        
        .divider-text::before, .divider-text::after {
          content: '';
          position: absolute;
          top: 50%;
          width: 35%;
          height: 1px;
          background: var(--panel-border);
        }
        
        .divider-text::before { left: 0; }
        .divider-text::after { right: 0; }
        
        .upload-slots {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1.25rem;
          width: 100%;
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
          background: var(--panel-bg);
          border: 1px solid var(--panel-border);
          border-radius: var(--radius-sm);
          position: relative;
          user-select: none;
        }
        
        .file-slot:hover {
          background: var(--panel-bg-opaque);
          border-color: var(--panel-border-hover);
          transform: translateY(-1px);
        }
        
        .file-slot.has-file {
          border-color: rgba(99,102,241,0.3);
          background: rgba(99,102,241,0.03);
        }
        
        .slot-icon {
          color: var(--text-secondary);
          flex-shrink: 0;
        }
        
        .file-slot.has-file .slot-icon {
          color: var(--primary);
        }
        
        .slot-info h4 {
          font-size: 0.9rem;
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 0.2rem;
        }
        
        .slot-info p {
          font-size: 0.78rem;
          color: var(--text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 220px;
        }
        
        .btn-remove {
          position: absolute;
          right: 12px;
          background: rgba(255, 255, 255, 0.05);
          color: var(--text-secondary);
          border: 1px solid var(--panel-border);
          border-radius: 50%;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .btn-remove:hover {
          background: rgba(239, 68, 68, 0.15);
          color: var(--error);
          border-color: rgba(239, 68, 68, 0.25);
          transform: scale(1.05);
        }
        
        .btn-process {
          width: 100%;
          max-width: 320px;
          margin-top: 1rem;
        }
      `}</style>
    </div>
  );
}
