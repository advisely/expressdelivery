import { useState, useEffect, useRef } from 'react';
import { Mail, ChevronRight, ChevronLeft, Eye, EyeOff, Server } from 'lucide-react';
import { PROVIDER_PRESETS } from '../lib/providerPresets';
import type { ProviderPreset } from '../lib/providerPresets';
import { getProviderIcon } from '../lib/providerIcons';
import { ipcInvoke } from '../lib/ipc';
import { useEmailStore } from '../stores/emailStore';

interface OnboardingScreenProps {
    onAccountAdded: () => void;
}

const STEPS = ['welcome', 'provider', 'credentials', 'server'] as const;
type Step = typeof STEPS[number];

const PROVIDER_ACCENTS: Record<string, string> = {
    gmail:   '#EA4335',
    outlook: '#0078D4',
    yahoo:   '#6001D2',
    icloud:  '#007AFF',
    custom:  'var(--accent-color)',
};

export const OnboardingScreen: React.FC<OnboardingScreenProps> = ({ onAccountAdded }) => {
    const [step, setStep] = useState<Step>('welcome');
    const [selectedPreset, setSelectedPreset] = useState<ProviderPreset | null>(null);
    const [email, setEmail] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [imapHost, setImapHost] = useState('');
    const [imapPort, setImapPort] = useState(993);
    const [smtpHost, setSmtpHost] = useState('');
    const [smtpPort, setSmtpPort] = useState(465);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'passed' | 'failed'>('idle');
    const [errorKey, setErrorKey] = useState(0);
    const addAccount = useEmailStore(s => s.addAccount);
    const errorRef = useRef(0);

    // Clear sensitive state on unmount
    useEffect(() => {
        return () => { setPassword(''); };
    }, []);

    const showError = (msg: string) => {
        errorRef.current += 1;
        setErrorKey(errorRef.current);
        setError(msg);
    };

    const selectProvider = (preset: ProviderPreset) => {
        setSelectedPreset(preset);
        setImapHost(preset.imapHost);
        setImapPort(preset.imapPort);
        setSmtpHost(preset.smtpHost);
        setSmtpPort(preset.smtpPort);
        setError(null);
        setTestStatus('idle');
        setStep('credentials');
    };

    const handleSubmit = async () => {
        if (email.trim().length === 0) { showError('Email address is required'); return; }
        if (password.trim().length === 0) { showError('Password is required'); return; }
        const finalImapHost = imapHost || selectedPreset?.imapHost || '';
        const finalSmtpHost = smtpHost || selectedPreset?.smtpHost || '';
        if (finalImapHost.length === 0 || finalSmtpHost.length === 0) { showError('IMAP and SMTP server addresses are required'); return; }

        setSaving(true);
        setError(null);
        setTestStatus('testing');

        // Test connection before persisting account credentials
        const testResult = await ipcInvoke<{ success: boolean; error?: string }>('accounts:test', {
            email: email.trim(),
            password,
            imap_host: finalImapHost,
            imap_port: imapPort,
        });

        if (!testResult?.success) {
            setTestStatus('failed');
            showError(`Connection failed: ${testResult?.error ?? 'Unknown error'}`);
            setSaving(false);
            return;
        }

        setTestStatus('passed');

        try {
            const result = await ipcInvoke<{ id: string }>('accounts:add', {
                email: email.trim(),
                provider: selectedPreset?.id ?? 'custom',
                password,
                display_name: displayName.trim() || null,
                imap_host: finalImapHost,
                imap_port: imapPort,
                smtp_host: finalSmtpHost,
                smtp_port: smtpPort,
            });
            if (result?.id) {
                addAccount({
                    id: result.id,
                    email: email.trim(),
                    provider: selectedPreset?.id ?? 'custom',
                    display_name: displayName.trim() || null,
                    imap_host: finalImapHost,
                    imap_port: imapPort,
                    smtp_host: finalSmtpHost,
                    smtp_port: smtpPort,
                    signature_html: null,
                });
                onAccountAdded();
            }
        } catch {
            showError('Failed to add account. Please check your details.');
        } finally {
            setSaving(false);
        }
    };

    const handleCredentialsNext = () => {
        if (email.trim().length === 0) { showError('Email address is required'); return; }
        if (password.trim().length === 0) { showError('Password is required'); return; }
        setError(null);
        if (selectedPreset?.id === 'custom') {
            setStep('server');
        } else {
            handleSubmit();
        }
    };

    const stepIndex = STEPS.indexOf(step);

    return (
        <div className="ob-container">
            {/* Animated background shapes */}
            <div className="ob-shape ob-shape-1" aria-hidden="true" />
            <div className="ob-shape ob-shape-2" aria-hidden="true" />
            <div className="ob-shape ob-shape-3" aria-hidden="true" />
            <div className="ob-shape ob-shape-4" aria-hidden="true" />

            <div className="ob-card animate-fade-in">

                {/* Step progress dots */}
                <div className="ob-step-dots" role="progressbar" aria-valuemin={1} aria-valuenow={stepIndex + 1} aria-valuemax={STEPS.length} aria-label="Setup progress">
                    {STEPS.map((s, i) => (
                        <span
                            key={s}
                            className={`ob-dot${i === stepIndex ? ' ob-dot-active' : ''}${i < stepIndex ? ' ob-dot-done' : ''}`}
                        />
                    ))}
                </div>

                {/* ---- Welcome ---- */}
                {step === 'welcome' && (
                    <div className="ob-step">
                        <div className="ob-mail-icon-wrap">
                            <div className="ob-mail-glow" aria-hidden="true" />
                            <div className="ob-mail-icon">
                                <Mail size={44} strokeWidth={1.5} />
                            </div>
                        </div>
                        <h1 className="ob-title ob-gradient-text">Welcome to ExpressDelivery</h1>
                        <p className="ob-subtitle">
                            Your AI-powered email client. Connect your email account to get started.
                        </p>
                        <button className="ob-primary-btn ob-shimmer-btn" onClick={() => setStep('provider')}>
                            <span>Get Started</span>
                            <ChevronRight size={18} />
                        </button>
                    </div>
                )}

                {/* ---- Provider ---- */}
                {step === 'provider' && (
                    <div className="ob-step">
                        <h2 className="ob-step-title">Choose your provider</h2>
                        <p className="ob-step-subtitle">Select your provider for automatic server configuration</p>
                        <div className="ob-divider" aria-hidden="true" />
                        <div className="ob-provider-grid">
                            {PROVIDER_PRESETS.map((preset, i) => {
                                const accent = PROVIDER_ACCENTS[preset.id] ?? 'var(--accent-color)';
                                const ProviderIcon = getProviderIcon(preset.id);
                                return (
                                    <button
                                        key={preset.id}
                                        className="ob-provider-card"
                                        style={{
                                            '--provider-accent': accent,
                                            '--stagger': i,
                                        } as React.CSSProperties}
                                        onClick={() => selectProvider(preset)}
                                    >
                                        <span className="ob-provider-accent-bar" aria-hidden="true" />
                                        <span className="ob-provider-icon-wrap" aria-hidden="true">
                                            <ProviderIcon size={28} />
                                        </span>
                                        <span className="ob-provider-content">
                                            <span className="ob-provider-label">{preset.label}</span>
                                            {preset.notes && (
                                                <span className="ob-provider-notes">{preset.notes}</span>
                                            )}
                                        </span>
                                        <ChevronRight size={14} className="ob-provider-arrow" />
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* ---- Credentials ---- */}
                {step === 'credentials' && (
                    <div className="ob-step ob-step-left">
                        <h2 className="ob-step-title">Account details</h2>
                        <p className="ob-step-subtitle">
                            {selectedPreset?.id !== 'custom'
                                ? `Connecting to ${selectedPreset?.label}`
                                : 'Enter your account credentials'}
                        </p>

                        {error && (
                            <div key={errorKey} className="ob-error" role="alert">
                                {error}
                            </div>
                        )}

                        <div className="ob-form-group">
                            <label className="ob-label" htmlFor="ob-email">Email Address</label>
                            <input
                                id="ob-email"
                                type="email"
                                className="ob-input"
                                placeholder="you@example.com"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                autoFocus
                            />
                        </div>

                        <div className="ob-form-group">
                            <label className="ob-label" htmlFor="ob-display-name">
                                Display Name <span className="ob-label-optional">(optional)</span>
                            </label>
                            <input
                                id="ob-display-name"
                                type="text"
                                className="ob-input"
                                placeholder="John Doe"
                                value={displayName}
                                onChange={e => setDisplayName(e.target.value)}
                            />
                        </div>

                        <div className="ob-form-group">
                            <label className="ob-label" htmlFor="ob-password">Password</label>
                            <div className="ob-password-wrap">
                                <input
                                    id="ob-password"
                                    type={showPassword ? 'text' : 'password'}
                                    className="ob-input"
                                    placeholder={selectedPreset?.notes ? 'App Password recommended' : 'Password'}
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                />
                                <button
                                    className="ob-pw-toggle"
                                    onClick={() => setShowPassword(!showPassword)}
                                    type="button"
                                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                                >
                                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                        </div>

                        <div className="ob-actions">
                            <button className="ob-secondary-btn" onClick={() => setStep('provider')}>
                                <ChevronLeft size={16} />
                                <span>Back</span>
                            </button>
                            <button className="ob-primary-btn ob-shimmer-btn" onClick={handleCredentialsNext} disabled={saving}>
                                <span>{saving ? (testStatus === 'testing' ? 'Testing connection...' : 'Connecting...') : selectedPreset?.id === 'custom' ? 'Next' : 'Connect'}</span>
                                <ChevronRight size={18} />
                            </button>
                        </div>
                    </div>
                )}

                {/* ---- Server ---- */}
                {step === 'server' && (
                    <div className="ob-step ob-step-left">
                        <h2 className="ob-step-title">Server settings</h2>
                        <p className="ob-step-subtitle">Configure your IMAP and SMTP servers</p>

                        {error && (
                            <div key={errorKey} className="ob-error" role="alert">
                                {error}
                            </div>
                        )}

                        <div className="ob-server-card">
                            <h3 className="ob-server-heading">
                                <Server size={14} />
                                Incoming Mail (IMAP)
                            </h3>
                            <div className="ob-form-row">
                                <div className="ob-form-group">
                                    <label className="ob-label" htmlFor="ob-imap-host">Host</label>
                                    <input
                                        id="ob-imap-host"
                                        type="text"
                                        className="ob-input"
                                        placeholder="imap.example.com"
                                        value={imapHost}
                                        onChange={e => setImapHost(e.target.value)}
                                    />
                                </div>
                                <div className="ob-form-group ob-port-group">
                                    <label className="ob-label" htmlFor="ob-imap-port">Port</label>
                                    <input
                                        id="ob-imap-port"
                                        type="number"
                                        className="ob-input"
                                        min={1}
                                        max={65535}
                                        value={imapPort}
                                        onChange={e => setImapPort(Number(e.target.value))}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="ob-server-card">
                            <h3 className="ob-server-heading">
                                <Server size={14} />
                                Outgoing Mail (SMTP)
                            </h3>
                            <div className="ob-form-row">
                                <div className="ob-form-group">
                                    <label className="ob-label" htmlFor="ob-smtp-host">Host</label>
                                    <input
                                        id="ob-smtp-host"
                                        type="text"
                                        className="ob-input"
                                        placeholder="smtp.example.com"
                                        value={smtpHost}
                                        onChange={e => setSmtpHost(e.target.value)}
                                    />
                                </div>
                                <div className="ob-form-group ob-port-group">
                                    <label className="ob-label" htmlFor="ob-smtp-port">Port</label>
                                    <input
                                        id="ob-smtp-port"
                                        type="number"
                                        className="ob-input"
                                        min={1}
                                        max={65535}
                                        value={smtpPort}
                                        onChange={e => setSmtpPort(Number(e.target.value))}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="ob-actions">
                            <button className="ob-secondary-btn" onClick={() => setStep('credentials')}>
                                <ChevronLeft size={16} />
                                <span>Back</span>
                            </button>
                            <button className="ob-primary-btn ob-shimmer-btn" onClick={handleSubmit} disabled={saving}>
                                <span>{saving ? (testStatus === 'testing' ? 'Testing connection...' : 'Connecting...') : 'Connect'}</span>
                                <ChevronRight size={18} />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <style>{`
                /* =========================================================
                   KEYFRAME ANIMATIONS
                ========================================================= */

                @keyframes ob-float {
                    0%, 100% { transform: translateY(0px) rotate(0deg); }
                    33%      { transform: translateY(-18px) rotate(3deg); }
                    66%      { transform: translateY(-10px) rotate(-2deg); }
                }

                @keyframes ob-float-slow {
                    0%, 100% { transform: translateY(0px) rotate(0deg); }
                    50%      { transform: translateY(-24px) rotate(-4deg); }
                }

                @keyframes ob-shimmer {
                    0%   { transform: translateX(-120%); }
                    100% { transform: translateX(220%); }
                }

                @keyframes ob-jiggle {
                    0%   { transform: rotate(0deg) scale(1); }
                    20%  { transform: rotate(-2deg) scale(1.03); }
                    40%  { transform: rotate(2deg) scale(1.03); }
                    60%  { transform: rotate(-1deg) scale(1.02); }
                    80%  { transform: rotate(1deg) scale(1.02); }
                    100% { transform: rotate(0deg) scale(1); }
                }

                @keyframes ob-pulse-glow {
                    0%, 100% {
                        box-shadow:
                            0 4px 20px rgba(var(--color-accent), 0.4),
                            0 0 0 0 rgba(var(--color-accent), 0.4),
                            0 1px 4px rgba(0, 0, 0, 0.12);
                        transform: scale(1);
                    }
                    50% {
                        box-shadow:
                            0 4px 20px rgba(var(--color-accent), 0.5),
                            0 0 0 14px rgba(var(--color-accent), 0),
                            0 1px 4px rgba(0, 0, 0, 0.12);
                        transform: scale(1.04);
                    }
                }

                @keyframes ob-gradient-shift {
                    0%   { background-position: 0% 50%; }
                    50%  { background-position: 100% 50%; }
                    100% { background-position: 0% 50%; }
                }

                @keyframes ob-shake {
                    0%, 100% { transform: translateX(0); }
                    15%      { transform: translateX(-6px); }
                    30%      { transform: translateX(6px); }
                    45%      { transform: translateX(-4px); }
                    60%      { transform: translateX(4px); }
                    75%      { transform: translateX(-2px); }
                    90%      { transform: translateX(2px); }
                }

                @keyframes ob-stagger-in {
                    from { opacity: 0; transform: translateY(14px); }
                    to   { opacity: 1; transform: translateY(0); }
                }

                @keyframes ob-glow-ring {
                    0%, 100% { opacity: 0.6; transform: scale(1); }
                    50%      { opacity: 0; transform: scale(1.85); }
                }

                /* =========================================================
                   CONTAINER & ANIMATED BACKGROUND
                ========================================================= */

                .ob-container {
                    position: relative;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 100%;
                    height: 100vh;
                    overflow: hidden;
                    background: linear-gradient(
                        135deg,
                        var(--bg-secondary) 0%,
                        var(--bg-tertiary) 40%,
                        var(--bg-secondary) 70%,
                        var(--bg-primary) 100%
                    );
                    background-size: 300% 300%;
                    animation: ob-gradient-shift 14s ease infinite;
                    will-change: background-position;
                }

                .ob-shape {
                    position: absolute;
                    pointer-events: none;
                    z-index: 0;
                    background: var(--accent-color);
                }

                .ob-shape-1 {
                    width: 400px;
                    height: 400px;
                    top: -100px;
                    left: -120px;
                    border-radius: 40% 60% 55% 45% / 50% 45% 55% 50%;
                    animation: ob-float-slow 18s ease-in-out infinite;
                    opacity: 0.07;
                }

                .ob-shape-2 {
                    width: 280px;
                    height: 280px;
                    bottom: -70px;
                    right: -80px;
                    border-radius: 30% 70% 60% 40% / 45% 55% 45% 55%;
                    animation: ob-float 14s ease-in-out infinite;
                    animation-delay: -5s;
                    opacity: 0.06;
                }

                .ob-shape-3 {
                    width: 170px;
                    height: 170px;
                    top: 14%;
                    right: 10%;
                    border-radius: 60% 40% 50% 50% / 40% 60% 40% 60%;
                    animation: ob-float-slow 20s ease-in-out infinite;
                    animation-delay: -8s;
                    opacity: 0.05;
                }

                .ob-shape-4 {
                    width: 110px;
                    height: 110px;
                    bottom: 18%;
                    left: 7%;
                    border-radius: 50%;
                    animation: ob-float 12s ease-in-out infinite;
                    animation-delay: -3s;
                    opacity: 0.055;
                }

                /* =========================================================
                   CARD
                ========================================================= */

                .ob-card {
                    position: relative;
                    z-index: 1;
                    width: 560px;
                    max-width: 92vw;
                    border-radius: 20px;
                    padding: 44px 48px 40px;
                    border: 1px solid var(--glass-border);
                    box-shadow:
                        0 8px 32px rgba(0, 0, 0, 0.08),
                        0 2px 8px rgba(0, 0, 0, 0.05),
                        inset 0 1px 0 rgba(255, 255, 255, 0.06);
                    backdrop-filter: blur(24px);
                    -webkit-backdrop-filter: blur(24px);
                }

                /* =========================================================
                   PROGRESS DOTS
                ========================================================= */

                .ob-step-dots {
                    display: flex;
                    justify-content: center;
                    gap: 8px;
                    margin-bottom: 32px;
                }

                .ob-dot {
                    display: inline-block;
                    width: 8px;
                    height: 8px;
                    border-radius: 4px;
                    background: var(--glass-border);
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                }

                .ob-dot-done {
                    background: rgba(var(--color-accent), 0.45);
                }

                .ob-dot-active {
                    background: var(--accent-color);
                    width: 24px;
                    box-shadow: 0 0 8px rgba(var(--color-accent), 0.5);
                }

                /* =========================================================
                   STEP LAYOUT
                ========================================================= */

                .ob-step {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    text-align: center;
                }

                .ob-step-left {
                    align-items: flex-start;
                    text-align: left;
                }

                .ob-mail-icon-wrap {
                    position: relative;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin-bottom: 28px;
                    width: 96px;
                    height: 96px;
                }

                .ob-mail-glow {
                    position: absolute;
                    inset: 0;
                    border-radius: 24px;
                    background: rgba(var(--color-accent), 0.28);
                    animation: ob-glow-ring 2.4s ease-in-out infinite;
                }

                .ob-mail-icon {
                    position: relative; z-index: 1;
                    width: 80px; height: 80px;
                    border-radius: 20px;
                    background: var(--accent-color);
                    color: white;
                    display: flex; align-items: center; justify-content: center;
                    box-shadow: 0 4px 20px rgba(var(--color-accent), 0.4), 0 1px 4px rgba(0, 0, 0, 0.12);
                    animation: ob-pulse-glow 3s ease-in-out infinite;
                }

                .ob-title {
                    font-size: 30px; font-weight: 700;
                    margin-bottom: 12px; letter-spacing: -0.5px; line-height: 1.2;
                }

                .ob-gradient-text {
                    background: linear-gradient(135deg, var(--text-primary) 0%, var(--accent-color) 55%, var(--text-primary) 100%);
                    background-size: 200% auto;
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    background-clip: text;
                    animation: ob-gradient-shift 6s linear infinite;
                }

                .ob-subtitle {
                    font-size: 15px; color: var(--text-secondary);
                    margin-bottom: 36px; max-width: 360px; line-height: 1.6;
                }

                .ob-step-title { font-size: 24px; font-weight: 700; color: var(--text-primary); margin-bottom: 6px; letter-spacing: -0.3px; align-self: flex-start; }
                .ob-step-subtitle { font-size: 14px; color: var(--text-secondary); margin-bottom: 20px; line-height: 1.5; align-self: flex-start; }

                .ob-divider {
                    width: 100%; height: 1px;
                    background: linear-gradient(90deg, transparent, var(--glass-border), rgba(var(--color-accent), 0.3), var(--glass-border), transparent);
                    margin-bottom: 24px;
                }

                .ob-provider-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; width: 100%; }

                .ob-provider-card {
                    position: relative; display: flex; align-items: center; padding: 0;
                    border-radius: 14px; border: 1px solid var(--glass-border);
                    background: var(--glass-bg); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
                    color: var(--text-primary); text-align: left; overflow: hidden;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.06);
                    transition: box-shadow 0.28s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.28s ease, transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
                    opacity: 0;
                    animation: ob-stagger-in 0.45s cubic-bezier(0.4, 0, 0.2, 1) forwards;
                    animation-delay: calc(var(--stagger, 0) * 75ms + 50ms);
                    transform-origin: center;
                }

                .ob-provider-card:hover {
                    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15), 0 4px 12px rgba(0, 0, 0, 0.10);
                    border-color: var(--provider-accent, var(--accent-color));
                    transform: scale(1.02) rotate(-0.5deg);
                }

                .ob-provider-accent-bar { display: block; width: 5px; min-width: 5px; align-self: stretch; background: var(--provider-accent, var(--accent-color)); flex-shrink: 0; transition: width 0.2s ease; }
                .ob-provider-card:hover .ob-provider-accent-bar { width: 6px; min-width: 6px; }

                .ob-provider-icon-wrap {
                    width: 40px;
                    height: 40px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 10px;
                    background: rgba(var(--color-bg-primary), 0.5);
                    flex-shrink: 0;
                    margin-left: 14px;
                }

                .ob-provider-content { display: flex; flex-direction: column; gap: 4px; padding: 16px 10px 16px 14px; flex: 1; min-width: 0; }
                .ob-provider-label { font-weight: 600; font-size: 14px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .ob-provider-notes { font-size: 11px; color: var(--text-muted); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
                .ob-provider-arrow { color: var(--text-muted); margin-right: 12px; flex-shrink: 0; transition: color 0.2s, transform 0.2s; }
                .ob-provider-card:hover .ob-provider-arrow { color: var(--provider-accent, var(--accent-color)); transform: translateX(2px); }

                /* ========= FORM ELEMENTS ========= */

                .ob-form-group { width: 100%; margin-bottom: 16px; }
                .ob-port-group { width: 100px; flex-shrink: 0; }
                .ob-label { display: block; font-size: 13px; font-weight: 500; color: var(--text-secondary); margin-bottom: 7px; transition: color 0.2s; }
                .ob-label-optional { font-weight: 400; color: var(--text-muted); font-size: 12px; }
                .ob-form-group:focus-within .ob-label { color: var(--accent-color); }
                .ob-input { width: 100%; padding: 10px 14px; border-radius: 10px; border: 1.5px solid var(--glass-border); background: rgba(var(--color-bg-primary), 0.7); color: var(--text-primary); font-family: inherit; font-size: 14px; outline: none; transition: border-color 0.22s ease, box-shadow 0.22s ease; box-sizing: border-box; }
                .ob-input:focus { border-color: rgba(var(--color-accent), 0.8); box-shadow: 0 0 0 3px rgba(var(--color-accent), 0.14), 0 1px 4px rgba(0, 0, 0, 0.06); }
                .ob-input::placeholder { color: var(--text-muted); }
                .ob-error { width: 100%; padding: 10px 14px; border-radius: 10px; background: rgba(var(--color-danger), 0.1); border: 1px solid rgba(var(--color-danger), 0.25); color: rgb(var(--color-danger)); font-size: 13px; margin-bottom: 16px; text-align: left; animation: ob-shake 0.42s cubic-bezier(0.36, 0.07, 0.19, 0.97) both; box-sizing: border-box; }
                .ob-password-wrap { position: relative; }
                .ob-password-wrap .ob-input { padding-right: 42px; }
                .ob-pw-toggle { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); color: var(--text-muted); padding: 4px; border-radius: 4px; transition: color 0.2s; }
                .ob-pw-toggle:hover { color: var(--text-primary); }

                /* ========= SERVER CARDS ========= */

                .ob-server-card { width: 100%; margin-bottom: 16px; padding: 18px 20px 14px; border-radius: 14px; border: 1px solid var(--glass-border); background: rgba(var(--color-bg-primary), 0.55); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04); transition: box-shadow 0.25s ease, border-color 0.25s ease; box-sizing: border-box; }
                .ob-server-card:focus-within { box-shadow: 0 4px 20px rgba(var(--color-accent), 0.08), 0 1px 4px rgba(0, 0, 0, 0.06); border-color: rgba(var(--color-accent), 0.3); }
                .ob-server-heading { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 14px; }
                .ob-form-row { display: flex; gap: 12px; }
                .ob-form-row .ob-form-group:first-child { flex: 1; margin-bottom: 0; }
                .ob-form-row .ob-port-group { margin-bottom: 0; }

                /* ========= BUTTONS ========= */

                .ob-actions { display: flex; justify-content: space-between; width: 100%; margin-top: 8px; gap: 12px; }
                .ob-primary-btn { position: relative; overflow: hidden; background: var(--accent-color); color: white; padding: 11px 26px; border-radius: 10px; font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 14px rgba(var(--color-accent), 0.35), 0 1px 3px rgba(0, 0, 0, 0.10); transition: background 0.2s ease, box-shadow 0.25s ease, transform 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
                .ob-primary-btn:hover:not(:disabled) { background: var(--accent-hover); box-shadow: 0 6px 20px rgba(var(--color-accent), 0.45), 0 2px 6px rgba(0, 0, 0, 0.12); transform: scale(1.03) rotate(-0.5deg); }
                .ob-primary-btn:disabled { opacity: 0.6; cursor: not-allowed; }
                .ob-shimmer-btn::after { content: ''; position: absolute; top: 0; left: 0; width: 50%; height: 100%; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.28), transparent); transform: translateX(-120%); animation: ob-shimmer 3.2s ease-in-out infinite; animation-delay: 1.4s; pointer-events: none; }
                .ob-secondary-btn { background: var(--surface-inset); color: var(--text-primary); padding: 11px 20px; border-radius: 10px; font-weight: 500; font-size: 14px; display: flex; align-items: center; gap: 8px; border: 1px solid var(--glass-border); transition: background 0.2s ease, box-shadow 0.2s ease, transform 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
                .ob-secondary-btn:hover { background: var(--close-hover-bg); box-shadow: 0 2px 8px rgba(0,0,0,0.06); transform: scale(1.02); }
                .ob-step:not(.ob-step-left) .ob-primary-btn { margin: 0 auto; }

                /* ========= REDUCED MOTION (WCAG 2.1 SC 2.3.3) ========= */

                @media (prefers-reduced-motion: reduce) {
                    .ob-container,
                    .ob-gradient-text { animation: none; }
                    .ob-shape { animation: none; }
                    .ob-mail-glow,
                    .ob-mail-icon { animation: none; }
                    .ob-shimmer-btn::after { display: none; }
                    .ob-provider-card { animation: none; opacity: 1; }
                    .ob-provider-card:hover,
                    .ob-primary-btn:hover:not(:disabled),
                    .ob-secondary-btn:hover { transform: none; }
                    .ob-error { animation: none; }
                }
`}
            </style>
        </div>
    );
};