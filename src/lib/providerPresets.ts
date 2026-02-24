export interface ProviderPreset {
    id: string
    label: string
    imapHost: string
    imapPort: number
    smtpHost: string
    smtpPort: number
    notes?: string
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
    {
        id: 'gmail',
        label: 'Gmail',
        imapHost: 'imap.gmail.com',
        imapPort: 993,
        smtpHost: 'smtp.gmail.com',
        smtpPort: 465,
        notes: 'Requires an App Password (enable 2FA first)',
    },
    {
        id: 'outlook',
        label: 'Outlook / Hotmail',
        imapHost: 'outlook.office365.com',
        imapPort: 993,
        smtpHost: 'smtp.office365.com',
        smtpPort: 587,
        notes: 'Use your Microsoft account password or App Password',
    },
    {
        id: 'yahoo',
        label: 'Yahoo Mail',
        imapHost: 'imap.mail.yahoo.com',
        imapPort: 993,
        smtpHost: 'smtp.mail.yahoo.com',
        smtpPort: 465,
        notes: 'Generate an App Password in Yahoo account settings',
    },
    {
        id: 'icloud',
        label: 'iCloud Mail',
        imapHost: 'imap.mail.me.com',
        imapPort: 993,
        smtpHost: 'smtp.mail.me.com',
        smtpPort: 587,
        notes: 'Requires an App-Specific Password',
    },
    {
        id: 'custom',
        label: 'Other / Custom',
        imapHost: '',
        imapPort: 993,
        smtpHost: '',
        smtpPort: 465,
    },
]
