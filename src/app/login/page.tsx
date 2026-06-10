"use client";

import React, { useState } from "react";
import Image from "next/image";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        // Successful login, reload the page which redirects to dashboard via middleware auth guard check
        window.location.href = "/";
      } else {
        setError(data.error || "Invalid credentials. Please try again.");
      }
    } catch (err) {
      console.error("Login request failed:", err);
      setError("Unable to connect to the authentication server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <style>{`
        .login-container {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          background: radial-gradient(circle at top right, rgba(163, 230, 53, 0.08), transparent 45%),
                      radial-gradient(circle at bottom left, rgba(34, 197, 94, 0.05), transparent 40%),
                      #0a0a0a;
          color: #f5f5f5;
          padding: 24px;
          font-family: system-ui, -apple-system, sans-serif;
        }

        .login-card {
          width: 100%;
          max-width: 440px;
          background: rgba(26, 26, 26, 0.65);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.07);
          border-radius: 20px;
          padding: 40px;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5), 0 0 50px rgba(163, 230, 53, 0.02);
          display: flex;
          flex-direction: column;
          align-items: center;
          animation: slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .logo-wrap {
          position: relative;
          width: 68px;
          height: 68px;
          background: #ffffff;
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 24px;
          box-shadow: 0 8px 16px rgba(0, 0, 0, 0.2);
          padding: 6px;
        }

        .logo-img {
          object-fit: contain;
          border-radius: 8px;
        }

        .login-header {
          text-align: center;
          margin-bottom: 32px;
        }

        .login-header h1 {
          font-size: 1.6rem;
          font-weight: 800;
          letter-spacing: -0.025em;
          color: #ffffff;
          margin-bottom: 8px;
        }

        .login-header p {
          font-size: 0.85rem;
          color: #a3a3a3;
        }

        .login-form {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .input-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .input-label {
          font-size: 0.75rem;
          font-weight: 600;
          color: #a3a3a3;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .input-field {
          background: rgba(30, 30, 30, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #ffffff;
          padding: 12px 16px;
          font-size: 0.9rem;
          border-radius: 10px;
          outline: none;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .input-field:focus {
          border-color: #a3e635;
          box-shadow: 0 0 0 3px rgba(163, 230, 53, 0.2);
          background: rgba(35, 35, 35, 0.8);
        }

        .submit-btn {
          background: #a3e635;
          color: #0a0a0a;
          border: none;
          padding: 14px;
          font-size: 0.95rem;
          font-weight: 700;
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          margin-top: 8px;
        }

        .submit-btn:hover:not(:disabled) {
          background: #84cc16;
          transform: translateY(-1px);
          box-shadow: 0 8px 20px rgba(163, 230, 53, 0.25);
        }

        .submit-btn:active:not(:disabled) {
          transform: translateY(0);
        }

        .submit-btn:disabled {
          background: rgba(163, 230, 53, 0.5);
          cursor: not-allowed;
          opacity: 0.7;
        }

        .error-message {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.2);
          color: #f87171;
          font-size: 0.8rem;
          padding: 10px 14px;
          border-radius: 8px;
          width: 100%;
          text-align: center;
          margin-bottom: 16px;
        }

        .spinner {
          width: 18px;
          height: 18px;
          border: 2px solid rgba(10, 10, 10, 0.1);
          border-top: 2px solid #0a0a0a;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>

      <div className="login-card">
        <div className="logo-wrap">
          <Image
            className="logo-img"
            src="/logo.jpeg"
            alt="Susalabs Logo"
            width={56}
            height={56}
            priority
          />
        </div>

        <div className="login-header">
          <h1>Susalabs WFH Tracker</h1>
          <p>Sign in to monitor team machines & settings</p>
        </div>

        {error && <div className="error-message">{error}</div>}

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="input-group">
            <span className="input-label">Email Address</span>
            <input
              type="email"
              className="input-field"
              placeholder="e.g. sameer@susalabs.in"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="input-group">
            <span className="input-label">Password</span>
            <input
              type="password"
              className="input-field"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          <button className="submit-btn" type="submit" disabled={loading}>
            {loading ? (
              <>
                <div className="spinner" />
                <span>Signing in...</span>
              </>
            ) : (
              <span>Sign In</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
