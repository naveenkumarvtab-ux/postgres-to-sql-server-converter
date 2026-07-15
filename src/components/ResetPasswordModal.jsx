import React, { useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import { validatePassword } from '../utils/passwordValidator';

export default function ResetPasswordModal({ resetToken, onClose }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const getPasswordStrength = (pwd) => {
    if (!pwd) return { score: 0, label: 'Empty', color: 'rgba(255,255,255,0.05)' };
    let score = 0;
    if (pwd.length >= 8) score++;
    if (pwd.length >= 12) score++;
    if (/[a-z]/.test(pwd)) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;
    
    let label = 'Weak';
    let color = '#ef4444'; // Red
    if (score >= 5) {
      label = 'Strong';
      color = '#10b981'; // Green
    } else if (score >= 3) {
      label = 'Medium';
      color = '#f59e0b'; // Orange
    }
    
    return { score, label, color };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setError(null);

    if (!password || !confirmPassword) {
      setError('Please fill in all fields.');
      setLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      setLoading(false);
      return;
    }

    const complexityError = validatePassword(password);
    if (complexityError) {
      setError(complexityError);
      setLoading(false);
      return;
    }

    try {
      if (resetToken) {
        // Option 2: Brevo Custom Reset Token Flow using Supabase RPC function
        const { data, error: rpcErr } = await supabase.rpc('reset_password_with_token', {
          token_val: resetToken,
          new_password: password
        });

        if (rpcErr) throw rpcErr;
        if (data === false) {
          throw new Error('Reset link is invalid or has expired.');
        }
      } else {
        // Option 1: Native Supabase Password Recovery Flow
        const { error: updateErr } = await supabase.auth.updateUser({
          password: password
        });

        if (updateErr) throw updateErr;
      }

      setMessage('Password updated successfully! Welcome back.');
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (err) {
      console.error('Password reset error:', err);
      setError(err.message || 'An error occurred while updating your password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-overlay" style={{ zIndex: 1100 }}>
      <div className="auth-modal">
        <div className="auth-header">
          <div className="auth-logo">
            <span className="logo-icon">🔑</span>
            <h2>Change Password</h2>
          </div>
          <p className="auth-subtitle">Choose a new secure password for your account</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit} style={{ marginTop: '1.5rem' }}>
          {error && (
            <div className="auth-alert auth-alert-error">
              <span className="alert-icon">⚠️</span>
              <p>{error}</p>
            </div>
          )}

          {message && (
            <div className="auth-alert auth-alert-success">
              <span className="alert-icon">✓</span>
              <p>{message}</p>
            </div>
          )}

          <div className="input-group">
            <label>New Password</label>
            <input 
              type={showPassword ? 'text' : 'password'} 
              className="input-control"
              placeholder="••••••••" 
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div className="input-group">
            <label>Confirm Password</label>
            <input 
              type={showPassword ? 'text' : 'password'} 
              className="input-control"
              placeholder="••••••••" 
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div className="password-toggle-container" style={{ display: 'flex', alignItems: 'center', marginTop: '-0.25rem', marginBottom: '1rem' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none' }}>
              <input 
                type="checkbox" 
                checked={showPassword} 
                onChange={() => setShowPassword(!showPassword)} 
                disabled={loading}
                style={{ accentColor: 'var(--primary)', cursor: 'pointer' }}
              />
              Show Passwords
            </label>
          </div>

          {password && (() => {
            const strength = getPasswordStrength(password);
            return (
              <div className="password-strength-meter" style={{ marginBottom: '1.25rem', animation: 'fadeIn 0.2s ease-out' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Password Strength:</span>
                  <span style={{ color: strength.color, fontWeight: 'bold' }}>{strength.label}</span>
                </div>
                <div style={{ height: '4px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ 
                    height: '100%', 
                    width: `${(strength.score / 6) * 100}%`, 
                    background: strength.color, 
                    transition: 'width 0.3s ease-in-out' 
                  }}></div>
                </div>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.35rem', lineHeight: '1.4' }}>
                  Requirement: Password must be 12+ characters and satisfy complex security rules.
                </p>
              </div>
            );
          })()}

          <button type="submit" className="btn-primary auth-submit" disabled={loading}>
            {loading ? (
              <span className="loading-spinner"></span>
            ) : (
              'Save New Password'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
