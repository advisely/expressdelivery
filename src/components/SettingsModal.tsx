import { useState, useEffect, type FC, type ElementType } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import {
    X, Layout, Monitor, Moon, Sun, Droplets,
    Plus, Trash2, Mail, Eye, EyeOff, Server,
    CheckCircle2, XCircle, Loader, Key, Bell, Filter, GripVertical, Pencil, FileText
} from 'lucide-react';
import { useLayout, Layout as LayoutType } from './ThemeContext';
import { useThemeStore, THEMES, ThemeName } from '../stores/themeStore';
import { useEmailStore } from '../stores/emailStore';
import type { Account, Folder } from '../stores/emailStore';
import { PROVIDER_PRESETS } from '../lib/providerPresets';
import type { ProviderPreset } from '../lib/providerPresets';
import { ipcInvoke } from '../lib/ipc';
import { getProviderIcon } from '../lib/providerIcons';
import styles from './SettingsModal.module.css';

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
    const [formSignature, setFormSignature] = useState('');
    const [formError, setFormError] = useState<string | null>(null);
    const [formSaving, setFormSaving] = useState(false);
    const [showServerFields, setShowServerFields] = useState(false);
    const [testStatus, setTestStatus] = useState<TestStatus>('idle');

    const { accounts, addAccount, updateAccount, removeAccount, selectAccount, selectFolder, setFolders } = useEmailStore();
    const { layout, setLayout } = useLayout();
    const { themeName, setTheme } = useThemeStore();
    const { i18n, t } = useTranslation();

    // API key state
    const [apiKey, setApiKey] = useState('');
    const [showApiKey, setShowApiKey] = useState(false);
    const [apiKeySaving, setApiKeySaving] = useState(false);
    const [apiKeyStatus, setApiKeyStatus] = useState<'idle' | 'saved' | 'error'>('idle');

    // Notification settings state
    const [notificationsEnabled, setNotificationsEnabled] = useState(true);

    // Mail rules state
    interface MailRule {
        id: string;
        name: string;
        priority: number;
        is_active: number;
        match_field: string;
        match_operator: string;
        match_value: string;
        action_type: string;
        action_value: string | null;
    }
    const [rules, setRules] = useState<MailRule[]>([]);
    const [editingRule, setEditingRule] = useState<Partial<MailRule> | null>(null);
    const [ruleError, setRuleError] = useState<string | null>(null);

    // Reply templates state
    interface ReplyTemplate {
        id: string;
        name: string;
        body_html: string;
    }
    const [templateList, setTemplateList] = useState<ReplyTemplate[]>([]);
    const [editingTemplate, setEditingTemplate] = useState<ReplyTemplate | null>(null);
    const [templateError, setTemplateError] = useState<string | null>(null);

    // Load API key and notification settings on mount
    useEffect(() => {
        let cancelled = false;
        async function loadApiKey() {
            try {
                const key = await ipcInvoke<string | null>('apikeys:get-openrouter');
                if (key && !cancelled) setApiKey(key);
            } catch {
                if (!cancelled) setApiKeyStatus('error');
            }
        }
        async function loadNotifSettings() {
            const val = await ipcInvoke<string | null>('settings:get', 'notifications_enabled');
            if (!cancelled) setNotificationsEnabled(val !== 'false');
        }
        loadApiKey();
        loadNotifSettings();
        return () => { cancelled = true; };
    }, []);

    // Clear sensitive form state on unmount
    useEffect(() => {
        return () => {
            setFormPassword('');
            setApiKey('');
        };
    }, []);

    // Load rules for first account
    const rulesAccountId = accounts[0]?.id;
    useEffect(() => {
        if (!rulesAccountId) return;
        let cancelled = false;
        async function loadRules() {
            const result = await ipcInvoke<MailRule[]>('rules:list', rulesAccountId);
            if (result && !cancelled) setRules(result);
        }
        loadRules();
        return () => { cancelled = true; };
    }, [rulesAccountId]);

    // Load reply templates on mount
    useEffect(() => {
        let cancelled = false;
        ipcInvoke<ReplyTemplate[]>('templates:list')
            .then(result => { if (result && !cancelled) setTemplateList(result); });
        return () => { cancelled = true; };
    }, []);

    const handleSaveTemplate = async () => {
        if (!editingTemplate) return;
        setTemplateError(null);
        if (!editingTemplate.name.trim()) { setTemplateError(t('settings.templateNameRequired')); return; }
        if (!editingTemplate.body_html.trim()) { setTemplateError(t('settings.templateBodyRequired')); return; }
        try {
            if (editingTemplate.id) {
                await ipcInvoke('templates:update', { id: editingTemplate.id, name: editingTemplate.name, body_html: editingTemplate.body_html });
            } else {
                await ipcInvoke('templates:create', { name: editingTemplate.name, body_html: editingTemplate.body_html });
            }
            const result = await ipcInvoke<ReplyTemplate[]>('templates:list');
            if (result) setTemplateList(result);
            setEditingTemplate(null);
        } catch {
            setTemplateError(t('settings.templateSaveFailed'));
        }
    };

    const handleDeleteTemplate = async (id: string) => {
        await ipcInvoke('templates:delete', id);
        setTemplateList(prev => prev.filter(tpl => tpl.id !== id));
    };

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
        setFormSignature('');
        setFormError(null);
        setShowServerFields(false);
        setIsAddingAccount(false);
        setEditingAccountId(null);
        setTestStatus('idle');
    };

    const resetTestStatus = () => { setTestStatus('idle'); };

    const handleSaveApiKey = async () => {
        setApiKeySaving(true);
        setApiKeyStatus('idle');
        try {
            await ipcInvoke<{ success: boolean }>('apikeys:set-openrouter', apiKey.trim());
            setApiKeyStatus('saved');
            setTimeout(() => setApiKeyStatus('idle'), 3000);
        } catch {
            setApiKeyStatus('error');
        } finally {
            setApiKeySaving(false);
        }
    };

    const handleClearApiKey = async () => {
        setApiKeySaving(true);
        setApiKeyStatus('idle');
        try {
            await ipcInvoke<{ success: boolean }>('apikeys:set-openrouter', '');
            setApiKey('');
        } catch {
            setApiKeyStatus('error');
        } finally {
            setApiKeySaving(false);
        }
    };

    const handleToggleNotifications = async (enabled: boolean) => {
        setNotificationsEnabled(enabled);
        await ipcInvoke('settings:set', 'notifications_enabled', enabled ? 'true' : 'false');
    };

    const handleSaveRule = async () => {
        if (!editingRule || !rulesAccountId) return;
        setRuleError(null);
        if (!editingRule.name?.trim()) { setRuleError(t('settings.ruleNameRequired')); return; }
        if (!editingRule.match_value?.trim()) { setRuleError(t('settings.ruleValueRequired')); return; }
        try {
            if (editingRule.id) {
                await ipcInvoke('rules:update', {
                    ruleId: editingRule.id,
                    name: editingRule.name,
                    matchField: editingRule.match_field,
                    matchOperator: editingRule.match_operator,
                    matchValue: editingRule.match_value,
                    actionType: editingRule.action_type,
                    actionValue: editingRule.action_value,
                    isActive: !!editingRule.is_active,
                });
            } else {
                await ipcInvoke('rules:create', {
                    accountId: rulesAccountId,
                    name: editingRule.name,
                    matchField: editingRule.match_field ?? 'from',
                    matchOperator: editingRule.match_operator ?? 'contains',
                    matchValue: editingRule.match_value,
                    actionType: editingRule.action_type ?? 'mark_read',
                    actionValue: editingRule.action_value,
                });
            }
            const result = await ipcInvoke<MailRule[]>('rules:list', rulesAccountId);
            if (result) setRules(result);
            setEditingRule(null);
        } catch {
            setRuleError(t('settings.ruleSaveFailed'));
        }
    };

    const handleDeleteRule = async (ruleId: string) => {
        if (!rulesAccountId) return;
        try {
            await ipcInvoke('rules:delete', ruleId, rulesAccountId);
            const result = await ipcInvoke<MailRule[]>('rules:list', rulesAccountId);
            if (result) setRules(result);
        } catch {
            setRuleError('Failed to delete rule');
        }
    };

    const handleToggleRule = async (rule: MailRule) => {
        if (!rulesAccountId) return;
        try {
            await ipcInvoke('rules:update', {
                ruleId: rule.id,
                isActive: !rule.is_active,
            });
            const result = await ipcInvoke<MailRule[]>('rules:list', rulesAccountId);
            if (result) setRules(result);
        } catch {
            setRuleError('Failed to toggle rule');
        }
    };

    const runConnectionTest = async (email: string, password: string, host: string, port: number): Promise<boolean> => {
        setTestStatus('testing');
        setFormError(null);
        try {
            const payload: Record<string, unknown> = {
                email: email.trim(),
                password: password || undefined,
                imap_host: host,
                imap_port: port,
            };
            if (editingAccountId) payload.account_id = editingAccountId;
            const testResult = await ipcInvoke<{ success: boolean; error?: string }>('accounts:test', payload);
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
        if (!formEmail.trim() || (!formPassword.trim() && !isEditing) || !finalImapHost) {
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
        setFormSignature(account.signature_html ?? '');
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
            const signatureHtml = formSignature.trim()
                ? formSignature.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '<br />')
                : null;
            const result = await ipcInvoke<{ id: string }>('accounts:add', {
                email: formEmail.trim(),
                provider: selectedPreset?.id ?? 'custom',
                password: formPassword,
                display_name: formDisplayName.trim() || null,
                imap_host: finalImapHost,
                imap_port: formImapPort,
                smtp_host: finalSmtpHost,
                smtp_port: formSmtpPort,
                signature_html: signatureHtml,
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
                    signature_html: signatureHtml,
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
            const signatureHtml = formSignature.trim()
                ? formSignature.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '<br />')
                : null;
            const payload: Record<string, unknown> = {
                id: editingAccountId,
                email: formEmail.trim(),
                provider: selectedPreset?.id ?? 'custom',
                display_name: formDisplayName.trim() || null,
                imap_host: finalImapHost,
                imap_port: formImapPort,
                smtp_host: finalSmtpHost,
                smtp_port: formSmtpPort,
                signature_html: signatureHtml,
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
                signature_html: signatureHtml,
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
        if (testStatus === 'passed') return t('settings.addAccount');
        return t('settings.testAndAdd');
    };

    return (
        <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
            <Dialog.Portal>
                <Dialog.Overlay className="settings-overlay" />
                <Dialog.Content className="settings-modal" aria-describedby={undefined}>
                    <div className={styles['settings-modal__header']}>
                        <Dialog.Title className={styles['settings-modal__title']}>{t('settings.title')}</Dialog.Title>
                        <Dialog.Close asChild>
                            <button className={styles['close-btn']} aria-label="Close settings">
                                <X size={20} />
                            </button>
                        </Dialog.Close>
                    </div>

                    <Tabs.Root className={styles['settings-body']} defaultValue="accounts" orientation="vertical">
                        <Tabs.List className={styles['settings-tabs']} aria-label="Settings sections">
                            <Tabs.Trigger className={styles['tab-btn']} value="accounts">
                                <Mail size={16} />
                                <span>{t('settings.accounts')}</span>
                            </Tabs.Trigger>
                            <Tabs.Trigger className={styles['tab-btn']} value="appearance">
                                <Sun size={16} />
                                <span>{t('settings.appearance')}</span>
                            </Tabs.Trigger>
                            <Tabs.Trigger className={styles['tab-btn']} value="ai">
                                <Key size={16} />
                                <span>{t('settings.aiKeys')}</span>
                            </Tabs.Trigger>
                            <Tabs.Trigger className={styles['tab-btn']} value="notifications">
                                <Bell size={16} />
                                <span>{t('settings.notifications')}</span>
                            </Tabs.Trigger>
                            <Tabs.Trigger className={styles['tab-btn']} value="rules">
                                <Filter size={16} />
                                <span>{t('settings.rules')}</span>
                            </Tabs.Trigger>
                            <Tabs.Trigger className={styles['tab-btn']} value="templates">
                                <FileText size={16} />
                                <span>{t('settings.templates')}</span>
                            </Tabs.Trigger>
                        </Tabs.List>

                        <Tabs.Content className={styles['settings-tab-panel']} value="accounts" forceMount>
                            {!isAddingAccount && (
                                <div className="accounts-list-view">
                                    <h3 className={styles['section-title']}>{t('settings.emailAccounts')}</h3>
                                    {accounts.length === 0 && (
                                        <div className={styles['empty-accounts']}>
                                            <Mail size={32} />
                                            <p>No accounts connected</p>
                                        </div>
                                    )}
                                    {accounts.map(account => {
                                        const ProviderIcon = getProviderIcon(account.provider);
                                        return (
                                            <div
                                                key={account.id}
                                                className={styles['account-item']}
                                                onClick={() => enterEditMode(account)}
                                                role="button"
                                                tabIndex={0}
                                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') enterEditMode(account); }}
                                                aria-label={`Edit ${account.email}`}
                                            >
                                                <div className={styles['account-item-avatar']}>
                                                    <ProviderIcon size={20} />
                                                </div>
                                                <div className={styles['account-item-info']}>
                                                    <span className={styles['account-item-email']}>{account.email}</span>
                                                    <span className={styles['account-item-provider']}>{providerLabel(account.provider)}</span>
                                                </div>
                                                <button
                                                    className={styles['delete-btn']}
                                                    onClick={(e) => { e.stopPropagation(); handleRemoveAccount(account.id); }}
                                                    title="Remove account"
                                                    aria-label={`Remove ${account.email}`}
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        );
                                    })}
                                    <button className={styles['add-account-btn']} onClick={() => setIsAddingAccount(true)}>
                                        <Plus size={16} />
                                        <span>{t('settings.addAccount')}</span>
                                    </button>
                                </div>
                            )}

                            {isAddingAccount && (
                                <div className="account-form-view">
                                    <h3 className={styles['section-title']}>{isEditing ? t('settings.editAccount') : t('settings.addAccount')}</h3>

                                    {formError && <div className={styles['form-error']} role="alert">{formError}</div>}

                                    <div className={styles['form-group']}>
                                        <label className={styles['form-label']}>Provider</label>
                                        <div className={styles['provider-mini-grid']}>
                                            {PROVIDER_PRESETS.map(preset => {
                                                const PresetIcon = getProviderIcon(preset.id);
                                                return (
                                                    <button
                                                        key={preset.id}
                                                        className={`${styles['provider-chip']} ${selectedPreset?.id === preset.id ? styles['provider-chip-active'] : ''}`}
                                                        onClick={() => selectProvider(preset)}
                                                    >
                                                        <PresetIcon size={18} />
                                                        {preset.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div className={styles['form-group']}>
                                        <label className={styles['form-label']} htmlFor="settings-email">{t('settings.email')}</label>
                                        <input
                                            id="settings-email"
                                            type="email"
                                            className={styles['form-input']}
                                            placeholder="you@example.com"
                                            value={formEmail}
                                            onChange={e => { setFormEmail(e.target.value); resetTestStatus(); }}
                                        />
                                    </div>

                                    <div className={styles['form-group']}>
                                        <label className={styles['form-label']} htmlFor="settings-display-name">{t('settings.displayName')}</label>
                                        <input
                                            id="settings-display-name"
                                            type="text"
                                            className={styles['form-input']}
                                            placeholder="John Doe (optional)"
                                            value={formDisplayName}
                                            onChange={e => setFormDisplayName(e.target.value)}
                                        />
                                    </div>

                                    <div className={styles['form-group']}>
                                        <label className={styles['form-label']} htmlFor="settings-signature">{t('settings.signatureHtml')}</label>
                                        <textarea
                                            id="settings-signature"
                                            className={`${styles['form-input']} ${styles['signature-textarea']}`}
                                            placeholder="Your email signature (plain text, optional)"
                                            value={formSignature}
                                            onChange={e => setFormSignature(e.target.value)}
                                            rows={3}
                                        />
                                    </div>

                                    <div className={styles['form-group']}>
                                        <label className={styles['form-label']} htmlFor="settings-password">{t('settings.password')}</label>
                                        <div className={styles['password-wrapper']}>
                                            <input
                                                id="settings-password"
                                                type={showPassword ? 'text' : 'password'}
                                                className={styles['form-input']}
                                                placeholder={isEditing ? 'Leave blank to keep current' : 'Password or App Password'}
                                                value={formPassword}
                                                onChange={e => { setFormPassword(e.target.value); resetTestStatus(); }}
                                            />
                                            <button
                                                className={styles['password-toggle']}
                                                onClick={() => setShowPassword(!showPassword)}
                                                type="button"
                                                aria-label={showPassword ? 'Hide password' : 'Show password'}
                                            >
                                                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                            </button>
                                        </div>
                                    </div>

                                    {(showServerFields || selectedPreset) && (
                                        <div className={styles['server-fields']}>
                                            <button
                                                type="button"
                                                className={styles['server-header']}
                                                onClick={() => setShowServerFields(!showServerFields)}
                                                aria-expanded={showServerFields}
                                            >
                                                <Server size={14} />
                                                <span>{t('settings.serverSettings')}</span>
                                                <span className={styles['toggle-hint']}>{showServerFields ? 'Hide' : 'Show'}</span>
                                            </button>
                                            {showServerFields && (
                                                <>
                                                    <div className={styles['form-row']}>
                                                        <div className={styles['form-group']}>
                                                            <label className={styles['form-label']} htmlFor="settings-imap-host">{t('settings.imapHost')}</label>
                                                            <input
                                                                id="settings-imap-host"
                                                                type="text"
                                                                className={styles['form-input']}
                                                                placeholder="imap.example.com"
                                                                value={formImapHost}
                                                                onChange={e => { setFormImapHost(e.target.value); resetTestStatus(); }}
                                                            />
                                                        </div>
                                                        <div className={`${styles['form-group']} ${styles['form-group-port']}`}>
                                                            <label className={styles['form-label']} htmlFor="settings-imap-port">Port</label>
                                                            <input
                                                                id="settings-imap-port"
                                                                type="number"
                                                                className={styles['form-input']}
                                                                value={formImapPort}
                                                                min={1}
                                                                max={65535}
                                                                onChange={e => { setFormImapPort(Number(e.target.value)); resetTestStatus(); }}
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className={styles['form-row']}>
                                                        <div className={styles['form-group']}>
                                                            <label className={styles['form-label']} htmlFor="settings-smtp-host">{t('settings.smtpHost')}</label>
                                                            <input
                                                                id="settings-smtp-host"
                                                                type="text"
                                                                className={styles['form-input']}
                                                                placeholder="smtp.example.com"
                                                                value={formSmtpHost}
                                                                onChange={e => { setFormSmtpHost(e.target.value); resetTestStatus(); }}
                                                            />
                                                        </div>
                                                        <div className={`${styles['form-group']} ${styles['form-group-port']}`}>
                                                            <label className={styles['form-label']} htmlFor="settings-smtp-port">Port</label>
                                                            <input
                                                                id="settings-smtp-port"
                                                                type="number"
                                                                className={styles['form-input']}
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

                                    <div className={styles['form-actions']}>
                                        <button
                                            className={`${styles['test-btn']} ${testStatus === 'passed' ? styles['test-passed'] : ''} ${testStatus === 'failed' ? styles['test-failed'] : ''}`}
                                            onClick={handleTestConnection}
                                            disabled={testStatus === 'testing' || !formEmail.trim() || (!formPassword.trim() && !isEditing)}
                                            type="button"
                                        >
                                            {testStatus === 'testing' && <Loader size={14} className={styles['test-spin']} />}
                                            {testStatus === 'passed' && <CheckCircle2 size={14} />}
                                            {testStatus === 'failed' && <XCircle size={14} />}
                                            <span>
                                                {testStatus === 'testing' ? t('settings.testing') :
                                                 testStatus === 'passed' ? t('settings.connected') :
                                                 testStatus === 'failed' ? t('settings.failed') : t('settings.testConnection')}
                                            </span>
                                        </button>
                                        <div style={{ flex: 1 }} />
                                        <button className={styles['secondary-btn']} onClick={resetForm}>{t('settings.cancel')}</button>
                                        <button
                                            className={styles['primary-btn']}
                                            onClick={isEditing ? handleUpdateAccount : handleAddAccount}
                                            disabled={formSaving}
                                        >
                                            {getPrimaryButtonLabel()}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </Tabs.Content>

                        <Tabs.Content className={styles['settings-tab-panel']} value="appearance" forceMount>
                            <div className="appearance-view">
                                <div className={styles['setting-group']}>
                                    <h3 className={styles['section-title']}>Interface Theme</h3>
                                    <div className={styles['options-grid']}>
                                        {THEMES.map(theme => {
                                            const Icon = THEME_ICONS[theme.name];
                                            return (
                                                <button
                                                    key={theme.name}
                                                    className={`${styles['option-btn']} ${themeName === theme.name ? styles['option-btn-active'] : ''}`}
                                                    onClick={() => setTheme(theme.name)}
                                                    aria-pressed={themeName === theme.name}
                                                >
                                                    <Icon size={18} />
                                                    <span>{theme.label}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className={styles['setting-group']}>
                                    <h3 className={styles['section-title']}>Pane Layout</h3>
                                    <div className={styles['options-grid']}>
                                        {LAYOUTS.map(l => (
                                            <button
                                                key={l.id}
                                                className={`${styles['option-btn']} ${layout === l.id ? styles['option-btn-active'] : ''}`}
                                                onClick={() => setLayout(l.id)}
                                                aria-pressed={layout === l.id}
                                            >
                                                <l.icon size={18} />
                                                <span>{l.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className={styles['setting-group']}>
                                    <h3 className={styles['section-title']}>{t('common.language')}</h3>
                                    <select
                                        className={styles['lang-select']}
                                        value={i18n.language}
                                        onChange={e => {
                                            i18n.changeLanguage(e.target.value);
                                            ipcInvoke('settings:set', 'locale', e.target.value);
                                        }}
                                        aria-label={t('common.language')}
                                    >
                                        <option value="en">{t('common.english')}</option>
                                        <option value="fr">Français</option>
                                        <option value="es">Español</option>
                                        <option value="de">Deutsch</option>
                                    </select>
                                </div>
                            </div>
                        </Tabs.Content>

                        <Tabs.Content className={styles['settings-tab-panel']} value="ai" forceMount>
                            <div className={styles['ai-keys-view']}>
                                <h3 className={styles['section-title']}>{t('settings.openrouterKey')}</h3>
                                <p className={styles['apikey-description']}>
                                    {t('settings.openrouterDesc')}
                                </p>

                                <div className={styles['form-group']}>
                                    <label className={styles['form-label']} htmlFor="apikey-input">API Key</label>
                                    <div className={styles['apikey-input-wrapper']}>
                                        <input
                                            id="apikey-input"
                                            className={styles['form-input']}
                                            type={showApiKey ? 'text' : 'password'}
                                            value={apiKey}
                                            onChange={e => { setApiKey(e.target.value); setApiKeyStatus('idle'); }}
                                            placeholder="sk-or-v1-..."
                                            autoComplete="off"
                                        />
                                        <button
                                            type="button"
                                            className={styles['eye-toggle']}
                                            onClick={() => setShowApiKey(!showApiKey)}
                                            aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                                        >
                                            {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    </div>
                                </div>

                                <div className={styles['apikey-actions']} aria-live="polite">
                                    <button
                                        type="button"
                                        className={styles['primary-btn']}
                                        onClick={handleSaveApiKey}
                                        disabled={apiKeySaving || !apiKey.trim()}
                                    >
                                        {apiKeySaving ? 'Saving...' : t('settings.saveKey')}
                                    </button>
                                    <button
                                        type="button"
                                        className={styles['secondary-btn']}
                                        onClick={handleClearApiKey}
                                        disabled={apiKeySaving}
                                    >
                                        {t('settings.clearKey')}
                                    </button>
                                    {apiKeyStatus === 'saved' && (
                                        <span className={`${styles['apikey-status']} ${styles['apikey-saved']}`}>
                                            <CheckCircle2 size={14} /> {t('settings.keySaved')}
                                        </span>
                                    )}
                                    {apiKeyStatus === 'error' && (
                                        <span className={`${styles['apikey-status']} ${styles['apikey-error']}`}>
                                            <XCircle size={14} /> {t('settings.keyFailed')}
                                        </span>
                                    )}
                                </div>

                                <p className={styles['apikey-hint']}>
                                    {t('settings.openrouterHint')}
                                </p>
                            </div>
                        </Tabs.Content>

                        <Tabs.Content className={styles['settings-tab-panel']} value="notifications" forceMount>
                            <div className={styles['notif-settings-view']}>
                                <h3 className={styles['section-title']}>Notification Preferences</h3>
                                <div className={styles['notif-toggle-row']}>
                                    <label htmlFor="notif-enabled-toggle" className={styles['notif-label']}>
                                        {t('settings.desktopNotifications')}
                                    </label>
                                    <button
                                        id="notif-enabled-toggle"
                                        type="button"
                                        role="switch"
                                        aria-checked={notificationsEnabled}
                                        className={`${styles['notif-switch']} ${notificationsEnabled ? styles['notif-switch-on'] : ''}`}
                                        onClick={() => handleToggleNotifications(!notificationsEnabled)}
                                    >
                                        <span className={styles['notif-switch-thumb']} />
                                    </button>
                                </div>
                                <p className={styles['notif-description']}>
                                    {t('settings.notifDescription')}
                                </p>
                            </div>
                        </Tabs.Content>

                        <Tabs.Content className={styles['settings-tab-panel']} value="rules" forceMount>
                            <div className={styles['rules-view']}>
                                <div className={styles['rules-header']}>
                                    <h3 className={styles['section-title']}>{t('settings.mailRules')}</h3>
                                    <button
                                        className={styles['add-rule-btn']}
                                        onClick={() => setEditingRule({
                                            name: '', match_field: 'from', match_operator: 'contains',
                                            match_value: '', action_type: 'mark_read', action_value: null, is_active: 1,
                                        })}
                                    >
                                        <Plus size={14} /> {t('settings.newRule')}
                                    </button>
                                </div>

                                {editingRule && (
                                    <div className={styles['rule-editor']}>
                                        <div className={styles['rule-form-row']}>
                                            <label htmlFor="rule-name">Name</label>
                                            <input
                                                id="rule-name"
                                                className={styles['rule-input']}
                                                value={editingRule.name ?? ''}
                                                onChange={e => setEditingRule({ ...editingRule, name: e.target.value })}
                                                placeholder="Rule name..."
                                            />
                                        </div>
                                        <div className={`${styles['rule-form-row']} ${styles['rule-form-condition']}`}>
                                            <span className={styles['rule-label-text']}>If</span>
                                            <select
                                                className={styles['rule-select']}
                                                value={editingRule.match_field ?? 'from'}
                                                onChange={e => setEditingRule({ ...editingRule, match_field: e.target.value })}
                                                aria-label="Match field"
                                            >
                                                <option value="from">{t('common.from')}</option>
                                                <option value="subject">{t('common.subject')}</option>
                                                <option value="body">{t('common.body')}</option>
                                                <option value="has_attachment">{t('common.hasAttachment')}</option>
                                            </select>
                                            <select
                                                className={styles['rule-select']}
                                                value={editingRule.match_operator ?? 'contains'}
                                                onChange={e => setEditingRule({ ...editingRule, match_operator: e.target.value })}
                                                aria-label="Match operator"
                                            >
                                                <option value="contains">{t('common.contains')}</option>
                                                <option value="equals">{t('common.equals')}</option>
                                                <option value="starts_with">{t('common.startsWith')}</option>
                                                <option value="ends_with">{t('common.endsWith')}</option>
                                            </select>
                                            <input
                                                className={`${styles['rule-input']} ${styles['rule-input-value']}`}
                                                value={editingRule.match_value ?? ''}
                                                onChange={e => setEditingRule({ ...editingRule, match_value: e.target.value })}
                                                placeholder="Value..."
                                                aria-label="Match value"
                                            />
                                        </div>
                                        <div className={`${styles['rule-form-row']} ${styles['rule-form-condition']}`}>
                                            <span className={styles['rule-label-text']}>Then</span>
                                            <select
                                                className={styles['rule-select']}
                                                value={editingRule.action_type ?? 'mark_read'}
                                                onChange={e => setEditingRule({ ...editingRule, action_type: e.target.value, action_value: null })}
                                                aria-label="Action type"
                                            >
                                                <option value="mark_read">{t('common.markRead')}</option>
                                                <option value="flag">{t('common.flag')}</option>
                                                <option value="delete">{t('settings.delete')}</option>
                                                <option value="label">{t('common.addLabel')}</option>
                                                <option value="categorize">{t('common.setCategory')}</option>
                                                <option value="move">{t('common.moveToFolder')}</option>
                                            </select>
                                            {(editingRule.action_type === 'label' || editingRule.action_type === 'categorize' || editingRule.action_type === 'move') && (
                                                <input
                                                    className={`${styles['rule-input']} ${styles['rule-input-value']}`}
                                                    value={editingRule.action_value ?? ''}
                                                    onChange={e => setEditingRule({ ...editingRule, action_value: e.target.value })}
                                                    placeholder={editingRule.action_type === 'move' ? 'Folder ID...' : 'Value...'}
                                                    aria-label="Action value"
                                                />
                                            )}
                                        </div>
                                        {ruleError && <p className={styles['rule-error']} role="alert">{ruleError}</p>}
                                        <div className={styles['rule-form-actions']}>
                                            <button className={styles['secondary-btn']} onClick={() => { setEditingRule(null); setRuleError(null); }}>{t('settings.cancel')}</button>
                                            <button className={styles['primary-btn']} onClick={handleSaveRule}>
                                                {editingRule.id ? t('settings.updateRule') : t('settings.createRule')}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {rules.length === 0 && !editingRule && (
                                    <p className={styles['rules-empty']}>{t('settings.noRules')}</p>
                                )}

                                {rules.map(rule => (
                                    <div key={rule.id} className={`${styles['rule-item']} ${rule.is_active ? '' : styles['rule-item-disabled']}`}>
                                        <div className={styles['rule-item-info']}>
                                            <GripVertical size={14} className={styles['rule-grip']} />
                                            <button
                                                className={styles['rule-toggle']}
                                                role="switch"
                                                aria-checked={!!rule.is_active}
                                                onClick={() => handleToggleRule(rule)}
                                                aria-label={`Toggle rule ${rule.name}`}
                                            >
                                                <span className={`${styles['rule-toggle-dot']} ${rule.is_active ? styles['rule-toggle-on'] : ''}`} />
                                            </button>
                                            <div className={styles['rule-item-text']}>
                                                <span className={styles['rule-name']}>{rule.name}</span>
                                                <span className={styles['rule-desc']}>
                                                    If <strong>{rule.match_field}</strong> {rule.match_operator.replace('_', ' ')} &quot;{rule.match_value}&quot; → {rule.action_type.replace('_', ' ')}
                                                    {rule.action_value ? `: ${rule.action_value}` : ''}
                                                </span>
                                            </div>
                                        </div>
                                        <div className={styles['rule-item-actions']}>
                                            <button
                                                className={styles['icon-btn']}
                                                onClick={() => setEditingRule({ ...rule })}
                                                aria-label={`Edit rule ${rule.name}`}
                                            >
                                                <Pencil size={14} />
                                            </button>
                                            <button
                                                className={`${styles['icon-btn']} ${styles['icon-btn-danger']}`}
                                                onClick={() => handleDeleteRule(rule.id)}
                                                aria-label={`Delete rule ${rule.name}`}
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </Tabs.Content>

                        <Tabs.Content className={styles['settings-tab-panel']} value="templates" forceMount>
                            <div className={styles['rules-view']}>
                                <h3 className={styles['section-title']}>{t('settings.manageTemplates')}</h3>

                                {templateList.map(tpl => (
                                    <div key={tpl.id} className={styles['rule-item']}>
                                        <div className={styles['rule-item-info']}>
                                            <div className={styles['rule-item-text']}>
                                                <span className={styles['rule-name']}>{tpl.name}</span>
                                            </div>
                                        </div>
                                        <div className={styles['rule-item-actions']}>
                                            <button
                                                className={styles['icon-btn']}
                                                onClick={() => setEditingTemplate(tpl)}
                                                aria-label={t('settings.edit')}
                                            >
                                                <Pencil size={14} />
                                            </button>
                                            <button
                                                className={`${styles['icon-btn']} ${styles['icon-btn-danger']}`}
                                                onClick={() => handleDeleteTemplate(tpl.id)}
                                                aria-label={t('settings.delete')}
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))}

                                <button
                                    className={styles['secondary-btn']}
                                    onClick={() => setEditingTemplate({ id: '', name: '', body_html: '' })}
                                    style={{ marginTop: '12px' }}
                                >
                                    <Plus size={14} /> {t('settings.addTemplate')}
                                </button>

                                {editingTemplate && (
                                    <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                        <div className={styles['form-group']}>
                                            <label className={styles['form-label']} htmlFor="template-name">{t('settings.templateName')}</label>
                                            <input
                                                id="template-name"
                                                className={styles['form-input']}
                                                value={editingTemplate.name}
                                                onChange={e => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                                                placeholder={t('settings.templateNamePlaceholder')}
                                            />
                                        </div>
                                        <div className={styles['form-group']}>
                                            <label className={styles['form-label']} htmlFor="template-body">{t('settings.templateBody')}</label>
                                            <textarea
                                                id="template-body"
                                                className={styles['form-input']}
                                                value={editingTemplate.body_html}
                                                onChange={e => setEditingTemplate({ ...editingTemplate, body_html: e.target.value })}
                                                rows={4}
                                                placeholder={t('settings.templateBodyPlaceholder')}
                                            />
                                        </div>
                                        {templateError && <p className={styles['form-error']} role="alert">{templateError}</p>}
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <button className={styles['primary-btn']} onClick={handleSaveTemplate}>{t('settings.save')}</button>
                                            <button className={styles['secondary-btn']} onClick={() => { setEditingTemplate(null); setTemplateError(null); }}>{t('settings.cancel')}</button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </Tabs.Content>
                    </Tabs.Root>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
};
