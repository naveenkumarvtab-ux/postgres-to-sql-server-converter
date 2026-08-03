import React, { useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import { validatePassword } from '../utils/passwordValidator';

export default function AuthModal({ onAuthSuccess, onBypass }) {
  const [view, setView] = useState('login'); // login | signup | forgot
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

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

    // Basic validation
    if (!email || (view !== 'forgot' && !password) || (view === 'signup' && !fullName)) {
      setError('Please fill in all required fields.');
      setLoading(false);
      return;
    }

    try {
      if (view === 'forgot') {
        // 1. Generate unique reset token
        const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour expiry

        // 2. Save token to custom Supabase table public.reset_tokens
        const { error: dbErr } = await supabase
          .from('reset_tokens')
          .insert([
            { email, token, expires_at: expiresAt }
          ]);

        if (dbErr) throw dbErr;

        // 3. Send email using direct Brevo HTTP API
        const brevoKey = (import.meta.env.VITE_BREVO_API_KEY || '').replace(/^["']|["']$/g, '');
        const senderEmail = import.meta.env.VITE_BREVO_SENDER_EMAIL || 'your-verified-sender@domain.com';
        const senderName = import.meta.env.VITE_BREVO_SENDER_NAME || 'TranspileDB Support';
        
        if (!brevoKey || brevoKey === 'your_brevo_api_key_here') {
          throw new Error('Brevo API key is not configured in .env file. Please check VITE_BREVO_API_KEY.');
        }

        const resetLink = `${window.location.origin}/?reset_token=${token}`;
        console.log('DEVELOPER DIAGNOSTIC: Reset Password URL is:', resetLink);

        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'accept': 'application/json',
            'api-key': brevoKey,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            sender: { name: senderName, email: senderEmail },
            to: [{ email: email }],
            subject: 'Reset Your TranspileDB Password',
            htmlContent: `
              <div style="font-family: sans-serif; padding: 20px; max-width: 600px; border: 1px solid #eee; border-radius: 8px;">
                <h2>Reset Your Password</h2>
                <p>We received a request to reset your password. Click the button below to update your password:</p>
                <div style="margin: 20px 0;">
                  <a href="${resetLink}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Reset Password</a>
                </div>
                <p style="font-size: 0.85rem; color: #666;">This link will expire in 1 hour. If you did not make this request, you can safely ignore this email.</p>
              </div>
            `
          })
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || 'Failed to send transactional email via Brevo.');
        }

        setMessage('Reset link sent via Brevo! Please check your email inbox.');
        setEmail('');
      } else if (view === 'signup') {
        // Validate password complexity before hitting signup API
        const complexityError = validatePassword(password);
        if (complexityError) {
          throw new Error(complexityError);
        }

        // Sign Up Flow
        const { data, error: signUpErr } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
            }
          }
        });

        if (signUpErr) throw signUpErr;

        if (data.session) {
          setMessage('Account created and logged in successfully!');
          setTimeout(() => onAuthSuccess(data.user), 1500);
        } else {
          setMessage('Registration successful! Please check your email for the confirmation link.');
          setEmail('');
          setPassword('');
          setFullName('');
        }
      } else {
        // Sign In Flow
        const { data, error: signInErr } = await supabase.auth.signInWithPassword({
          email,
          password
        });

        if (signInErr) throw signInErr;

        setMessage('Log in successful! Welcome back.');
        setTimeout(() => onAuthSuccess(data.user), 1000);
      }
    } catch (err) {
      console.error('Auth error:', err);
      setError(err.message || 'An unexpected authentication error occurred.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-split-screen">
      {/* Left Panel */}
      <div className="auth-left-panel">
        <div className="auth-left-brand">
          <span className="auth-brand-icon">🛡️</span>
          <span className="auth-brand-name">VTAB Square</span>
        </div>
        <div className="auth-left-content">
          <h1 className="auth-main-title">
            Enterprise <br/>
            <span className="auth-main-title-glow">Migration Hub</span>
          </h1>
          <p className="auth-main-desc">
            Secure access to the automated database schema to SQL Server conversion engine. Authenticate to continue to your workspace.
          </p>
        </div>
        <div className="auth-left-footer">
          VTAB-AUTH-GATEWAY v2.1
        </div>
      </div>

      {/* Right Panel */}
      <div className="auth-right-panel">
        <div className="auth-right-form-container">
          <div className="auth-right-header">
            <h2>
              {view === 'login' ? 'Welcome back' : view === 'signup' ? 'Create account' : 'Reset password'}
            </h2>
            <p>
              {view === 'login' ? 'Enter your credentials to access your account' : 
               view === 'signup' ? 'Enter your details to create a secure account' : 
               'Enter your email to receive a recovery link'}
            </p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
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

            {view === 'signup' && (
              <div className="auth-input-wrapper">
                <label className="auth-label">Full Name</label>
                <div className="auth-input-field">
                  <span className="auth-input-icon">
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </span>
                  <input 
                    type="text" 
                    placeholder="Enter your name" 
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    disabled={loading}
                    required
                  />
                </div>
              </div>
            )}

            <div className="auth-input-wrapper">
              <label className="auth-label">Email</label>
              <div className="auth-input-field">
                <span className="auth-input-icon">
                  <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                </span>
                <input 
                  type="email" 
                  placeholder="name@domain.com" 
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  disabled={loading}
                  required
                />
              </div>
            </div>

            {view !== 'forgot' && (
              <div className="auth-input-wrapper">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="auth-label">Password</label>
                  {view === 'login' && (
                    <button 
                      type="button" 
                      className="auth-link-btn" 
                      onClick={() => { setView('forgot'); setError(null); setMessage(null); }}
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="auth-input-field">
                  <span className="auth-input-icon">
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                    </svg>
                  </span>
                  <input 
                    type={showPassword ? 'text' : 'password'} 
                    placeholder="••••••••" 
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    disabled={loading}
                    required
                  />
                  <button 
                    type="button" 
                    className="auth-input-toggle-btn"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{ border: 'none', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                  >
                    {showPassword ? (
                      <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
                
                {view === 'signup' && password && (() => {
                  const strength = getPasswordStrength(password);
                  return (
                    <div className="password-strength-meter" style={{ marginTop: '0.6rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Password Strength:</span>
                        <span style={{ color: strength.color, fontWeight: 'bold' }}>{strength.label}</span>
                      </div>
                      <div style={{ height: '4px', background: '#e2e8f0', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{ 
                          height: '100%', 
                          width: `${(strength.score / 6) * 100}%`, 
                          background: strength.color, 
                          transition: 'width 0.3s ease-in-out' 
                        }}></div>
                      </div>
                      <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.35rem', lineHeight: '1.4' }}>
                        Requirement: Passwords should be 12+ characters, containing uppercase/lowercase letters, numbers, and special symbols.
                      </p>
                    </div>
                  );
                })()}
              </div>
            )}

            <button type="submit" className="auth-submit-btn" disabled={loading}>
              {loading ? (
                <span className="loading-spinner"></span>
              ) : (
                <>
                  {view === 'signup' ? 'Sign Up' : view === 'forgot' ? 'Send Reset Link' : 'Sign In'} 
                  <span style={{ marginLeft: '0.5rem' }}>➜</span>
                </>
              )}
            </button>
          </form>

          {/* Switcher links */}
          <div className="auth-switcher-footer">
            {view === 'login' && (
              <p>
                Don't have an account?{' '}
                <button className="auth-switcher-link" onClick={() => { setView('signup'); setError(null); setMessage(null); }}>
                  Create one
                </button>
              </p>
            )}
            {view === 'signup' && (
              <p>
                Already have an account?{' '}
                <button className="auth-switcher-link" onClick={() => { setView('login'); setError(null); setMessage(null); }}>
                  Sign in
                </button>
              </p>
            )}
            {view === 'forgot' && (
              <button className="auth-switcher-link" onClick={() => { setView('login'); setError(null); setMessage(null); }}>
                ← Back to Log In
              </button>
            )}

            <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid #e2e8f0' }}>
              <button className="auth-switcher-link font-medium" onClick={onBypass} style={{ color: 'var(--text-muted)' }}>
                Skip Auth (Demo / Offline Mode) →
              </button>
            </div>
            
            <p className="auth-fine-print">
              By signing in you agree to our <a href="#">Privacy Policy</a>
            </p>
          </div>
        </div>
      </div>

      <style>{`
        .auth-split-screen {
          display: flex;
          min-height: 100vh;
          width: 100vw;
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 99999;
          background: #ffffff;
        }
        
        .auth-left-panel {
          flex: 1;
          background: radial-gradient(circle at center, #1e1b4b 0%, #030712 100%);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 3.5rem;
          color: #ffffff;
          position: relative;
          text-align: left;
        }
        @media (max-width: 900px) {
          .auth-left-panel {
            display: none;
          }
        }
        
        .auth-left-brand {
          display: flex;
          align-items: center;
          gap: 0.6rem;
        }
        .auth-brand-icon {
          font-size: 1.25rem;
          width: 32px;
          height: 32px;
          background: rgba(79, 70, 229, 0.25);
          border: 1px solid rgba(79, 70, 229, 0.4);
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .auth-brand-name {
          font-size: 1.1rem;
          font-weight: 800;
          letter-spacing: -0.01em;
        }
        
        .auth-left-content {
          max-width: 440px;
          margin-top: -4rem;
        }
        .auth-main-title {
          font-size: 3.25rem;
          font-weight: 900;
          line-height: 1.15;
          letter-spacing: -0.02em;
          margin-bottom: 1.25rem;
        }
        .auth-main-title-glow {
          background: linear-gradient(135deg, #a5b4fc 0%, #6366f1 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .auth-main-desc {
          font-size: 0.95rem;
          line-height: 1.6;
          color: #cbd5e1;
        }
        
        .auth-left-footer {
          font-family: var(--font-mono);
          font-size: 0.75rem;
          color: #64748b;
          letter-spacing: 0.05em;
        }
        
        .auth-right-panel {
          width: 50vw;
          background: #ffffff;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 3rem;
        }
        @media (max-width: 900px) {
          .auth-right-panel {
            width: 100vw;
          }
        }
        
        .auth-right-form-container {
          width: 100%;
          max-width: 400px;
          display: flex;
          flex-direction: column;
          gap: 1.75rem;
        }
        
        .auth-right-header h2 {
          font-size: 1.85rem;
          font-weight: 800;
          color: #0f172a;
          margin-bottom: 0.4rem;
        }
        .auth-right-header p {
          font-size: 0.9rem;
          color: #64748b;
        }
        
        .auth-input-wrapper {
          display: flex;
          flex-direction: column;
          gap: 0.45rem;
          margin-bottom: 1rem;
          text-align: left;
        }
        .auth-label {
          font-size: 0.85rem;
          font-weight: 700;
          color: #475569;
        }
        .auth-input-field {
          position: relative;
          display: flex;
          align-items: center;
        }
        .auth-input-icon {
          position: absolute;
          left: 14px;
          color: #94a3b8;
          font-size: 0.95rem;
          pointer-events: none;
        }
        .auth-input-field input {
          width: 100%;
          background: #eef2f6;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 0.85rem 1rem 0.85rem 2.5rem;
          font-family: var(--font-sans);
          font-size: 0.9rem;
          color: #0f172a;
          transition: all var(--transition-fast);
        }
        .auth-input-field input:focus {
          outline: none;
          background: #ffffff;
          border-color: var(--primary);
          box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.15);
        }
        
        .auth-input-toggle-btn {
          position: absolute;
          right: 14px;
          background: transparent;
          border: none;
          cursor: pointer;
          font-size: 0.95rem;
          color: #94a3b8;
        }
        .auth-input-toggle-btn:hover {
          color: #475569;
        }
        
        .auth-link-btn {
          background: transparent;
          border: none;
          color: var(--primary);
          font-size: 0.82rem;
          font-weight: 700;
          cursor: pointer;
          text-decoration: none;
        }
        .auth-link-btn:hover {
          text-decoration: underline;
        }
        
        .auth-submit-btn {
          width: 100%;
          background: var(--primary);
          color: #ffffff;
          border: none;
          border-radius: 8px;
          padding: 0.9rem;
          font-family: var(--font-sans);
          font-weight: 700;
          font-size: 0.95rem;
          cursor: pointer;
          transition: all var(--transition-fast);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 14px rgba(79, 70, 229, 0.25);
        }
        .auth-submit-btn:hover:not(:disabled) {
          background: var(--primary-hover);
          transform: translateY(-1px);
        }
        .auth-submit-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        
        .auth-switcher-footer {
          text-align: center;
          font-size: 0.85rem;
          color: #64748b;
        }
        .auth-switcher-link {
          background: transparent;
          border: none;
          color: var(--primary);
          font-weight: 700;
          cursor: pointer;
          font-size: 0.85rem;
        }
        .auth-switcher-link:hover {
          text-decoration: underline;
        }
        .auth-fine-print {
          font-size: 0.72rem;
          color: #94a3b8;
          margin-top: 1.5rem;
        }
        .auth-fine-print a {
          color: #64748b;
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
}
