import { useState, useEffect, useRef } from 'react';
import { Mail, ChevronRight, ChevronLeft, Eye, EyeOff, Server } from 'lucide-react';
import { PROVIDER_PRESETS } from '../lib/providerPresets';
import type { ProviderPreset } from '../lib/providerPresets';
import { getProviderIcon } from '../lib/providerIcons';
import { useTranslation } from 'react-i18next';
import { ipcInvoke } from '../lib/ipc';
import { useEmailStore } from '../stores/emailStore';
import styles from './OnboardingScreen.module.css';

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
    const { t } = useTranslation();
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
        if (email.trim().length === 0) { showError(t('onboarding.emailRequired')); return; }
        if (password.trim().length === 0) { showError(t('onboarding.passwordRequired')); return; }
        const finalImapHost = imapHost || selectedPreset?.imapHost || '';
        const finalSmtpHost = smtpHost || selectedPreset?.smtpHost || '';
        if (finalImapHost.length === 0 || finalSmtpHost.length === 0) { showError(t('onboarding.serverRequired')); return; }

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
            showError(t('onboarding.connectionFailed', { error: testResult?.error ?? 'Unknown error' }));
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
            showError(t('onboarding.addFailed'));
        } finally {
            setSaving(false);
        }
    };

    const handleCredentialsNext = () => {
        if (email.trim().length === 0) { showError(t('onboarding.emailRequired')); return; }
        if (password.trim().length === 0) { showError(t('onboarding.passwordRequired')); return; }
        setError(null);
        if (selectedPreset?.id === 'custom') {
            setStep('server');
        } else {
            handleSubmit();
        }
    };

    const stepIndex = STEPS.indexOf(step);

    return (
        <div className={styles['ob-container']}>
            {/* Animated background shapes */}
            <div className={`${styles['ob-shape']} ${styles['ob-shape-1']}`} aria-hidden="true" />
            <div className={`${styles['ob-shape']} ${styles['ob-shape-2']}`} aria-hidden="true" />
            <div className={`${styles['ob-shape']} ${styles['ob-shape-3']}`} aria-hidden="true" />
            <div className={`${styles['ob-shape']} ${styles['ob-shape-4']}`} aria-hidden="true" />

            <div className={`${styles['ob-card']} animate-fade-in`}>

                {/* Step progress dots */}
                <div className={styles['ob-step-dots']} role="progressbar" aria-valuemin={1} aria-valuenow={stepIndex + 1} aria-valuemax={STEPS.length} aria-label="Setup progress">
                    {STEPS.map((s, i) => (
                        <span
                            key={s}
                            className={[
                                styles['ob-dot'],
                                i === stepIndex ? styles['ob-dot-active'] : '',
                                i < stepIndex ? styles['ob-dot-done'] : '',
                            ].filter(Boolean).join(' ')}
                        />
                    ))}
                </div>

                {/* ---- Welcome ---- */}
                {step === 'welcome' && (
                    <div className={styles['ob-step']}>
                        <div className={styles['ob-mail-icon-wrap']}>
                            <div className={styles['ob-mail-glow']} aria-hidden="true" />
                            <div className={styles['ob-mail-icon']}>
                                <Mail size={44} strokeWidth={1.5} />
                            </div>
                        </div>
                        <h1 className={`${styles['ob-title']} ${styles['ob-gradient-text']}`}>{t('onboarding.welcome')}</h1>
                        <p className={styles['ob-subtitle']}>
                            {t('onboarding.description')}
                        </p>
                        <button className={`${styles['ob-primary-btn']} ${styles['ob-shimmer-btn']}`} onClick={() => setStep('provider')}>
                            <span>{t('onboarding.getStarted')}</span>
                            <ChevronRight size={18} />
                        </button>
                    </div>
                )}

                {/* ---- Provider ---- */}
                {step === 'provider' && (
                    <div className={styles['ob-step']}>
                        <h2 className={styles['ob-step-title']}>{t('onboarding.chooseProvider')}</h2>
                        <p className={styles['ob-step-subtitle']}>{t('onboarding.providerSubtitle')}</p>
                        <div className={styles['ob-divider']} aria-hidden="true" />
                        <div className={styles['ob-provider-grid']}>
                            {PROVIDER_PRESETS.map((preset, i) => {
                                const accent = PROVIDER_ACCENTS[preset.id] ?? 'var(--accent-color)';
                                const ProviderIcon = getProviderIcon(preset.id);
                                return (
                                    <button
                                        key={preset.id}
                                        className={styles['ob-provider-card']}
                                        style={{
                                            '--provider-accent': accent,
                                            '--stagger': i,
                                        } as React.CSSProperties}
                                        onClick={() => selectProvider(preset)}
                                    >
                                        <span className={styles['ob-provider-accent-bar']} aria-hidden="true" />
                                        <span className={styles['ob-provider-icon-wrap']} aria-hidden="true">
                                            <ProviderIcon size={28} />
                                        </span>
                                        <span className={styles['ob-provider-content']}>
                                            <span className={styles['ob-provider-label']}>{preset.label}</span>
                                            {preset.notes && (
                                                <span className={styles['ob-provider-notes']}>{preset.notes}</span>
                                            )}
                                        </span>
                                        <ChevronRight size={14} className={styles['ob-provider-arrow']} />
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* ---- Credentials ---- */}
                {step === 'credentials' && (
                    <div className={`${styles['ob-step']} ${styles['ob-step-left']}`}>
                        <h2 className={styles['ob-step-title']}>{t('onboarding.accountDetails')}</h2>
                        <p className={styles['ob-step-subtitle']}>
                            {selectedPreset?.id !== 'custom'
                                ? t('onboarding.connectingTo', { provider: selectedPreset?.label })
                                : t('onboarding.enterYourCredentials')}
                        </p>

                        {error && (
                            <div key={errorKey} className={styles['ob-error']} role="alert">
                                {error}
                            </div>
                        )}

                        <div className={styles['ob-form-group']}>
                            <label className={styles['ob-label']} htmlFor="ob-email">{t('settings.email')}</label>
                            <input
                                id="ob-email"
                                type="email"
                                className={styles['ob-input']}
                                placeholder="you@example.com"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                autoFocus
                            />
                        </div>

                        <div className={styles['ob-form-group']}>
                            <label className={styles['ob-label']} htmlFor="ob-display-name">
                                {t('settings.displayName')} <span className={styles['ob-label-optional']}>{t('onboarding.optional')}</span>
                            </label>
                            <input
                                id="ob-display-name"
                                type="text"
                                className={styles['ob-input']}
                                placeholder="John Doe"
                                value={displayName}
                                onChange={e => setDisplayName(e.target.value)}
                            />
                        </div>

                        <div className={styles['ob-form-group']}>
                            <label className={styles['ob-label']} htmlFor="ob-password">{t('settings.password')}</label>
                            <div className={styles['ob-password-wrap']}>
                                <input
                                    id="ob-password"
                                    type={showPassword ? 'text' : 'password'}
                                    className={styles['ob-input']}
                                    placeholder={selectedPreset?.notes ? 'App Password recommended' : 'Password'}
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                />
                                <button
                                    className={styles['ob-pw-toggle']}
                                    onClick={() => setShowPassword(!showPassword)}
                                    type="button"
                                    aria-label={showPassword ? t('onboarding.hidePassword') : t('onboarding.showPassword')}
                                >
                                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                        </div>

                        <div className={styles['ob-actions']}>
                            <button className={styles['ob-secondary-btn']} onClick={() => setStep('provider')}>
                                <ChevronLeft size={16} />
                                <span>{t('onboarding.back')}</span>
                            </button>
                            <button className={`${styles['ob-primary-btn']} ${styles['ob-shimmer-btn']}`} onClick={handleCredentialsNext} disabled={saving}>
                                <span>{saving ? (testStatus === 'testing' ? t('onboarding.testingConnection') : t('onboarding.connecting')) : selectedPreset?.id === 'custom' ? t('onboarding.next') : t('onboarding.connect')}</span>
                                <ChevronRight size={18} />
                            </button>
                        </div>
                    </div>
                )}

                {/* ---- Server ---- */}
                {step === 'server' && (
                    <div className={`${styles['ob-step']} ${styles['ob-step-left']}`}>
                        <h2 className={styles['ob-step-title']}>{t('onboarding.serverSettings')}</h2>
                        <p className={styles['ob-step-subtitle']}>{t('onboarding.serverSubtitle')}</p>

                        {error && (
                            <div key={errorKey} className={styles['ob-error']} role="alert">
                                {error}
                            </div>
                        )}

                        <div className={styles['ob-server-card']}>
                            <h3 className={styles['ob-server-heading']}>
                                <Server size={14} />
                                {t('onboarding.incomingMail')}
                            </h3>
                            <div className={styles['ob-form-row']}>
                                <div className={styles['ob-form-group']}>
                                    <label className={styles['ob-label']} htmlFor="ob-imap-host">{t('onboarding.host')}</label>
                                    <input
                                        id="ob-imap-host"
                                        type="text"
                                        className={styles['ob-input']}
                                        placeholder="imap.example.com"
                                        value={imapHost}
                                        onChange={e => setImapHost(e.target.value)}
                                    />
                                </div>
                                <div className={`${styles['ob-form-group']} ${styles['ob-port-group']}`}>
                                    <label className={styles['ob-label']} htmlFor="ob-imap-port">{t('onboarding.port')}</label>
                                    <input
                                        id="ob-imap-port"
                                        type="number"
                                        className={styles['ob-input']}
                                        min={1}
                                        max={65535}
                                        value={imapPort}
                                        onChange={e => setImapPort(Number(e.target.value))}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className={styles['ob-server-card']}>
                            <h3 className={styles['ob-server-heading']}>
                                <Server size={14} />
                                {t('onboarding.outgoingMail')}
                            </h3>
                            <div className={styles['ob-form-row']}>
                                <div className={styles['ob-form-group']}>
                                    <label className={styles['ob-label']} htmlFor="ob-smtp-host">{t('onboarding.host')}</label>
                                    <input
                                        id="ob-smtp-host"
                                        type="text"
                                        className={styles['ob-input']}
                                        placeholder="smtp.example.com"
                                        value={smtpHost}
                                        onChange={e => setSmtpHost(e.target.value)}
                                    />
                                </div>
                                <div className={`${styles['ob-form-group']} ${styles['ob-port-group']}`}>
                                    <label className={styles['ob-label']} htmlFor="ob-smtp-port">{t('onboarding.port')}</label>
                                    <input
                                        id="ob-smtp-port"
                                        type="number"
                                        className={styles['ob-input']}
                                        min={1}
                                        max={65535}
                                        value={smtpPort}
                                        onChange={e => setSmtpPort(Number(e.target.value))}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className={styles['ob-actions']}>
                            <button className={styles['ob-secondary-btn']} onClick={() => setStep('credentials')}>
                                <ChevronLeft size={16} />
                                <span>{t('onboarding.back')}</span>
                            </button>
                            <button className={`${styles['ob-primary-btn']} ${styles['ob-shimmer-btn']}`} onClick={handleSubmit} disabled={saving}>
                                <span>{saving ? (testStatus === 'testing' ? t('onboarding.testingConnection') : t('onboarding.connecting')) : t('onboarding.connect')}</span>
                                <ChevronRight size={18} />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
