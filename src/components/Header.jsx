import React from 'react';

export default function Header({ theme, onToggleTheme, onOpenSettings, activeStep, onReset, parsedCount, onBulkTranslate, isBulkTranslating, pendingCount, user, onSignOut }) {
  return (
    <header className="app-header">
      <div className="container header-container">
        {/* Left Brand Area */}
        <div className="brand" onClick={onReset} style={{ cursor: 'pointer' }}>
          <div className="brand-avatar">VT</div>
          <div className="brand-text-wrapper">
            <span className="brand-company">VTAB SQUARE</span>
            <span className="brand-badge-pill">
              <span className="brand-dot-pulse"></span>
              AI MIGRATION ENGINE v2.0
            </span>
          </div>
        </div>

        {/* Right Action Icons & Settings */}
        <div className="header-actions">
          {activeStep !== 'upload' && (
            <div className="stats-indicator">
              <span className="dot pulse"></span>
              <span className="stats-label">{parsedCount} Objects</span>
            </div>
          )}

          {activeStep === 'workspace' && pendingCount > 0 && (
            <button 
              className={`btn btn-primary btn-bulk-translate ${isBulkTranslating ? 'loading' : ''}`}
              onClick={onBulkTranslate}
              disabled={isBulkTranslating}
              style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', borderRadius: '30px' }}
            >
              Translate All ({pendingCount})
            </button>
          )}

          <div className="header-date-badge">
            {new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
          </div>

          <button className="theme-btn-round" onClick={onOpenSettings} title="Open Settings" style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            ⚙️
          </button>

          {user && (
            <div className="header-profile-section">
              <div className="user-badge" title={user.email}>
                <div className="user-avatar-placeholder">
                  {user.email ? user.email.charAt(0).toUpperCase() : 'U'}
                </div>
              </div>
              <button className="btn-signout-round" onClick={onSignOut} title="Sign Out">
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </button>
            </div>
          )}

          <button className="theme-btn-round" onClick={onToggleTheme} title="Toggle Theme">
            {theme === 'dark' ? '🌙' : '☀️'}
          </button>
        </div>
      </div>

      <style>{`
        .app-header {
          border-bottom: 1px solid var(--panel-border);
          background: var(--header-bg);
          box-shadow: var(--shadow-sm);
          position: sticky;
          top: 0;
          z-index: 100;
          height: 64px;
          display: flex;
          align-items: center;
        }
        .header-container {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }
        .brand-avatar {
          width: 32px;
          height: 32px;
          background: var(--primary);
          color: #fff;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 800;
          font-size: 0.9rem;
          box-shadow: var(--shadow-sm);
        }
        .brand-text-wrapper {
          display: flex;
          flex-direction: column;
        }
        .brand-company {
          font-size: 0.95rem;
          font-weight: 800;
          color: var(--text-primary);
          letter-spacing: -0.01em;
        }
        .brand-badge-pill {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          font-size: 0.65rem;
          font-weight: 700;
          color: var(--primary);
          background: rgba(79, 70, 229, 0.08);
          padding: 0.1rem 0.4rem;
          border-radius: 4px;
          margin-top: 0.1rem;
        }
        .brand-dot-pulse {
          width: 5px;
          height: 5px;
          background: var(--primary);
          border-radius: 50%;
          animation: brandPulse 1.6s infinite;
        }
        @keyframes brandPulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.4); opacity: 0.6; }
        }
        
        .header-nav {
          display: flex;
          gap: 0.5rem;
          background: var(--panel-tab-bg);
          padding: 0.25rem;
          border-radius: 30px;
          border: 1px solid var(--panel-border);
        }
        .nav-pill {
          background: transparent;
          border: none;
          padding: 0.45rem 1rem;
          font-size: 0.85rem;
          font-weight: 600;
          color: var(--text-secondary);
          border-radius: 30px;
          cursor: pointer;
          transition: all var(--transition-fast);
        }
        .nav-pill:hover:not(:disabled) {
          color: var(--text-primary);
        }
        .nav-pill.active {
          background: var(--primary);
          color: #fff;
          box-shadow: var(--shadow-sm);
        }
        .nav-pill:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        .header-actions {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }
        
        .header-date-badge {
          background: var(--panel-tab-bg);
          border: 1px solid var(--panel-border);
          border-radius: 30px;
          padding: 0.4rem 0.85rem;
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--text-secondary);
        }
        
        .btn-deploy-main {
          display: inline-flex;
          align-items: center;
          background: var(--primary);
          color: #fff;
          border: none;
          font-family: var(--font-sans);
          font-weight: 600;
          font-size: 0.85rem;
          padding: 0.45rem 1rem;
          border-radius: 30px;
          cursor: pointer;
          transition: all var(--transition-fast);
          box-shadow: var(--shadow-sm);
        }
        .btn-deploy-main:hover {
          background: var(--primary-hover);
          transform: translateY(-1px);
        }
        
        .btn-signout-round {
          background: transparent;
          border: 1px solid var(--panel-border);
          color: var(--text-secondary);
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all var(--transition-fast);
        }
        .btn-signout-round:hover {
          background: rgba(239, 68, 68, 0.08);
          color: var(--error);
          border-color: rgba(239, 68, 68, 0.2);
        }
        
        .theme-btn-round {
          background: var(--panel-tab-bg);
          border: 1px solid var(--panel-border);
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          font-size: 0.9rem;
          transition: all var(--transition-fast);
        }
        .theme-btn-round:hover {
          background: var(--panel-border);
        }
        
        .stats-indicator {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.4rem 0.8rem;
          border-radius: 30px;
          font-size: 0.8rem;
          font-weight: 600;
          border: 1px solid var(--panel-border);
          background: var(--panel-tab-bg);
          color: var(--text-secondary);
        }
        .dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--success);
        }
        .dot.pulse {
          box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
          animation: pulse 1.6s infinite cubic-bezier(0.66, 0, 0, 1);
        }
        
        @keyframes pulse {
          to {
            box-shadow: 0 0 0 8px rgba(16, 185, 129, 0);
          }
        }
        
        @media (max-width: 640px) {
          .stats-indicator, .header-date-badge {
            display: none;
          }
        }
      `}</style>
    </header>
  );
}
