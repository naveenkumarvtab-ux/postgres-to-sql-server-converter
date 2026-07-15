import React from 'react';

export default function DiffEditor({ 
  objectName, 
  objectType, 
  originalSql, 
  convertedSql, 
  onSqlChange, 
  warnings, 
  onAiTranslate, 
  isTranslating, 
  hasApiKey,
  requiresAi
}) {
  
  const handleTextareaChange = (e) => {
    onSqlChange(e.target.value);
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    alert('Code copied to clipboard!');
  };

  // Helper to generate line numbers
  const renderLineNumbers = (text) => {
    const lines = (text || '').split('\n');
    return lines.map((_, idx) => (
      <div key={idx} className="line-num">{idx + 1}</div>
    ));
  };

  const isComplex = ['VIEW', 'FUNCTION', 'PROCEDURE', 'TRIGGER'].includes(objectType);

  return (
    <div className="diff-editor-container">
      {warnings && warnings.length > 0 && (
        <div className="warnings-banner">
          <div className="banner-title">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" className="warn-icon">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>Conversion Warnings ({warnings.length})</span>
          </div>
          <ul className="banner-list">
            {warnings.map((warn, i) => (
              <li key={i}>{warn}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="editor-grid">
        {/* Left Pane - Postgres */}
        <div className="pane glass-panel">
          <div className="pane-header">
            <div className="pane-title">
              <span className="badge badge-secondary">PostgreSQL</span>
              <h4>{objectName}</h4>
            </div>
            <button className="btn-action" onClick={() => copyToClipboard(originalSql)} title="Copy original SQL">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
          </div>
          <div className="code-editor">
            <div className="line-numbers">{renderLineNumbers(originalSql)}</div>
            <pre className="code-display"><code>{originalSql}</code></pre>
          </div>
        </div>

        {/* Right Pane - SQL Server */}
        <div className="pane glass-panel">
          <div className="pane-header">
            <div className="pane-title">
              <span className="badge badge-primary">SQL Server (T-SQL)</span>
              <h4>{objectName}</h4>
            </div>
            <div className="pane-actions">
              {isComplex && requiresAi !== false && (
                <button 
                  className={`btn btn-secondary btn-ai-translate ${isTranslating ? 'loading' : ''}`}
                  onClick={onAiTranslate}
                  disabled={isTranslating}
                  title={hasApiKey ? 'Translate using Gemini AI' : 'API Key missing in Settings'}
                >
                  <svg className="spark-icon" viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" />
                    <line x1="12" y1="22" x2="12" y2="15.5" />
                    <line x1="22" y1="8.5" x2="12" y2="15.5" />
                    <line x1="2" y1="8.5" x2="12" y2="15.5" />
                  </svg>
                  {isTranslating ? 'Translating...' : 'AI Translate'}
                </button>
              )}
              <button className="btn-action" onClick={() => copyToClipboard(convertedSql)} title="Copy T-SQL">
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
            </div>
          </div>
          <div className="code-editor editor-writeable">
            <div className="line-numbers">{renderLineNumbers(convertedSql)}</div>
            <textarea
              className="code-textarea"
              value={convertedSql}
              onChange={handleTextareaChange}
              spellCheck="false"
            />
          </div>
        </div>
      </div>

      <style>{`
        .diff-editor-container {
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          height: 100%;
          min-height: 0; /* Important for flex child overflow */
        }
        
        .warnings-banner {
          background: var(--warning-bg);
          border: 1px solid var(--warning-border);
          border-radius: var(--radius-sm);
          padding: 0.85rem 1.25rem;
          animation: fadeIn 0.3s ease-out;
        }
        
        .banner-title {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          color: var(--warning);
          font-weight: 700;
          font-size: 0.9rem;
          margin-bottom: 0.4rem;
        }
        
        .warn-icon {
          flex-shrink: 0;
        }
        
        .banner-list {
          padding-left: 1.25rem;
          font-size: 0.82rem;
          color: var(--text-secondary);
          line-height: 1.45;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        
        .editor-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 1.25rem;
          flex: 1;
          min-height: 0;
        }
        
        @media (max-width: 1024px) {
          .editor-grid {
            grid-template-columns: 1fr;
            grid-template-rows: 1fr 1fr;
          }
        }
        
        .pane {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 0;
          min-width: 0;
          background: var(--panel-bg);
          border: 1px solid var(--panel-border);
          border-radius: var(--radius-md);
        }
        
        .pane-header {
          padding: 0.75rem 1.25rem;
          border-bottom: 1px solid var(--panel-border);
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: var(--panel-tab-bg, rgba(15, 23, 42, 0.3));
          border-radius: var(--radius-md) var(--radius-md) 0 0;
        }
        
        .pane-title {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          min-width: 0;
        }
        
        .pane-title h4 {
          font-size: 0.95rem;
          font-weight: 700;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        
        .pane-actions {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }
        
        .btn-action {
          background: var(--badge-bg, rgba(255,255,255,0.04));
          border: 1px solid var(--panel-border);
          color: var(--text-secondary);
          width: 32px;
          height: 32px;
          border-radius: var(--radius-sm);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .btn-action:hover {
          background: var(--item-hover-bg, rgba(255,255,255,0.1));
          color: var(--text-primary);
          border-color: var(--panel-border-hover);
        }
        
        .btn-ai-translate {
          font-size: 0.8rem;
          padding: 0.4rem 0.9rem;
          height: 32px;
          border-radius: var(--radius-sm);
          background: var(--filter-active-bg, rgba(99, 102, 241, 0.1));
          color: var(--filter-active-text, #a5b4fc);
          border: 1px solid var(--panel-border);
          box-shadow: none;
        }
        
        .btn-ai-translate:hover:not(:disabled) {
          background: var(--primary);
          color: #fff;
          border-color: var(--primary);
          box-shadow: 0 4px 12px rgba(99, 102, 241, 0.25);
        }
        
        .btn-ai-translate:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        .spark-icon {
          color: inherit;
        }
        
        .code-editor {
          display: flex;
          flex: 1;
          min-height: 0;
          min-width: 0;
          overflow: hidden;
          font-family: var(--font-mono);
          font-size: 0.85rem;
          line-height: 1.5;
          border-radius: 0 0 var(--radius-md) var(--radius-md);
        }
        
        .line-numbers {
          padding: 1rem 0.5rem;
          background: var(--code-bg, rgba(8, 12, 24, 0.5));
          border-right: 1px solid var(--panel-border);
          color: var(--text-muted);
          text-align: right;
          min-width: 42px;
          user-select: none;
          overflow-y: hidden;
        }
        
        .line-num {
          height: 21.5px;
        }
        
        .code-display {
          flex: 1;
          padding: 1rem;
          overflow: auto;
          min-width: 0;
          background: var(--code-bg);
          color: var(--code-text);
          white-space: pre;
          margin: 0;
        }
        
        .code-display code {
          background: none;
          padding: 0;
          color: inherit;
          font-family: inherit;
          font-size: inherit;
          line-height: inherit;
        }
        
        .editor-writeable {
          position: relative;
        }
        
        .code-textarea {
          flex: 1;
          padding: 1rem;
          background: var(--code-bg);
          color: var(--code-text);
          border: none;
          resize: none;
          min-width: 0;
          font-family: var(--font-mono);
          font-size: 0.85rem;
          line-height: 1.5;
          outline: none;
          overflow: auto;
          white-space: pre;
        }
        
        .code-textarea:focus {
          background: var(--code-bg);
        }
        
        @keyframes rotate {
          100% { transform: rotate(360deg); }
        }
        .btn-ai-translate.loading .spark-icon {
          animation: rotate 1.5s linear infinite;
        }
      `}</style>
    </div>
  );
}
