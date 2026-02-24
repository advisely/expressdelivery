import { useState, useEffect, type FC, type ElementType } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import {
    X, Layout, Monitor, Moon, Sun, Droplets,
    Plus, Trash2, Mail, Eye, EyeOff, Server,
    CheckCircle2, XCircle, Loader
} from 'lucide-react';
import { useLayout, Layout as LayoutType } from './ThemeContext';
import { useThemeStore, THEMES, ThemeName } from '../stores/themeStore';
import { useEmailStore } from '../stores/emailStore';
import type { Account, Folder } from '../stores/emailStore';
import { PROVIDER_PRESETS } from '../lib/providerPresets';
import type { ProviderPreset } from '../lib/providerPresets';
import { ipcInvoke } from '../lib/ipc';
import { getProviderIcon } from '../lib/providerIcons';

const THEME_ICONS: Record<ThemeName, ElementType> = {
    light: Sun,
    cream: Sun,
    midnight: Moon,
    forest: Droplets,
};

const LAYOUTS: { id: LayoutType; label: string; icon: ElementType }[] = [
    { id: 'vertical', label: 'Vertical Split (3-Pane)', icon: Layout },
    { id: 'horizontal', label: 'Horizontal Split', icon: Monitor },
];

const providerLabel = (providerId: string) =>
    PROVIDER_PRESETS.find(p => p.id === providerId)?.label ?? providerId;

type TestStatus = 'idle' | 'testing' | 'passed' | 'failed';

interface SettingsModalProps {
    onClose: () => void;
}

export const SettingsModal: FC<SettingsModalProps> = ({ onClose }) => {
    const [isAddingAccount, setIsAddingAccount] = useState(false);
    const [editingAccountId, setEditingAccountId] = useState<string | null>(null);

    // Account form state
    const [selectedPreset, setSelectedPreset] = useState<ProviderPreset | null>(null);
    const [formEmail, setFormEmail] = useState('');
    const [formDisplayName, setFormDisplayName] = useState('');
    const [formPassword, setFormPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [formImapHost, setFormImapHost] = useState('');
    const [formImapPort, setFormImapPort] = useState(993);
    const [formSmtpHost, setFormSmtpHost] = useState('');
    const [formSmtpPort, setFormSmtpPort] = useState(465);
    const [formError, setFormError] = useState<string | null>(null);
    const [formSaving, setFormSaving] = useState(false);
    const [showServerFields, setShowServerFields] = useState(false);
    const [testStatus, setTestStatus] = useState<TestStatus>('idle');

    const { accounts, addAccount, updateAccount, removeAccount, selectAccount, selectFolder, setFolders } = useEmailStore();
    const { layout, setLayout } = useLayout();
    const { themeName, setTheme } = useThemeStore();

    // Clear sensitive form state on unmount
    useEffect(() => {
        return () => {
            setFormPassword('');
        };
    }, []);

    const resetForm = () => {
        setSelectedPreset(null);
        setFormEmail('');
        setFormDisplayName('');
        setFormPassword('');
        setShowPassword(false);
        setFormImapHost('');
        setFormImapPort(993);
        setFormSmtpHost('');
        setFormSmtpPort(465);
        setFormError(null);
        setShowServerFields(false);
        setIsAddingAccount(false);
        setEditingAccountId(null);
        setTestStatus('idle');
    };

    const resetTestStatus = () => { setTestStatus('idle'); };

    const runConnectionTest = async (email: string, password: string, host: string, port: number): Promise<boolean> => {
        setTestStatus('testing');
        setFormError(null);
        try {
            const testResult = await ipcInvoke<{ success: boolean; error?: string }>('accounts:test', {
                email: email.trim(),
                password,
                imap_host: host,
                imap_port: port,
            });
            if (testResult && !testResult.success) {
                setTestStatus('failed');
                setFormError(testResult.error ?? 'Connection test failed. Check your credentials and server settings.');
                return false;
            }
            setTestStatus('passed');
            return true;
        } catch {
            setTestStatus('failed');
            setFormError('Connection test failed. Check your credentials and server settings.');
            return false;
        }
    };

    const handleTestConnection = async () => {
        const finalImapHost = formImapHost || selectedPreset?.imapHost || '';
        if (!formEmail.trim() || !formPassword.trim() || !finalImapHost) {
            setFormError('Fill in email, password, and server settings before testing');
            return;
        }
        await runConnectionTest(formEmail, formPassword, finalImapHost, formImapPort);
    };

    const selectProvider = (preset: ProviderPreset) => {
        setSelectedPreset(preset);
        setFormImapHost(preset.imapHost);
        setFormImapPort(preset.imapPort);
        setFormSmtpHost(preset.smtpHost);
        setFormSmtpPort(preset.smtpPort);
        setShowServerFields(preset.id === 'custom');
        setFormError(null);
    };

    const enterEditMode = (account: Account) => {
        setEditingAccountId(account.id);
        setIsAddingAccount(true);
        setFormEmail(account.email);
        setFormDisplayName(account.display_name ?? '');
        setFormPassword('');
        setShowPassword(false);
        setFormImapHost(account.imap_host ?? '');
        setFormImapPort(account.imap_port ?? 993);
        setFormSmtpHost(account.smtp_host ?? '');
        setFormSmtpPort(account.smtp_port ?? 465);
        setFormError(null);
        setTestStatus('idle');
        const preset = PROVIDER_PRESETS.find(p => p.id === account.provider) ?? null;
        setSelectedPreset(preset);
        setShowServerFields(true);
    };

    const handleAddAccount = async () => {
        if (!formEmail.trim()) { setFormError('Email address is required'); return; }
        if (!formPassword.trim()) { setFormError('Password is required'); return; }
        const finalImapHost = formImapHost || selectedPreset?.imapHost || '';
        const finalSmtpHost = formSmtpHost || selectedPreset?.smtpHost || '';
        if (!finalImapHost || !finalSmtpHost) { setFormError('Please select a provider or fill in server details'); return; }

        setFormSaving(true);
        setFormError(null);

        // Skip connection test if already passed via standalone test button
        if (testStatus !== 'passed') {
            const passed = await runConnectionTest(formEmail, formPassword, finalImapHost, formImapPort);
            if (!passed) { setFormSaving(false); return; }
        }

        try {
            const result = await ipcInvoke<{ id: string }>('accounts:add', {
                email: formEmail.trim(),
                provider: selectedPreset?.id ?? 'custom',
                password: formPassword,
                display_name: formDisplayName.trim() || null,
                imap_host: finalImapHost,
                imap_port: formImapPort,
                smtp_host: finalSmtpHost,
                smtp_port: formSmtpPort,
            });
            if (result?.id) {
                addAccount({
                    id: result.id,
                    email: formEmail.trim(),
                    provider: selectedPreset?.id ?? 'custom',
                    display_name: formDisplayName.trim() || null,
                    imap_host: finalImapHost,
                    imap_port: formImapPort,
                    smtp_host: finalSmtpHost,
                    smtp_port: formSmtpPort,
                });

                // Select the new account and load its folders + emails
                selectAccount(result.id);
                const folders = await ipcInvoke<Folder[]>('folders:list', result.id);
                if (folders) {
                    setFolders(folders);
                    const inbox = folders.find(f => f.type === 'inbox');
                    if (inbox) selectFolder(inbox.id);
                }

                resetForm();
            }
        } catch {
            setFormError('Failed to add account. Please check your details.');
            setTestStatus('idle');
        } finally {
            setFormSaving(false);
        }
    };

    const handleUpdateAccount = async () => {
        if (!editingAccountId) return;
        if (!formEmail.trim()) { setFormError('Email address is required'); return; }
        const finalImapHost = formImapHost || selectedPreset?.imapHost || '';
        const finalSmtpHost = formSmtpHost || selectedPreset?.smtpHost || '';
        if (!finalImapHost || !finalSmtpHost) { setFormError('Please select a provider or fill in server details'); return; }

        const hasPassword = formPassword.trim().length > 0;

        setFormSaving(true);
        setFormError(null);

        // Only run connection test when a new password is provided and not already tested
        if (hasPassword && testStatus !== 'passed') {
            const passed = await runConnectionTest(formEmail, formPassword, finalImapHost, formImapPort);
            if (!passed) { setFormSaving(false); return; }
        }

        try {
            const payload: Record<string, unknown> = {
                id: editingAccountId,
                email: formEmail.trim(),
                provider: selectedPreset?.id ?? 'custom',
                display_name: formDisplayName.trim() || null,
                imap_host: finalImapHost,
                imap_port: formImapPort,
                smtp_host: finalSmtpHost,
                smtp_port: formSmtpPort,
            };
            if (hasPassword) {
                payload.password = formPassword;
            }
            await ipcInvoke('accounts:update', payload);
            updateAccount({
                id: editingAccountId,
                email: formEmail.trim(),
                provider: selectedPreset?.id ?? 'custom',
                display_name: formDisplayName.trim() || null,
                imap_host: finalImapHost,
                imap_port: formImapPort,
                smtp_host: finalSmtpHost,
                smtp_port: formSmtpPort,
            });
            resetForm();
        } catch {
            setFormError('Failed to update account. Please check your details.');
            setTestStatus('idle');
        } finally {
            setFormSaving(false);
        }
    };

    const handleRemoveAccount = async (accountId: string) => {
        try {
            await ipcInvoke('accounts:remove', accountId);
            removeAccount(accountId);
        } catch {
            setFormError('Failed to remove account.');
        }
    };

    const isEditing = editingAccountId !== null;
    const hasPassword = formPassword.trim().length > 0;

    const getPrimaryButtonLabel = () => {
        if (testStatus === 'testing') return 'Testing connection...';
        if (formSaving) return 'Saving...';
        if (isEditing) {
            if (testStatus === 'passed') return 'Save Changes';
            return hasPassword ? 'Test & Save Changes' : 'Save Changes';
        }
        if (testStatus === 'passed') return 'Add Account';
        return 'Test & Add Account';
    };

    return (
        <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
            <Dialog.Portal>
                <Dialog.Overlay className="settings-overlay" />
                <Dialog.Content className="settings-modal" aria-describedby={undefined}>
                    <div className="settings-modal__header">
                        <Dialog.Title className="settings-modal__title">Settings</Dialog.Title>
                        <Dialog.Close asChild>
                            <button className="close-btn" aria-label="Close settings">
                                <X size={20} />
                            </button>
                        </Dialog.Close>
                    </div>

                    <Tabs.Root className="settings-body" defaultValue="accounts" orientation="vertical">
                        <Tabs.List className="settings-tabs" aria-label="Settings sections">
                            <Tabs.Trigger className="tab-btn" value="accounts">
                                <Mail size={16} />
                                <span>Accounts</span>
                            </Tabs.Trigger>
                            <Tabs.Trigger className="tab-btn" value="appearance">
                                <Sun size={16} />
                                <span>Appearance</span>
                            </Tabs.Trigger>
                        </Tabs.List>

                        <Tabs.Content className="settings-tab-panel" value="accounts" forceMount>
                            {!isAddingAccount && (
                                <div className="accounts-list-view">
                                    <h3 className="section-title">Email Accounts</h3>
                                    {accounts.length === 0 && (
                                        <div className="empty-accounts">
                                            <Mail size={32} />
                                            <p>No accounts connected</p>
                                        </div>
                                    )}
                                    {accounts.map(account => {
                                        const ProviderIcon = getProviderIcon(account.provider);
                                        return (
                                            <div
                                                key={account.id}
                                                className="account-item"
                                                onClick={() => enterEditMode(account)}
                                                role="button"
                                                tabIndex={0}
                                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') enterEditMode(account); }}
                                                aria-label={`Edit ${account.email}`}
                                            >
                                                <div className="account-item-avatar">
                                                    <ProviderIcon size={20} />
                                                </div>
                                                <div className="account-item-info">
                                                    <span className="account-item-email">{account.email}</span>
                                                    <span className="account-item-provider">{providerLabel(account.provider)}</span>
                                                </div>
                                                <button
                                                    className="delete-btn"
                                                    onClick={(e) => { e.stopPropagation(); handleRemoveAccount(account.id); }}
                                                    title="Remove account"
                                                    aria-label={`Remove ${account.email}`}
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        );
                                    })}
                                    <button className="add-account-btn" onClick={() => setIsAddingAccount(true)}>
                                        <Plus size={16} />
                                        <span>Add Account</span>
                                    </button>
                                </div>
                            )}

                            {isAddingAccount && (
                                <div className="account-form-view">
                                    <h3 className="section-title">{isEditing ? 'Edit Account' : 'Add Account'}</h3>

                                    {formError && <div className="form-error" role="alert">{formError}</div>}

                                    <div className="form-group">
                                        <label className="form-label">Provider</label>
                                        <div className="provider-mini-grid">
                                            {PROVIDER_PRESETS.map(preset => {
                                                const PresetIcon = getProviderIcon(preset.id);
                                                return (
                                                    <button
                                                        key={preset.id}
                                                        className={`provider-chip ${selectedPreset?.id === preset.id ? 'active' : ''}`}
                                                        onClick={() => selectProvider(preset)}
                                                    >
                                                        <PresetIcon size={18} />
                                                        {preset.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label" htmlFor="settings-email">Email Address</label>
                                        <input
                                            id="settings-email"
                                            type="email"
                                            className="form-input"
                                            placeholder="you@example.com"
                                            value={formEmail}
                                            onChange={e => { setFormEmail(e.target.value); resetTestStatus(); }}
                                        />
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label" htmlFor="settings-display-name">Display Name</label>
                                        <input
                                            id="settings-display-name"
                                            type="text"
                                            className="form-input"
                                            placeholder="John Doe (optional)"
                                            value={formDisplayName}
                                            onChange={e => setFormDisplayName(e.target.value)}
                                        />
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label" htmlFor="settings-password">Password</label>
                                        <div className="password-wrapper">
                                            <input
                                                id="settings-password"
                                                type={showPassword ? 'text' : 'password'}
                                                className="form-input"
                                                placeholder={isEditing ? 'Leave blank to keep current' : 'Password or App Password'}
                                                value={formPassword}
                                                onChange={e => { setFormPassword(e.target.value); resetTestStatus(); }}
                                            />
                                            <button
                                                className="password-toggle"
                                                onClick={() => setShowPassword(!showPassword)}
                                                type="button"
                                                aria-label={showPassword ? 'Hide password' : 'Show password'}
                                            >
                                                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                            </button>
                                        </div>
                                    </div>

                                    {(showServerFields || selectedPreset) && (
                                        <div className="server-fields">
                                            <button
                                                type="button"
                                                className="server-header"
                                                onClick={() => setShowServerFields(!showServerFields)}
                                                aria-expanded={showServerFields}
                                            >
                                                <Server size={14} />
                                                <span>Server Settings</span>
                                                <span className="toggle-hint">{showServerFields ? 'Hide' : 'Show'}</span>
                                            </button>
                                            {showServerFields && (
                                                <>
                                                    <div className="form-row">
                                                        <div className="form-group">
                                                            <label className="form-label" htmlFor="settings-imap-host">IMAP Host</label>
                                                            <input
                                                                id="settings-imap-host"
                                                                type="text"
                                                                className="form-input"
                                                                placeholder="imap.example.com"
                                                                value={formImapHost}
                                                                onChange={e => { setFormImapHost(e.target.value); resetTestStatus(); }}
                                                            />
                                                        </div>
                                                        <div className="form-group form-group-port">
                                                            <label className="form-label" htmlFor="settings-imap-port">Port</label>
                                                            <input
                                                                id="settings-imap-port"
                                                                type="number"
                                                                className="form-input"
                                                                value={formImapPort}
                                                                min={1}
                                                                max={65535}
                                                                onChange={e => { setFormImapPort(Number(e.target.value)); resetTestStatus(); }}
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="form-row">
                                                        <div className="form-group">
                                                            <label className="form-label" htmlFor="settings-smtp-host">SMTP Host</label>
                                                            <input
                                                                id="settings-smtp-host"
                                                                type="text"
                                                                className="form-input"
                                                                placeholder="smtp.example.com"
                                                                value={formSmtpHost}
                                                                onChange={e => { setFormSmtpHost(e.target.value); resetTestStatus(); }}
                                                            />
                                                        </div>
                                                        <div className="form-group form-group-port">
                                                            <label className="form-label" htmlFor="settings-smtp-port">Port</label>
                                                            <input
                                                                id="settings-smtp-port"
                                                                type="number"
                                                                className="form-input"
                                                                value={formSmtpPort}
                                                                min={1}
                                                                max={65535}
                                                                onChange={e => { setFormSmtpPort(Number(e.target.value)); resetTestStatus(); }}
                                                            />
                                                        </div>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    )}

                                    <div className="form-actions">
                                        <button
                                            className={`test-btn ${testStatus === 'passed' ? 'test-passed' : ''} ${testStatus === 'failed' ? 'test-failed' : ''}`}
                                            onClick={handleTestConnection}
                                            disabled={testStatus === 'testing' || !formEmail.trim() || !formPassword.trim()}
                                            type="button"
                                        >
                                            {testStatus === 'testing' && <Loader size={14} className="test-spin" />}
                                            {testStatus === 'passed' && <CheckCircle2 size={14} />}
                                            {testStatus === 'failed' && <XCircle size={14} />}
                                            <span>
                                                {testStatus === 'testing' ? 'Testing...' :
                                                 testStatus === 'passed' ? 'Connected' :
                                                 testStatus === 'failed' ? 'Failed' : 'Test Connection'}
                                            </span>
                                        </button>
                                        <div style={{ flex: 1 }} />
                                        <button className="secondary-btn" onClick={resetForm}>Cancel</button>
                                        <button
                                            className="primary-btn"
                                            onClick={isEditing ? handleUpdateAccount : handleAddAccount}
                                            disabled={formSaving}
                                        >
                                            {getPrimaryButtonLabel()}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </Tabs.Content>

                        <Tabs.Content className="settings-tab-panel" value="appearance" forceMount>
                            <div className="appearance-view">
                                <div className="setting-group">
                                    <h3 className="section-title">Interface Theme</h3>
                                    <div className="options-grid">
                                        {THEMES.map(t => {
                                            const Icon = THEME_ICONS[t.name];
                                            return (
                                                <button
                                                    key={t.name}
                                                    className={`option-btn ${themeName === t.name ? 'active' : ''}`}
                                                    onClick={() => setTheme(t.name)}
                                                >
                                                    <Icon size={18} />
                                                    <span>{t.label}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="setting-group">
                                    <h3 className="section-title">Pane Layout</h3>
                                    <div className="options-grid">
                                        {LAYOUTS.map(l => (
                                            <button
                                                key={l.id}
                                                className={`option-btn ${layout === l.id ? 'active' : ''}`}
                                                onClick={() => setLayout(l.id)}
                                            >
                                                <l.icon size={18} />
                                                <span>{l.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </Tabs.Content>
                    </Tabs.Root>
                </Dialog.Content>
            </Dialog.Portal>

            <style>{`
                .settings-overlay {
                    position: fixed;
                    inset: 0;
                    background: rgba(0, 0, 0, 0.55);
                    backdrop-filter: blur(8px);
                    z-index: 1000;
                    animation: overlayFadeIn 0.15s ease-out;
                }

                @keyframes overlayFadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }

                .settings-modal {
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    width: 640px;
                    max-height: 80vh;
                    border-radius: 12px;
                    background: rgb(var(--color-bg-elevated));
                    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    z-index: 1001;
                    animation: settingsFadeIn 0.2s ease-out;
                }

                @keyframes settingsFadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }

                .settings-modal__header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 16px 20px;
                    border-bottom: 1px solid var(--glass-border);
                }

                .settings-modal__title {
                    font-size: 18px;
                    font-weight: 600;
                    color: var(--text-primary);
                    margin: 0;
                }

                .close-btn {
                    color: var(--text-secondary);
                    padding: 6px;
                    border-radius: 6px;
                }

                .close-btn:hover {
                    background: var(--close-hover-bg);
                    color: var(--text-primary);
                }

                .settings-body {
                    display: flex;
                    flex: 1;
                    overflow: hidden;
                    min-height: 400px;
                }

                .settings-tabs {
                    width: 160px;
                    padding: 12px 8px;
                    border-right: 1px solid var(--glass-border);
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                    flex-shrink: 0;
                }

                .tab-btn {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 10px 12px;
                    border-radius: 6px;
                    color: var(--text-secondary);
                    font-size: 14px;
                    font-weight: 500;
                    width: 100%;
                    text-align: left;
                    background: none;
                    border: none;
                    cursor: pointer;
                    font-family: inherit;
                }

                .tab-btn:hover {
                    background: var(--hover-bg);
                    color: var(--text-primary);
                }

                .tab-btn[data-state="active"] {
                    background: rgba(var(--color-accent), 0.12);
                    color: var(--accent-color);
                }

                .settings-tab-panel {
                    flex: 1;
                    padding: 24px;
                    overflow-y: auto;
                }

                .settings-tab-panel[data-state="inactive"] {
                    display: none;
                }

                .section-title {
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--text-secondary);
                    margin-bottom: 16px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                /* Accounts List */
                .empty-accounts {
                    text-align: center;
                    padding: 32px 16px;
                    color: var(--text-muted);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 8px;
                }

                .account-item {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 12px 16px;
                    border-radius: 8px;
                    border: 1px solid var(--glass-border);
                    background: var(--surface-overlay);
                    margin-bottom: 8px;
                    cursor: pointer;
                    transition: border-color 0.2s;
                }

                .account-item:hover {
                    border-color: var(--accent-color);
                }

                .account-item-avatar {
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    background: var(--surface-inset);
                    color: var(--text-secondary);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                }

                .account-item-info {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    min-width: 0;
                }

                .account-item-email {
                    font-size: 14px;
                    font-weight: 500;
                    color: var(--text-primary);
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .account-item-provider {
                    font-size: 12px;
                    color: var(--text-muted);
                }

                .delete-btn {
                    color: var(--text-muted);
                    padding: 6px;
                    border-radius: 6px;
                    flex-shrink: 0;
                }

                .delete-btn:hover {
                    color: rgb(var(--color-danger));
                    background: rgba(var(--color-danger), 0.1);
                }

                .add-account-btn {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    width: 100%;
                    padding: 12px;
                    border-radius: 8px;
                    border: 1px dashed var(--glass-border);
                    color: var(--text-secondary);
                    font-size: 14px;
                    font-weight: 500;
                    margin-top: 8px;
                }

                .add-account-btn:hover {
                    background: var(--hover-bg);
                    color: var(--accent-color);
                    border-color: var(--accent-color);
                }

                /* Account Form */
                .form-error {
                    padding: 10px 14px;
                    border-radius: 8px;
                    background: rgba(var(--color-danger), 0.1);
                    color: rgb(var(--color-danger));
                    font-size: 13px;
                    margin-bottom: 16px;
                }

                .form-group {
                    margin-bottom: 16px;
                }

                .form-group-port {
                    width: 100px;
                    flex-shrink: 0;
                }

                .form-label {
                    display: block;
                    font-size: 13px;
                    font-weight: 500;
                    color: var(--text-secondary);
                    margin-bottom: 6px;
                }

                .form-input {
                    width: 100%;
                    padding: 8px 12px;
                    border-radius: 6px;
                    border: 1px solid var(--glass-border);
                    background: var(--bg-primary);
                    color: var(--text-primary);
                    font-family: inherit;
                    font-size: 14px;
                    outline: none;
                    transition: border-color 0.2s;
                }

                .form-input:focus {
                    border-color: var(--accent-color);
                }

                .form-input::placeholder {
                    color: var(--text-muted);
                }

                .password-wrapper {
                    position: relative;
                }

                .password-wrapper .form-input {
                    padding-right: 40px;
                }

                .password-toggle {
                    position: absolute;
                    right: 8px;
                    top: 50%;
                    transform: translateY(-50%);
                    color: var(--text-muted);
                    padding: 4px;
                    border-radius: 4px;
                }

                .password-toggle:hover {
                    color: var(--text-primary);
                }

                .provider-mini-grid {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                }

                .provider-chip {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 6px 14px;
                    border-radius: 20px;
                    border: 1px solid var(--glass-border);
                    background: var(--surface-overlay);
                    color: var(--text-secondary);
                    font-size: 13px;
                    font-weight: 500;
                }

                .provider-chip:hover {
                    background: var(--hover-bg);
                    color: var(--text-primary);
                }

                .provider-chip.active {
                    background: rgba(var(--color-accent), 0.12);
                    border-color: var(--accent-color);
                    color: var(--accent-color);
                }

                .server-fields {
                    margin-bottom: 16px;
                    border: 1px solid var(--glass-border);
                    border-radius: 8px;
                    overflow: hidden;
                }

                .server-header {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 10px 14px;
                    width: 100%;
                    background: var(--surface-overlay);
                    color: var(--text-secondary);
                    font-size: 13px;
                    font-weight: 500;
                    cursor: pointer;
                    border: none;
                    font-family: inherit;
                    text-align: left;
                }

                .server-header:hover {
                    background: var(--hover-bg);
                }

                .toggle-hint {
                    margin-left: auto;
                    font-size: 12px;
                    color: var(--text-muted);
                }

                .server-fields .form-row {
                    display: flex;
                    gap: 12px;
                    padding: 0 14px;
                }

                .server-fields .form-row .form-group:first-child {
                    flex: 1;
                }

                .server-fields .form-group:first-of-type {
                    margin-top: 12px;
                }

                .form-row {
                    display: flex;
                    gap: 12px;
                }

                .form-actions {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    margin-top: 8px;
                }

                .test-btn {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 8px 16px;
                    border-radius: 6px;
                    font-size: 13px;
                    font-weight: 500;
                    border: 1px solid var(--glass-border);
                    background: var(--surface-overlay);
                    color: var(--text-secondary);
                    font-family: inherit;
                    cursor: pointer;
                }

                .test-btn:hover:not(:disabled) {
                    background: var(--hover-bg);
                    color: var(--text-primary);
                }

                .test-btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                .test-btn.test-passed {
                    color: rgb(var(--color-success));
                    border-color: rgb(var(--color-success));
                }

                .test-btn.test-failed {
                    color: rgb(var(--color-danger));
                    border-color: rgb(var(--color-danger));
                }

                .test-spin {
                    animation: testSpinAnim 1s linear infinite;
                }

                @keyframes testSpinAnim {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }

                .primary-btn {
                    background: var(--accent-color);
                    color: white;
                    padding: 8px 20px;
                    border-radius: 6px;
                    font-weight: 500;
                    font-size: 14px;
                }

                .primary-btn:hover {
                    background: var(--accent-hover);
                }

                .primary-btn:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                }

                .secondary-btn {
                    background: var(--surface-inset);
                    color: var(--text-primary);
                    padding: 8px 20px;
                    border-radius: 6px;
                    font-weight: 500;
                    font-size: 14px;
                }

                .secondary-btn:hover {
                    background: var(--close-hover-bg);
                }

                /* Appearance Tab */
                .setting-group {
                    margin-bottom: 24px;
                }

                .options-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
                    gap: 12px;
                }

                .option-btn {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 8px;
                    padding: 16px;
                    border-radius: 8px;
                    border: 1px solid var(--glass-border);
                    background: var(--surface-overlay);
                    color: var(--text-secondary);
                }

                .option-btn:hover {
                    background: var(--hover-bg);
                    color: var(--text-primary);
                }

                .option-btn.active {
                    background: rgba(var(--color-accent), 0.12);
                    border-color: var(--accent-color);
                    color: var(--accent-color);
                }

                @media (prefers-reduced-motion: reduce) {
                    .settings-overlay,
                    .settings-modal {
                        animation: none;
                    }
                    .test-spin {
                        animation-duration: 0s;
                    }
                }
            `}</style>
        </Dialog.Root>
    );
};
