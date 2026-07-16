import React, { useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import { validatePassword } from '../utils/passwordValidator';

export default function SettingsPanel({ isOpen, onClose, settings, onUpdateSettings, user }) {
  if (!isOpen) return null;

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdError, setPwdError] = useState(null);
  const [pwdSuccess, setPwdSuccess] = useState(null);
  const [pwdLoading, setPwdLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setPwdLoading(true);
    setPwdError(null);
    setPwdSuccess(null);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPwdError('Please fill in all password fields.');
      setPwdLoading(false);
      return;
    }

    if (newPassword !== confirmPassword) {
      setPwdError('New passwords do not match.');
      setPwdLoading(false);
      return;
    }

    const complexityError = validatePassword(newPassword);
    if (complexityError) {
      setPwdError(complexityError);
      setPwdLoading(false);
      return;
    }

    try {
      // 1. Verify current password by signing in with user's email
      const { error: verifyErr } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword
      });

      if (verifyErr) {
        throw new Error('Current password is incorrect.');
      }

      // 2. Perform the update to the new password
      const { error: updateErr } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (updateErr) throw updateErr;

      setPwdSuccess('Password changed successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      console.error('Password change error:', err);
      setPwdError(err.message || 'An error occurred during password change.');
    } finally {
      setPwdLoading(false);
    }
  };

  const handleApiKeyChange = (e) => {
    onUpdateSettings({ apiKey: e.target.value });
  };

  const handleUnicodeChange = (e) => {
    onUpdateSettings({ useUnicode: e.target.checked });
  };

  const handleModelChange = (e) => {
    onUpdateSettings({ model: e.target.value });
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel glass-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Configuration Settings</h2>
          <button className="btn-close" onClick={onClose} aria-label="Close Settings">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="settings-content">
          <div className="setting-section">
            <h3>AI Translation Engine</h3>
            <p className="setting-desc">Used to translate complex PL/pgSQL structures (views, functions, procedures, triggers) in the browser.</p>
            
            <div className="input-group">
              <label htmlFor="gemini-api-key">Google Gemini API Key</label>
              <input
                id="gemini-api-key"
                type="password"
                className="input-control"
                placeholder="AIzaSy..."
                value={settings.apiKey || ''}
                onChange={handleApiKeyChange}
              />
              <span className="helper-text">
                Your key is stored locally in your browser. Get a key from the{' '}
                <a href="https://aistudio.google.com/" target="_blank" rel="noopener noreferrer">
                  Google AI Studio
                </a>.
              </span>
            </div>

            <div className="input-group">
              <label htmlFor="gemini-model">Gemini Model Choice</label>
              <select
                id="gemini-model"
                className="input-control"
                value={settings.model || 'gemini-3.1-flash-lite'}
                onChange={handleModelChange}
              >
                <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash-Lite (Default / Safe Fallback)</option>
                <option value="gemini-3.5-flash">Gemini 3.5 Flash (Recommended - Fastest)</option>
                <option value="gemini-3.1-pro">Gemini 3.1 Pro (Deep reasoning)</option>
              </select>
            </div>
          </div>

          <div className="setting-section">
            <h3>T-SQL Dialect Mapping</h3>
            <p className="setting-desc">Configure how data structures are mapped during translation.</p>

            <div className="checkbox-group">
              <label className="checkbox-container">
                <input
                  type="checkbox"
                  checked={settings.useUnicode ?? true}
                  onChange={handleUnicodeChange}
                />
                <span className="checkmark"></span>
                <span className="checkbox-label">
                  <strong>Use Unicode Types (NVARCHAR/NCHAR)</strong>
                  <span className="checkbox-desc">Maps PostgreSQL text types to SQL Server Unicode types. Recommendation: Yes, to prevent character conversion issues.</span>
                </span>
              </label>
            </div>

            <div className="input-group" style={{ marginTop: '1rem' }}>
              <label htmlFor="deployment-mode">T-SQL Deployment Mode</label>
              <select
                id="deployment-mode"
                className="input-control"
                value={settings.deploymentMode || 'migration'}
                onChange={(e) => onUpdateSettings({ deploymentMode: e.target.value })}
              >
                <option value="migration">Migration Mode (DROP + CREATE)</option>
                <option value="deployment">Deployment Mode (Preserve Existing)</option>
              </select>
              <span className="helper-text" style={{ display: 'block', marginTop: '0.25rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Migration Mode drops and recreates tables/indexes. Deployment Mode skips creating them if they already exist.
              </span>
            </div>

            <div className="input-group" style={{ marginTop: '1rem' }}>
              <label htmlFor="sql-server-version">SQL Server Version</label>
              <select
                id="sql-server-version"
                className="input-control"
                value={settings.sqlServerVersion || '2017+'}
                onChange={(e) => onUpdateSettings({ sqlServerVersion: e.target.value })}
              >
                <option value="2017+">SQL Server 2017 / 2019 / 2022 / Azure SQL (Supports CONCAT_WS)</option>
                <option value="2016-">SQL Server 2016 or Older (Simulates CONCAT_WS via STUFF/COALESCE)</option>
              </select>
              <span className="helper-text" style={{ display: 'block', marginTop: '0.25rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Determines compatibility for advanced built-in functions.
              </span>
            </div>
          </div>

          {user && (
            <div className="setting-section" style={{ borderTop: '1px solid var(--panel-border)', paddingTop: '1.25rem' }}>
              <h3>Change Password</h3>
              <p className="setting-desc">Securely update your password. Enforces length and complexity rules.</p>
              
              <form onSubmit={handlePasswordChange} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
                {pwdError && (
                  <div className="auth-alert auth-alert-error" style={{ margin: 0, padding: '0.5rem 0.75rem', fontSize: '0.8rem', borderRadius: 'var(--radius-sm)', background: 'var(--error-bg)', color: '#fca5a5', border: '1px solid var(--error-border)' }}>
                    <span>⚠️ {pwdError}</span>
                  </div>
                )}
                {pwdSuccess && (
                  <div className="auth-alert auth-alert-success" style={{ margin: 0, padding: '0.5rem 0.75rem', fontSize: '0.8rem', borderRadius: 'var(--radius-sm)', background: 'var(--success-bg)', color: '#86efac', border: '1px solid var(--success-border)' }}>
                    <span>✓ {pwdSuccess}</span>
                  </div>
                )}

                <div className="input-group" style={{ marginBottom: '0.75rem' }}>
                  <label htmlFor="curr-pwd">Current Password</label>
                  <input
                    id="curr-pwd"
                    type={showPassword ? 'text' : 'password'}
                    className="input-control"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                    disabled={pwdLoading}
                  />
                </div>

                <div className="input-group" style={{ marginBottom: '0.75rem' }}>
                  <label htmlFor="new-pwd">New Password</label>
                  <input
                    id="new-pwd"
                    type={showPassword ? 'text' : 'password'}
                    className="input-control"
                    placeholder="••••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    disabled={pwdLoading}
                  />
                </div>

                <div className="input-group" style={{ marginBottom: '0.75rem' }}>
                  <label htmlFor="conf-pwd">Confirm New Password</label>
                  <input
                    id="conf-pwd"
                    type={showPassword ? 'text' : 'password'}
                    className="input-control"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    disabled={pwdLoading}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '-0.25rem' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={showPassword}
                      onChange={() => setShowPassword(!showPassword)}
                      style={{ accentColor: 'var(--primary)' }}
                    />
                    Show Passwords
                  </label>
                  <button type="submit" className="btn btn-secondary" disabled={pwdLoading} style={{ padding: '0.4rem 0.85rem', fontSize: '0.8rem', height: '32px' }}>
                    {pwdLoading ? 'Changing...' : 'Change Password'}
                  </button>
                </div>
              </form>
            </div>
          )}
          
          <div className="settings-info-alert">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" className="info-icon">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <div className="info-alert-text">
              <h4>Direct Browser-to-API Calls</h4>
              <p>This web application communicates directly with Google's API endpoints from your browser. None of your database schemas, scripts, or API keys are sent to third-party backend servers.</p>
            </div>
          </div>
        </div>

        <div className="settings-footer">
          <button className="btn btn-primary" onClick={onClose} style={{ width: '100%' }}>
            Save & Close
          </button>
        </div>
      </div>

      <style>{`
        .settings-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(4, 6, 12, 0.7);
          backdrop-filter: blur(4px);
          z-index: 1000;
          display: flex;
          justify-content: flex-end;
          animation: fadeIn 0.2s ease-out;
        }
        
        .settings-panel {
          width: 460px;
          max-width: 100%;
          height: 100%;
          border-radius: 0;
          border-left: 1px solid var(--panel-border);
          border-top: none;
          border-bottom: none;
          border-right: none;
          display: flex;
          flex-direction: column;
          background: #090e1a;
          box-shadow: -10px 0 30px rgba(0,0,0,0.5);
          animation: slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        
        .settings-header {
          padding: 1.5rem;
          border-bottom: 1px solid var(--panel-border);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .settings-header h2 {
          font-size: 1.25rem;
          font-weight: 700;
          color: #fff;
        }
        
        .btn-close {
          background: none;
          border: none;
          color: var(--text-secondary);
          cursor: pointer;
          transition: color 0.2s;
          padding: 4px;
        }
        
        .btn-close:hover {
          color: #fff;
        }
        
        .settings-content {
          flex: 1;
          overflow-y: auto;
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 2rem;
        }
        
        .setting-section {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        
        .setting-section h3 {
          font-size: 1rem;
          font-weight: 700;
          color: #fff;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          padding-bottom: 0.4rem;
        }
        
        .setting-desc {
          font-size: 0.85rem;
          color: var(--text-secondary);
          line-height: 1.4;
        }
        
        .helper-text {
          font-size: 0.78rem;
          color: var(--text-muted);
          line-height: 1.4;
        }
        
        .helper-text a {
          color: var(--primary);
          text-decoration: underline;
        }
        
        .checkbox-group {
          margin-top: 0.5rem;
        }
        
        .checkbox-container {
          display: flex;
          align-items: flex-start;
          gap: 0.75rem;
          cursor: pointer;
          position: relative;
        }
        
        .checkbox-container input {
          position: absolute;
          opacity: 0;
          cursor: pointer;
          height: 0;
          width: 0;
        }
        
        .checkmark {
          min-width: 18px;
          height: 18px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid var(--panel-border);
          border-radius: 4px;
          margin-top: 3px;
          position: relative;
          transition: all 0.2s;
        }
        
        .checkbox-container:hover input ~ .checkmark {
          background: rgba(255, 255, 255, 0.1);
          border-color: var(--panel-border-hover);
        }
        
        .checkbox-container input:checked ~ .checkmark {
          background: var(--primary);
          border-color: var(--primary);
        }
        
        .checkmark:after {
          content: "";
          position: absolute;
          display: none;
          left: 5px;
          top: 2px;
          width: 5px;
          height: 9px;
          border: solid white;
          border-width: 0 2px 2px 0;
          transform: rotate(45deg);
        }
        
        .checkbox-container input:checked ~ .checkmark:after {
          display: block;
        }
        
        .checkbox-label {
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
        }
        
        .checkbox-label strong {
          font-size: 0.9rem;
          color: #fff;
        }
        
        .checkbox-desc {
          font-size: 0.78rem;
          color: var(--text-secondary);
          line-height: 1.4;
        }
        
        .settings-info-alert {
          background: rgba(99, 102, 241, 0.05);
          border: 1px solid rgba(99, 102, 241, 0.15);
          border-radius: var(--radius-sm);
          padding: 1rem;
          display: flex;
          gap: 0.75rem;
          margin-top: 1rem;
        }
        
        .info-icon {
          color: var(--primary);
          flex-shrink: 0;
        }
        
        .info-alert-text h4 {
          font-size: 0.85rem;
          font-weight: 700;
          color: #fff;
          margin-bottom: 0.25rem;
        }
        
        .info-alert-text p {
          font-size: 0.78rem;
          color: var(--text-secondary);
          line-height: 1.45;
        }
        
        .settings-footer {
          padding: 1.5rem;
          border-top: 1px solid var(--panel-border);
        }
      `}</style>
    </div>
  );
}
