import React, { useState } from 'react';
import DiffEditor from './DiffEditor';

export default function Workspace({ 
  objects, 
  onUpdateObjectSql, 
  onAiTranslateObject, 
  isTranslatingMap, 
  hasApiKey, 
  onGoToSummary,
  onBackToUpload
}) {
  const [selectedObjectId, setSelectedObjectId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState('ALL');

  // Filter objects by search term and active category
  const filteredObjects = objects.filter(obj => {
    const matchesSearch = obj.classified.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         obj.classified.schema.toLowerCase().includes(searchTerm.toLowerCase());
    
    if (activeCategory === 'ALL') return matchesSearch;
    if (activeCategory === 'TABLES') return matchesSearch && obj.classified.type === 'TABLE';
    if (activeCategory === 'SEQUENCES') return matchesSearch && obj.classified.type === 'SEQUENCE';
    if (activeCategory === 'INDEXES') return matchesSearch && (obj.classified.type === 'INDEX' || obj.classified.type === 'CONSTRAINT');
    if (activeCategory === 'LOGIC') return matchesSearch && ['VIEW', 'FUNCTION', 'PROCEDURE', 'TRIGGER'].includes(obj.classified.type);
    
    return matchesSearch;
  });

  const selectedObject = objects.find(obj => obj.classified.id === selectedObjectId);

  const getStatusIcon = (obj) => {
    if (['VIEW', 'FUNCTION', 'PROCEDURE', 'TRIGGER'].includes(obj.classified.type)) {
      if (isTranslatingMap[obj.classified.id]) {
        return (
          <span className="status-spinner-small" title="Translating..."></span>
        );
      }
      if (obj.translation.tsql.includes('-- PENDING AI TRANSLATION --')) {
        return (
          <span className="status-indicator-dot warning" title="AI Translation Pending"></span>
        );
      }
      return (
        <span className="status-indicator-dot success" title="Translated by AI"></span>
      );
    }
    
    if (obj.translation.warnings && obj.translation.warnings.length > 0) {
      return (
        <span className="status-indicator-dot warning" title="Converted with warnings"></span>
      );
    }
    return (
      <span className="status-indicator-dot success" title="Successfully converted"></span>
    );
  };

  const getCategoryCounts = (category) => {
    if (category === 'ALL') return objects.length;
    if (category === 'TABLES') return objects.filter(o => o.classified.type === 'TABLE').length;
    if (category === 'SEQUENCES') return objects.filter(o => o.classified.type === 'SEQUENCE').length;
    if (category === 'INDEXES') return objects.filter(o => o.classified.type === 'INDEX' || o.classified.type === 'CONSTRAINT').length;
    if (category === 'LOGIC') return objects.filter(o => ['VIEW', 'FUNCTION', 'PROCEDURE', 'TRIGGER'].includes(o.classified.type)).length;
    return 0;
  };

  return (
    <div className="workspace-container">
      {/* Workspace Sidebar */}
      <aside className="workspace-sidebar glass-panel">
        <div className="sidebar-search">
          <input
            type="text"
            className="input-control search-control"
            placeholder="Search objects..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {/* Category Filter tabs */}
        <div className="category-filters">
          {['ALL', 'TABLES', 'SEQUENCES', 'INDEXES', 'LOGIC'].map(cat => (
            <button
              key={cat}
              className={`filter-btn ${activeCategory === cat ? 'active' : ''}`}
              onClick={() => setActiveCategory(cat)}
            >
              <span className="filter-label">{cat}</span>
              <span className="filter-badge">{getCategoryCounts(cat)}</span>
            </button>
          ))}
        </div>

        {/* Navigation list */}
        <div className="objects-list">
          {filteredObjects.length === 0 ? (
            <div className="empty-search">No matching objects found.</div>
          ) : (
            filteredObjects.map(obj => (
              <div 
                key={obj.classified.id}
                className={`object-item ${selectedObjectId === obj.classified.id ? 'active' : ''}`}
                onClick={() => setSelectedObjectId(obj.classified.id)}
              >
                <div className="object-info">
                  <span className="object-type-label">{obj.classified.type}</span>
                  <strong className="object-name-label">{obj.classified.schema}.{obj.classified.name}</strong>
                </div>
                {getStatusIcon(obj)}
              </div>
            ))
          )}
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-footer-actions">
            <button className="btn btn-secondary" onClick={onBackToUpload} title="Back to file upload">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Back
            </button>
            <button className="btn btn-primary btn-summary-nav" onClick={onGoToSummary} title="Go to review & export">
              Next
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Workspace Area */}
      <main className="workspace-main">
        {selectedObject ? (
          <DiffEditor
            objectName={`${selectedObject.classified.schema}.${selectedObject.classified.name}`}
            objectType={selectedObject.classified.type}
            originalSql={selectedObject.classified.raw}
            convertedSql={selectedObject.translation.tsql}
            onSqlChange={(newSql) => onUpdateObjectSql(selectedObject.classified.id, newSql)}
            warnings={selectedObject.translation.warnings}
            onAiTranslate={() => onAiTranslateObject(selectedObject.classified.id)}
            isTranslating={isTranslatingMap[selectedObject.classified.id] || false}
            hasApiKey={hasApiKey}
            requiresAi={selectedObject.translation.requiresAi}
          />
        ) : (
          <div className="workspace-dashboard glass-panel">
            <div className="dashboard-content">
              <svg className="dashboard-icon" viewBox="0 0 24 24" width="64" height="64" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
                <path d="M12 6v6l4 2" />
              </svg>
              <h3>Workspace Loaded</h3>
              <p>Select any PostgreSQL database object from the sidebar list to inspect and edit its SQL Server translation side-by-side.</p>
              
              <div className="dashboard-stats-grid">
                <div className="stat-box glass-panel">
                  <span>Tables</span>
                  <strong>{objects.filter(o => o.classified.type === 'TABLE').length}</strong>
                </div>
                <div className="stat-box glass-panel">
                  <span>Sequences</span>
                  <strong>{objects.filter(o => o.classified.type === 'SEQUENCE').length}</strong>
                </div>
                <div className="stat-box glass-panel">
                  <span>PL/pgSQL Code</span>
                  <strong>{objects.filter(o => ['VIEW', 'FUNCTION', 'PROCEDURE', 'TRIGGER'].includes(o.classified.type)).length}</strong>
                </div>
              </div>
              
              <button className="btn btn-primary" onClick={onGoToSummary}>
                View Final Script & Report
              </button>
            </div>
          </div>
        )}
      </main>

      <style>{`
        .workspace-container {
          display: grid;
          grid-template-columns: 320px minmax(0, 1fr);
          gap: 1.5rem;
          flex: 1;
          margin-top: 1.5rem;
          margin-bottom: 2rem;
          height: calc(100vh - 120px);
          min-height: 0; /* Enable flex container overflow scroll */
          padding: 0 2rem;
        }
        
        @media (max-width: 768px) {
          .workspace-container {
            grid-template-columns: 1fr;
            height: auto;
          }
        }
        
        .workspace-sidebar {
          display: flex;
          flex-direction: column;
          background: var(--panel-bg);
          border: 1px solid var(--panel-border);
          border-radius: var(--radius-md);
          overflow: hidden;
          height: 100%;
        }
        
        .sidebar-search {
          padding: 1rem;
          border-bottom: 1px solid var(--panel-border);
        }
        
        .search-control {
          font-size: 0.85rem;
          padding: 0.55rem 0.85rem;
        }
        
        .category-filters {
          display: flex;
          flex-direction: column;
          padding: 0.75rem 0.5rem;
          border-bottom: 1px solid var(--panel-border);
          gap: 0.2rem;
        }
        
        .filter-btn {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: none;
          border: none;
          color: var(--text-secondary);
          padding: 0.5rem 0.75rem;
          font-family: var(--font-sans);
          font-weight: 600;
          font-size: 0.85rem;
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .filter-btn:hover {
          background: var(--item-hover-bg, rgba(255, 255, 255, 0.04));
          color: var(--text-primary);
        }
        
        .filter-btn.active {
          background: var(--filter-active-bg, rgba(99, 102, 241, 0.08));
          color: var(--filter-active-text, #a5b4fc);
        }
        
        .filter-badge {
          background: var(--badge-bg, rgba(255, 255, 255, 0.06));
          color: var(--text-secondary);
          font-size: 0.75rem;
          padding: 0.15rem 0.45rem;
          border-radius: 9999px;
          border: 1px solid var(--panel-border);
        }
        
        .filter-btn.active .filter-badge {
          background: var(--primary);
          color: #fff;
          border-color: var(--primary);
        }
        
        .objects-list {
          flex: 1;
          overflow-y: auto;
          padding: 0.75rem 0.5rem;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        
        .object-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.65rem 0.75rem;
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: all 0.2s;
          border: 1px solid transparent;
        }
        
        .object-item:hover {
          background: var(--item-hover-bg, rgba(255, 255, 255, 0.03));
          border-color: var(--panel-border);
        }
        
        .object-item.active {
          background: var(--item-active-bg, rgba(255, 255, 255, 0.05));
          border-color: var(--primary);
        }
        
        .object-info {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
          min-width: 0;
        }
        
        .object-type-label {
          font-size: 0.65rem;
          color: var(--text-muted);
          text-transform: uppercase;
          font-weight: 700;
          letter-spacing: 0.05em;
        }
        
        .object-name-label {
          font-size: 0.85rem;
          color: var(--text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 230px;
        }
        
        .object-item.active .object-name-label {
          color: var(--text-primary);
        }
        
        .status-indicator-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .status-indicator-dot.success { background: var(--success); }
        .status-indicator-dot.warning { background: var(--warning); }
        
        .status-spinner-small {
          width: 12px;
          height: 12px;
          border: 2px solid rgba(255, 255, 255, 0.15);
          border-top-color: var(--primary);
          border-radius: 50%;
          animation: rotate 1s linear infinite;
        }
        
        .empty-search {
          padding: 2rem;
          text-align: center;
          color: var(--text-muted);
          font-size: 0.85rem;
        }
        
        .sidebar-footer {
          padding: 1rem;
          border-top: 1px solid var(--panel-border);
        }
        
        .btn-summary-nav {
          width: 100%;
          font-size: 0.88rem;
          padding: 0.6rem;
        }
        
        .workspace-main {
          height: 100%;
          min-height: 0;
          min-width: 0;
        }
        
        .workspace-dashboard {
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--dashboard-bg, rgba(10, 15, 30, 0.35));
        }
        
        .dashboard-content {
          max-width: 460px;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1.25rem;
          padding: 2rem;
        }
        
        .dashboard-icon {
          color: var(--primary);
          opacity: 0.7;
          filter: drop-shadow(0 0 10px var(--primary-glow));
        }
        
        .dashboard-content h3 {
          font-size: 1.35rem;
          font-weight: 700;
          color: var(--text-primary);
        }
        
        .dashboard-content p {
          color: var(--text-secondary);
          line-height: 1.6;
          font-size: 0.9rem;
        }
        
        .dashboard-stats-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1rem;
          width: 100%;
          margin: 1rem 0;
        }
        
        .stat-box {
          padding: 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          background: var(--panel-bg);
          border: 1px solid var(--panel-border);
          border-radius: var(--radius-sm);
        }
        
        .stat-box span {
          font-size: 0.75rem;
          color: var(--text-secondary);
          font-weight: 600;
          text-transform: uppercase;
        }
        
        .stat-box strong {
          font-size: 1.35rem;
          color: var(--text-primary);
        }
      `}</style>
    </div>
  );
}
