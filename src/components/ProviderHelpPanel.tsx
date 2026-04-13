import { useState, type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, AlertTriangle, ChevronDown, ChevronRight, ExternalLink, Sparkles } from 'lucide-react';
import { ipcInvoke } from '../lib/ipc';
import type { ProviderPreset, ProviderId } from '../lib/providerPresets';
import styles from './ProviderHelpPanel.module.css';

interface ProviderHelpPanelProps {
    preset: ProviderPreset;
}

// Providers that surface a "Sign in with…" OAuth button in the host
// (Onboarding / SettingsModal). For these, ProviderHelpPanel renders a
// subtle accent banner above the step list pointing the user at the
// faster OAuth path. Gmail keeps the app-password fallback below the
// divider; outlook-personal/business no longer accept passwords.
const OAUTH_BANNER_PROVIDER_IDS: ReadonlySet<ProviderId> = new Set<ProviderId>([
    'gmail',
    'outlook-personal',
    'outlook-business',
]);

const OAUTH_BANNER_NOTE_KEY: Record<string, string> = {
    'gmail': 'oauth.providerHelp.gmailOAuthNote',
    'outlook-personal': 'oauth.providerHelp.outlookPersonalOAuthNote',
    'outlook-business': 'oauth.providerHelp.outlookBusinessOAuthNote',
};

/**
 * Reusable authentication-guidance panel rendered alongside provider selection.
 *
 * Displays (in order):
 *   1. An optional amber warning banner (role="alert") when preset.warningKey is set
 *   2. A one-line short note describing the auth model for this provider
 *   3. A "Show steps" / "Hide steps" disclosure that reveals an ordered list
 *      of step-by-step instructions (only when preset.stepsKey is non-null)
 *   4. An "Open official page" button that invokes shell:open-external with
 *      the preset.helpUrl (only when helpUrl is non-null)
 *
 * Used by OnboardingScreen and SettingsModal's account editor to provide
 * consistent guidance without duplicating the layout in each caller.
 */
export const ProviderHelpPanel: FC<ProviderHelpPanelProps> = ({ preset }) => {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);

    const stepsRaw = preset.stepsKey
        ? t(preset.stepsKey, { returnObjects: true })
        : null;
    const steps = Array.isArray(stepsRaw) ? (stepsRaw as string[]) : null;
    const hasSteps = steps !== null && steps.length > 0;

    const handleOpenHelp = async () => {
        if (!preset.helpUrl) return;
        await ipcInvoke('shell:open-external', { url: preset.helpUrl });
    };

    const showOAuthBanner = OAUTH_BANNER_PROVIDER_IDS.has(preset.id);
    const oauthNoteKey = showOAuthBanner ? OAUTH_BANNER_NOTE_KEY[preset.id] : null;

    return (
        <section
            className={styles['panel']}
            aria-label={t('providerHelp.common.panelAriaLabel', { provider: preset.label })}
        >
            {preset.warningKey && (
                <div className={styles['warning']} role="alert">
                    <AlertTriangle size={16} className={styles['warning-icon']} aria-hidden="true" />
                    <span>{t(preset.warningKey)}</span>
                </div>
            )}

            {showOAuthBanner && oauthNoteKey && (
                <div className={styles['oauth-banner']}>
                    <Sparkles size={16} className={styles['oauth-banner-icon']} aria-hidden="true" />
                    <div className={styles['oauth-banner-content']}>
                        <span className={styles['oauth-banner-title']}>
                            {t('oauth.providerHelp.bannerTitle')}
                        </span>
                        <span>{t(oauthNoteKey)}</span>
                    </div>
                </div>
            )}

            <div className={styles['note']}>
                <Info size={16} className={styles['note-icon']} aria-hidden="true" />
                <span>{t(preset.shortNoteKey)}</span>
            </div>

            <div className={styles['actions']}>
                {hasSteps && (
                    <button
                        type="button"
                        className={styles['disclosure-button']}
                        onClick={() => setOpen(prev => !prev)}
                        aria-expanded={open}
                    >
                        {open ? (
                            <ChevronDown size={14} aria-hidden="true" />
                        ) : (
                            <ChevronRight size={14} aria-hidden="true" />
                        )}
                        {open
                            ? t('providerHelp.common.hideSteps')
                            : t('providerHelp.common.showSteps')}
                    </button>
                )}

                {open && hasSteps && steps && (
                    <ol className={styles['steps']}>
                        {steps.map((step, i) => (
                            <li key={i}>{step}</li>
                        ))}
                    </ol>
                )}

                {preset.helpUrl && (
                    <button
                        type="button"
                        className={styles['help-button']}
                        onClick={handleOpenHelp}
                    >
                        <ExternalLink size={14} aria-hidden="true" />
                        {t('providerHelp.common.openHelpPage')}
                    </button>
                )}
            </div>
        </section>
    );
};
