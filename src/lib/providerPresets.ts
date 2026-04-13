export type ProviderId =
    | 'gmail'
    | 'outlook-personal'
    | 'outlook-business'
    | 'outlook-legacy'
    | 'yahoo'
    | 'icloud'
    | 'custom';

export type AuthModel =
    | 'password-supported'
    | 'oauth2-required'
    | 'oauth2-supported'
    | 'password'
    | 'legacy';

export interface ProviderPreset {
    id: ProviderId;
    label: string;
    imapHost: string;
    imapPort: number;
    smtpHost: string;
    smtpPort: number;
    authModel: AuthModel;
    shortNoteKey: string;
    stepsKey: string | null;
    helpUrl: string | null;
    warningKey: string | null;
    comingSoonMessageKey: string | null;
}

// Exact-URL allowlist source of truth. Imported by the renderer (for
// ProviderHelpPanel) and by electron/main.ts (for the shell:open-external
// handler). See docs/superpowers/specs/2026-04-12-phase1-provider-auth-guidance-design.md §7.3.
export const HELP_URLS: readonly string[] = [
    'https://support.google.com/mail/answer/185833',
    'https://support.microsoft.com/en-us/office/pop-imap-and-smtp-settings-for-outlook-com-d088b986-291d-42b8-9564-9c414e2aa040',
    'https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth',
    'https://help.yahoo.com/kb/SLN15241.html',
    'https://support.apple.com/en-us/102654',
] as const;

export const PROVIDER_PRESETS: ProviderPreset[] = [
    {
        id: 'gmail',
        label: 'Gmail',
        imapHost: 'imap.gmail.com',
        imapPort: 993,
        smtpHost: 'smtp.gmail.com',
        smtpPort: 465,
        authModel: 'password-supported',
        shortNoteKey: 'providerHelp.gmail.shortNote',
        stepsKey: 'providerHelp.gmail.steps',
        helpUrl: 'https://support.google.com/mail/answer/185833',
        warningKey: null,
        comingSoonMessageKey: null,
    },
    {
        id: 'outlook-personal',
        label: 'Outlook.com (Personal)',
        imapHost: 'outlook.office365.com',
        imapPort: 993,
        smtpHost: 'smtp-mail.outlook.com',
        smtpPort: 587,
        // Phase 2: was 'oauth2-required' (disabled state in Phase 1).
        // Now OAuth2 is implemented, so the preset surfaces a live sign-in
        // button in OnboardingScreen + SettingsModal via OAuthSignInButton.
        authModel: 'oauth2-supported',
        shortNoteKey: 'oauth.providerHelp.outlookPersonalShortNote',
        stepsKey: 'providerPresets.outlookPersonal.oauthSteps',
        helpUrl: 'https://support.microsoft.com/en-us/office/pop-imap-and-smtp-settings-for-outlook-com-d088b986-291d-42b8-9564-9c414e2aa040',
        warningKey: null,
        comingSoonMessageKey: null,
    },
    {
        id: 'outlook-business',
        label: 'Microsoft 365 (Work/School)',
        imapHost: 'outlook.office365.com',
        imapPort: 993,
        smtpHost: 'smtp.office365.com',
        smtpPort: 587,
        // Phase 2: same migration as outlook-personal — OAuth2 now live.
        authModel: 'oauth2-supported',
        shortNoteKey: 'oauth.providerHelp.outlookBusinessShortNote',
        stepsKey: 'providerPresets.outlookBusiness.oauthSteps',
        helpUrl: 'https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth',
        warningKey: null,
        comingSoonMessageKey: null,
    },
    {
        id: 'yahoo',
        label: 'Yahoo Mail',
        imapHost: 'imap.mail.yahoo.com',
        imapPort: 993,
        smtpHost: 'smtp.mail.yahoo.com',
        smtpPort: 465,
        authModel: 'password-supported',
        shortNoteKey: 'providerHelp.yahoo.shortNote',
        stepsKey: 'providerHelp.yahoo.steps',
        helpUrl: 'https://help.yahoo.com/kb/SLN15241.html',
        warningKey: null,
        comingSoonMessageKey: null,
    },
    {
        id: 'icloud',
        label: 'iCloud Mail',
        imapHost: 'imap.mail.me.com',
        imapPort: 993,
        smtpHost: 'smtp.mail.me.com',
        smtpPort: 587,
        authModel: 'password-supported',
        shortNoteKey: 'providerHelp.icloud.shortNote',
        stepsKey: 'providerHelp.icloud.steps',
        helpUrl: 'https://support.apple.com/en-us/102654',
        warningKey: null,
        comingSoonMessageKey: null,
    },
    {
        id: 'custom',
        label: 'Other / Custom',
        imapHost: '',
        imapPort: 993,
        smtpHost: '',
        smtpPort: 465,
        authModel: 'password',
        shortNoteKey: 'providerHelp.custom.shortNote',
        stepsKey: null,
        helpUrl: null,
        warningKey: null,
        comingSoonMessageKey: null,
    },
];

// Invisible preset used only when resolving existing accounts whose stored
// provider column still reads 'outlook' (the pre-Phase-1 value). Never shown
// in the provider grid — explicitly excluded from PROVIDER_PRESETS.
export const OUTLOOK_LEGACY_PRESET: ProviderPreset = {
    id: 'outlook-legacy',
    label: 'Outlook (Legacy)',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    authModel: 'legacy',
    shortNoteKey: 'providerHelp.outlookLegacy.shortNote',
    stepsKey: null,
    helpUrl: null,
    // Phase 2: warning text now points at the migration-to-OAuth message
    // ("Microsoft is removing password-based SMTP. Sign in again to modernize…")
    // rendered inside ProviderHelpPanel for the invisible legacy preset.
    warningKey: 'oauth.providerHelp.legacyReauthWarning',
    comingSoonMessageKey: null,
};

/**
 * Resolve a preset from a stored account's provider column. Legacy 'outlook'
 * values map to OUTLOOK_LEGACY_PRESET. Unknown values fall back to 'custom'.
 */
export function getPresetForAccount(account: { provider: string }): ProviderPreset {
    if (account.provider === 'outlook') return OUTLOOK_LEGACY_PRESET;
    const match = PROVIDER_PRESETS.find(p => p.id === account.provider);
    return match ?? PROVIDER_PRESETS.find(p => p.id === 'custom')!;
}
