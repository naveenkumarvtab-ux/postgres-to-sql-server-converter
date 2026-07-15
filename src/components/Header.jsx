import React from 'react';

export default function Header({ theme, onToggleTheme, onOpenSettings, activeStep, onReset, parsedCount, onBulkTranslate, isBulkTranslating, pendingCount, user, onSignOut }) {
  return (
    <header className="app-header">
      <div className="container header-container">
        <div className="brand" onClick={onReset} style={{ cursor: 'pointer' }}>
          <svg className="logo" viewBox="0 0 24 24" width="32" height="32" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 11a9 9 0 0 1 9 9" />
            <path d="M4 4a16 16 0 0 1 16 16" />
            <circle cx="5" cy="19" r="1" fill="currentColor" />
          </svg>
          <div className="brand-text">
            <h1>TranspileDB</h1>
            <span>Postgres to SQL Server</span>
          </div>
        </div>

        <div className="header-actions">
          {activeStep !== 'upload' && (
            <div className="stats-indicator glass-panel">
              <span className="dot pulse"></span>
              <span className="stats-label">{parsedCount} Objects Parsed</span>
            </div>
          )}

          {activeStep === 'workspace' && pendingCount > 0 && (
            <button 
              className={`btn btn-primary btn-bulk-translate ${isBulkTranslating ? 'loading' : ''}`}
              onClick={onBulkTranslate}
              disabled={isBulkTranslating}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', fontSize: '0.85rem' }}
            >
              <svg className="spark-icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ animation: isBulkTranslating ? 'rotate 1.5s linear infinite' : 'none' }}>
                <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" />
                <line x1="12" y1="22" x2="12" y2="15.5" />
                <line x1="22" y1="8.5" x2="12" y2="15.5" />
                <line x1="2" y1="8.5" x2="12" y2="15.5" />
              </svg>
              {isBulkTranslating ? 'Translating...' : `Translate All Pending (${pendingCount})`}
            </button>
          )}

          {activeStep !== 'upload' && (
            <button className="btn btn-secondary" onClick={onReset}>
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              Start Over
            </button>
          )}

          {user && (
            <div className="header-profile-section">
              <div className="user-badge">
                <div className="user-avatar-placeholder">
                  {user.email ? user.email.charAt(0).toUpperCase() : 'U'}
                </div>
                <span>{user.email}</span>
              </div>
              <button className="btn-signout" onClick={onSignOut}>
                Sign Out
              </button>
            </div>
          )}

          <div className="theme-toggle-wrapper">
            <button 
              className={`theme-toggle-btn ${theme === 'dark' ? 'dark' : ''}`} 
              onClick={onToggleTheme}
              aria-label="Toggle Theme"
              title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
              type="button"
            >
              <div className="theme-toggle-knob">
                {theme === 'dark' ? '🌙' : '☀️'}
              </div>
            </button>
          </div>

          <button className="btn btn-secondary btn-settings" onClick={onOpenSettings} aria-label="Open Settings">
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Settings
          </button>
        </div>
      </div>

      <style>{`
        .app-header {
          border-bottom: 1px solid var(--panel-border);
          background: var(--header-bg, rgba(10, 16, 30, 0.45));
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          position: sticky;
          top: 0;
          z-index: 100;
          height: 70px;
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
        .logo {
          color: var(--primary);
          filter: drop-shadow(0 0 8px var(--primary-glow));
        }
        .brand-text h1 {
          font-size: 1.35rem;
          font-weight: 800;
          line-height: 1.1;
          background: linear-gradient(135deg, var(--text-primary) 30%, var(--primary) 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .brand-text span {
          font-size: 0.75rem;
          color: var(--text-secondary);
          letter-spacing: 0.05em;
          text-transform: uppercase;
          font-weight: 500;
        }
        .header-actions {
          display: flex;
          align-items: center;
          gap: 1rem;
        }
        .stats-indicator {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.4rem 0.8rem;
          border-radius: var(--radius-sm);
          font-size: 0.85rem;
          font-weight: 500;
          border: 1px solid var(--panel-border);
        }
        .dot {
          width: 8px;
          height: 8px;
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
          .stats-indicator, .btn-settings span {
            display: none;
          }
        }
      `}</style>
    </header>
  );
}
