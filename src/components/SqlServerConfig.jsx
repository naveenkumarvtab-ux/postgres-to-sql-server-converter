import React, { useState } from 'react';

export default function SqlServerConfig({ config, onUpdateConfig }) {
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const handleChange = (field, value) => {
    onUpdateConfig({ ...config, [field]: value });
  };

  const getApiUrl = (path) => {
    const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    return isLocalDev ? path : `http://127.0.0.1:3001${path}`;
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const response = await fetch(getApiUrl('/api/connection/test'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server: config.server,
          authMode: config.authMode,
          username: config.username,
          password: config.password
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Connection failed');
      }

      setTestResult({ success: true, message: 'Connection successful', info: data.serverInfo || 'SQL Server connected' });
      onUpdateConfig({ ...config, isConnected: true, serverInfo: data.serverInfo || 'SQL Server' });
    } catch (err) {
      setTestResult({ success: false, message: err.message || 'Connection failed' });
      onUpdateConfig({ ...config, isConnected: false, serverInfo: null });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="sql-config-section">
      <div className="input-group">
        <label htmlFor="sql-server-address">Server Address</label>
        <input
          id="sql-server-address"
          type="text"
          className="input-control"
          placeholder="localhost or server name"
          value={config.server || ''}
          onChange={(e) => handleChange('server', e.target.value)}
        />
      </div>

      <div className="input-group">
        <label>Authentication Mode</label>
        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.25rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'var(--text-primary)' }}>
            <input
              type="radio"
              name="authMode"
              value="windows"
              checked={config.authMode === 'windows'}
              onChange={(e) => handleChange('authMode', e.target.value)}
              style={{ accentColor: 'var(--primary)' }}
            />
            Windows Authentication
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'var(--text-primary)' }}>
            <input
              type="radio"
              name="authMode"
              value="sql"
              checked={config.authMode === 'sql'}
              onChange={(e) => handleChange('authMode', e.target.value)}
              style={{ accentColor: 'var(--primary)' }}
            />
            SQL Server Authentication
          </label>
        </div>
      </div>

      {config.authMode === 'sql' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div className="input-group">
            <label htmlFor="sql-username">Username</label>
            <input
              id="sql-username"
              type="text"
              className="input-control"
              value={config.username || ''}
              onChange={(e) => handleChange('username', e.target.value)}
            />
          </div>
          <div className="input-group">
            <label htmlFor="sql-password">Password</label>
            <input
              id="sql-password"
              type="password"
              className="input-control"
              value={config.password || ''}
              onChange={(e) => handleChange('password', e.target.value)}
            />
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="input-group">
          <label htmlFor="sql-db-prefix">Database Name Prefix</label>
          <input
            id="sql-db-prefix"
            type="text"
            className="input-control"
            value={config.dbPrefix || 'Migration'}
            onChange={(e) => handleChange('dbPrefix', e.target.value)}
          />
        </div>
        <div className="input-group">
          <label htmlFor="sql-target-profile">Target Profile</label>
          <select
            id="sql-target-profile"
            className="input-control"
            value={config.targetProfile || 'sql2022'}
            onChange={(e) => handleChange('targetProfile', e.target.value)}
          >
            <option value="sql2016">SQL Server 2016</option>
            <option value="sql2017">SQL Server 2017</option>
            <option value="sql2019">SQL Server 2019</option>
            <option value="sql2022">SQL Server 2022</option>
            <option value="sql2025">SQL Server 2025</option>
            <option value="azureMI">Azure SQL MI</option>
            <option value="azureDB">Azure SQL Database</option>
          </select>
        </div>
      </div>

      <div className="input-group">
        <label htmlFor="sql-backup-dir">Backup Output Directory</label>
        <input
          id="sql-backup-dir"
          type="text"
          className="input-control"
          placeholder="C:\MigrationToSQL\exports"
          value={config.backupDir || ''}
          onChange={(e) => handleChange('backupDir', e.target.value)}
        />
        <span className="helper-text" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
          Path on the SQL Server where the .BAK file will be saved.
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--panel-border)' }}>
        <div className="connection-status" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div 
            className={`connection-dot ${config.isConnected ? 'connected' : 'disconnected'}`} 
            style={{ 
              width: '10px', height: '10px', borderRadius: '50%', 
              background: config.isConnected ? 'var(--success)' : 'var(--error)' 
            }}
          ></div>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: '600' }}>
            {config.isConnected ? 'Connected' : 'Disconnected'}
          </span>
          {config.serverInfo && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginLeft: '0.5rem' }}>
              ({config.serverInfo})
            </span>
          )}
        </div>
        
        <button 
          className="btn btn-secondary" 
          onClick={handleTestConnection}
          disabled={isTesting}
          style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
        >
          {isTesting ? 'Testing...' : 'Test Connection'}
        </button>
      </div>

      {testResult && (
        <div style={{ 
          marginTop: '1rem', 
          padding: '0.75rem', 
          borderRadius: 'var(--radius-sm)', 
          fontSize: '0.85rem',
          background: testResult.success ? 'var(--success-bg)' : 'var(--error-bg)',
          color: testResult.success ? 'var(--success)' : 'var(--error)',
          border: `1px solid ${testResult.success ? 'var(--success-border)' : 'var(--error-border)'}`
        }}>
          {testResult.message}
        </div>
      )}
    </div>
  );
}
