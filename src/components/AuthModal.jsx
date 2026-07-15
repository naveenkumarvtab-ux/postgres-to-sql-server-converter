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
    <div className="auth-overlay">
      <div className="auth-modal">
        <div className="auth-header">
          <div className="auth-logo">
            <span className="logo-icon">🔒</span>
            <h2>TranspileDB</h2>
          </div>
          <p className="auth-subtitle">PostgreSQL to SQL Server Schema Converter</p>
        </div>

        {view !== 'forgot' ? (
          <div className="auth-tabs">
            <button 
              className={`auth-tab ${view === 'login' ? 'active' : ''}`}
              onClick={() => { setView('login'); setError(null); setMessage(null); }}
            >
              Log In
            </button>
            <button 
              className={`auth-tab ${view === 'signup' ? 'active' : ''}`}
              onClick={() => { setView('signup'); setError(null); setMessage(null); }}
            >
              Create Account
            </button>
          </div>
        ) : (
          <div style={{ padding: '0 2rem', marginTop: '1rem', textAlign: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-primary)' }}>Reset Password</h3>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Enter your email to receive a recovery link.
            </p>
          </div>
        )}

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
            <div className="input-group">
              <label>Full Name</label>
              <input 
                type="text" 
                className="input-control"
                placeholder="Enter your name" 
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                disabled={loading}
                required
              />
            </div>
          )}

          <div className="input-group">
            <label>Email Address</label>
            <input 
              type="email" 
              className="input-control"
              placeholder="name@domain.com" 
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          {view !== 'forgot' && (
            <div className="input-group">
              <label>Password</label>
              <input 
                type={showPassword ? 'text' : 'password'} 
                className="input-control"
                placeholder="••••••••" 
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={loading}
                required
              />
              
              <div className="password-toggle-container" style={{ display: 'flex', alignItems: 'center', marginTop: '0.4rem' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none' }}>
                  <input 
                    type="checkbox" 
                    checked={showPassword} 
                    onChange={() => setShowPassword(!showPassword)} 
                    disabled={loading}
                    style={{ accentColor: 'var(--primary)', cursor: 'pointer' }}
                  />
                  Show Password
                </label>
              </div>

              {view === 'signup' && password && (() => {
                const strength = getPasswordStrength(password);
                return (
                  <div className="password-strength-meter" style={{ marginTop: '0.6rem', animation: 'fadeIn 0.2s ease-out' }}>
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
                      Requirement: Passwords should be 12+ characters, containing uppercase/lowercase letters, numbers, and special symbols.
                    </p>
                  </div>
                );
              })()}
            </div>
          )}

          {view === 'login' && (
            <div style={{ textAlign: 'right', marginTop: '-0.5rem', marginBottom: '1rem' }}>
              <button 
                type="button" 
                className="auth-bypass-link" 
                style={{ fontSize: '0.8rem', textDecoration: 'none', background: 'none', border: 'none', cursor: 'pointer' }} 
                onClick={() => { setView('forgot'); setError(null); setMessage(null); }}
              >
                Forgot Password?
              </button>
            </div>
          )}

          <button type="submit" className="btn-primary auth-submit" disabled={loading}>
            {loading ? (
              <span className="loading-spinner"></span>
            ) : (
              view === 'signup' ? 'Sign Up' : view === 'forgot' ? 'Send Reset Link' : 'Log In'
            )}
          </button>

          {view === 'forgot' && (
            <div style={{ textAlign: 'center', marginTop: '1rem' }}>
              <button 
                type="button" 
                className="auth-bypass-link" 
                style={{ fontSize: '0.85rem', textDecoration: 'none', background: 'none', border: 'none', cursor: 'pointer' }} 
                onClick={() => { setView('login'); setError(null); setMessage(null); }}
              >
                ← Back to Log In
              </button>
            </div>
          )}
        </form>

        <div className="auth-footer">
          <p>Or configure database later...</p>
          <button className="auth-bypass-link" onClick={onBypass}>
            Skip Auth (Demo / Offline Mode) →
          </button>
        </div>
      </div>
    </div>
  );
}
