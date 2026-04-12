# Phase 1 Provider Auth Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stale "enter a password" onboarding for Gmail/Outlook/Yahoo/iCloud with accurate, provider-specific guidance (note + collapsible steps + official help link) and disable the new-account path for Outlook presets until Phase 2 OAuth2 ships.

**Architecture:** One reusable `ProviderHelpPanel` component rendered in both `OnboardingScreen` and `SettingsModal`. The existing `ProviderPreset` interface is extended with `authModel`, i18n keys, and an exact-URL help link. An invisible `outlook-legacy` preset resolves existing `accounts.provider === 'outlook'` rows in the settings edit flow without any DB migration. A new `shell:open-external` IPC handler backed by an exact-URL allowlist opens the official help pages.

**Tech Stack:** React 19 + TypeScript 5.9 strict, Radix `Collapsible`, react-i18next (4 locales), Electron IPC, Vitest 4 + @testing-library/react. See CLAUDE.md for codebase conventions. See spec: `docs/superpowers/specs/2026-04-12-phase1-provider-auth-guidance-design.md`.

**Tests are co-located with source** — `src/components/Foo.tsx` is tested by `src/components/Foo.test.tsx`. There is no `__tests__/` subdirectory convention in this repo.

---

## Task 1: Extend `ProviderPreset` and presets (data layer)

**Files:**
- Modify: `src/lib/providerPresets.ts` (full rewrite — currently 56 lines, new version ~120 lines)
- Test: `src/lib/providerPresets.test.ts` (new)

This task is TDD: write the test first, then implement the data.

- [ ] **Step 1: Write the failing test**

Create `src/lib/providerPresets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
    PROVIDER_PRESETS,
    OUTLOOK_LEGACY_PRESET,
    HELP_URLS,
    getPresetForAccount,
} from './providerPresets';

describe('providerPresets', () => {
    it('exposes exactly 6 visible presets in PROVIDER_PRESETS', () => {
        expect(PROVIDER_PRESETS).toHaveLength(6);
        const ids = PROVIDER_PRESETS.map(p => p.id);
        expect(ids).toEqual([
            'gmail',
            'outlook-personal',
            'outlook-business',
            'yahoo',
            'icloud',
            'custom',
        ]);
    });

    it('does not include outlook-legacy in the visible grid', () => {
        expect(PROVIDER_PRESETS.find(p => p.id === 'outlook-legacy')).toBeUndefined();
    });

    it('exports outlook-legacy as a standalone preset', () => {
        expect(OUTLOOK_LEGACY_PRESET.id).toBe('outlook-legacy');
        expect(OUTLOOK_LEGACY_PRESET.authModel).toBe('legacy');
        expect(OUTLOOK_LEGACY_PRESET.helpUrl).toBeNull();
        expect(OUTLOOK_LEGACY_PRESET.stepsKey).toBeNull();
    });

    it('gmail preset has correct host/port and password-supported auth model', () => {
        const gmail = PROVIDER_PRESETS.find(p => p.id === 'gmail')!;
        expect(gmail.imapHost).toBe('imap.gmail.com');
        expect(gmail.imapPort).toBe(993);
        expect(gmail.smtpHost).toBe('smtp.gmail.com');
        expect(gmail.smtpPort).toBe(465);
        expect(gmail.authModel).toBe('password-supported');
    });

    it('outlook-personal uses smtp-mail.outlook.com and oauth2-required', () => {
        const p = PROVIDER_PRESETS.find(preset => preset.id === 'outlook-personal')!;
        expect(p.imapHost).toBe('outlook.office365.com');
        expect(p.smtpHost).toBe('smtp-mail.outlook.com');
        expect(p.smtpPort).toBe(587);
        expect(p.authModel).toBe('oauth2-required');
        expect(p.warningKey).not.toBeNull();
    });

    it('outlook-business uses smtp.office365.com and oauth2-required', () => {
        const p = PROVIDER_PRESETS.find(preset => preset.id === 'outlook-business')!;
        expect(p.smtpHost).toBe('smtp.office365.com');
        expect(p.smtpPort).toBe(587);
        expect(p.authModel).toBe('oauth2-required');
    });

    it('yahoo and icloud are password-supported', () => {
        const yahoo = PROVIDER_PRESETS.find(p => p.id === 'yahoo')!;
        const icloud = PROVIDER_PRESETS.find(p => p.id === 'icloud')!;
        expect(yahoo.authModel).toBe('password-supported');
        expect(icloud.authModel).toBe('password-supported');
        expect(yahoo.smtpPort).toBe(465);
        expect(icloud.smtpPort).toBe(587);
    });

    it('custom preset is unopinionated', () => {
        const custom = PROVIDER_PRESETS.find(p => p.id === 'custom')!;
        expect(custom.authModel).toBe('password');
        expect(custom.helpUrl).toBeNull();
        expect(custom.stepsKey).toBeNull();
    });

    it('HELP_URLS contains exactly 5 entries matching preset helpUrls', () => {
        expect(HELP_URLS).toHaveLength(5);
        const presetHelpUrls = PROVIDER_PRESETS
            .map(p => p.helpUrl)
            .filter((u): u is string => u !== null);
        expect(new Set(HELP_URLS)).toEqual(new Set(presetHelpUrls));
    });

    describe('getPresetForAccount', () => {
        it('maps legacy outlook value to outlook-legacy preset', () => {
            const result = getPresetForAccount({ provider: 'outlook' });
            expect(result.id).toBe('outlook-legacy');
        });

        it('maps new outlook-personal value to outlook-personal preset', () => {
            const result = getPresetForAccount({ provider: 'outlook-personal' });
            expect(result.id).toBe('outlook-personal');
        });

        it('maps known provider id to its preset', () => {
            expect(getPresetForAccount({ provider: 'gmail' }).id).toBe('gmail');
            expect(getPresetForAccount({ provider: 'yahoo' }).id).toBe('yahoo');
            expect(getPresetForAccount({ provider: 'icloud' }).id).toBe('icloud');
        });

        it('maps unknown provider to custom preset', () => {
            expect(getPresetForAccount({ provider: 'fastmail' }).id).toBe('custom');
            expect(getPresetForAccount({ provider: '' }).id).toBe('custom');
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- providerPresets`
Expected: FAIL — imports for `OUTLOOK_LEGACY_PRESET`, `HELP_URLS`, `getPresetForAccount`, and the new shape do not yet exist.

- [ ] **Step 3: Implement the rewritten `providerPresets.ts`**

Replace the entire contents of `src/lib/providerPresets.ts`:

```ts
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
        authModel: 'oauth2-required',
        shortNoteKey: 'providerHelp.outlookPersonal.shortNote',
        stepsKey: null,
        helpUrl: 'https://support.microsoft.com/en-us/office/pop-imap-and-smtp-settings-for-outlook-com-d088b986-291d-42b8-9564-9c414e2aa040',
        warningKey: 'providerHelp.outlookPersonal.warning',
        comingSoonMessageKey: 'providerHelp.outlookPersonal.comingSoonMessage',
    },
    {
        id: 'outlook-business',
        label: 'Microsoft 365 (Work/School)',
        imapHost: 'outlook.office365.com',
        imapPort: 993,
        smtpHost: 'smtp.office365.com',
        smtpPort: 587,
        authModel: 'oauth2-required',
        shortNoteKey: 'providerHelp.outlookBusiness.shortNote',
        stepsKey: null,
        helpUrl: 'https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth',
        warningKey: null,
        comingSoonMessageKey: 'providerHelp.outlookBusiness.comingSoonMessage',
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
    warningKey: 'providerHelp.outlookLegacy.warning',
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- providerPresets`
Expected: PASS — all 13 assertions.

- [ ] **Step 5: Commit**

```bash
git add src/lib/providerPresets.ts src/lib/providerPresets.test.ts
git commit -m "feat(providers): extend preset model with auth guidance metadata"
```

---

## Task 2: `shell:open-external` IPC handler with URL allowlist

**Files:**
- Modify: `electron/main.ts` (add handler)
- Modify: `electron/preload.ts` (add channel to allowlist)
- Test: `electron/shellOpen.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `electron/shellOpen.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HELP_URLS } from '../src/lib/providerPresets';

// Hoisted mocks so they are ready before we import the handler factory
const { mockOpenExternal, mockLogDebug } = vi.hoisted(() => ({
    mockOpenExternal: vi.fn().mockResolvedValue(undefined),
    mockLogDebug: vi.fn(),
}));

vi.mock('electron', () => ({
    shell: { openExternal: mockOpenExternal },
}));

vi.mock('./logger.js', () => ({
    logDebug: mockLogDebug,
}));

// The handler is exported as a pure function for testability
import { handleShellOpenExternal } from './shellOpen';

describe('shell:open-external handler', () => {
    beforeEach(() => {
        mockOpenExternal.mockClear();
        mockLogDebug.mockClear();
    });

    it('accepts every URL in HELP_URLS', async () => {
        for (const url of HELP_URLS) {
            mockOpenExternal.mockClear();
            const result = await handleShellOpenExternal({ url });
            expect(result).toEqual({ success: true });
            expect(mockOpenExternal).toHaveBeenCalledWith(url);
        }
    });

    it('rejects a URL that is not in the allowlist', async () => {
        const result = await handleShellOpenExternal({ url: 'https://evil.example.com/' });
        expect(result.success).toBe(false);
        expect(result.error).toBe('URL not allowlisted');
        expect(mockOpenExternal).not.toHaveBeenCalled();
        expect(mockLogDebug).toHaveBeenCalled();
    });

    it('rejects a missing url argument', async () => {
        // @ts-expect-error intentionally missing
        const result = await handleShellOpenExternal({});
        expect(result.success).toBe(false);
        expect(mockOpenExternal).not.toHaveBeenCalled();
    });

    it('rejects a non-string url argument', async () => {
        // @ts-expect-error intentionally wrong type
        const result = await handleShellOpenExternal({ url: 123 });
        expect(result.success).toBe(false);
        expect(mockOpenExternal).not.toHaveBeenCalled();
    });

    it('returns success:false on openExternal rejection', async () => {
        mockOpenExternal.mockRejectedValueOnce(new Error('boom'));
        const result = await handleShellOpenExternal({ url: HELP_URLS[0] });
        expect(result.success).toBe(false);
        expect(result.error).toBe('Failed to open URL');
        expect(mockLogDebug).toHaveBeenCalled();
    });

    it('rejects a URL with trailing whitespace (exact match semantics)', async () => {
        const result = await handleShellOpenExternal({ url: HELP_URLS[0] + ' ' });
        expect(result.success).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- shellOpen`
Expected: FAIL — `./shellOpen` module does not exist.

- [ ] **Step 3: Implement the handler module**

Create `electron/shellOpen.ts`:

```ts
import { shell } from 'electron';
import { HELP_URLS } from '../src/lib/providerPresets.js';
import { logDebug } from './logger.js';

const ALLOWED_HELP_URLS: ReadonlySet<string> = new Set(HELP_URLS);

export interface ShellOpenResult {
    success: boolean;
    error?: string;
}

export async function handleShellOpenExternal(
    args: { url?: unknown },
): Promise<ShellOpenResult> {
    const url = args?.url;
    if (typeof url !== 'string' || !ALLOWED_HELP_URLS.has(url)) {
        logDebug('shell:open-external rejected', { url });
        return { success: false, error: 'URL not allowlisted' };
    }
    try {
        await shell.openExternal(url);
        return { success: true };
    } catch (err) {
        logDebug('shell:open-external failed', { err: String(err) });
        return { success: false, error: 'Failed to open URL' };
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- shellOpen`
Expected: PASS — 6 assertions.

- [ ] **Step 5: Wire the handler into `electron/main.ts`**

Add near the other `ipcMain.handle` registrations. Find an existing block like `ipcMain.handle('app:get-version', ...)` and add after it:

```ts
// Imports at top of file:
import { handleShellOpenExternal } from './shellOpen.js';

// Handler registration (near other ipcMain.handle calls):
ipcMain.handle('shell:open-external', async (_event, args: { url?: unknown }) => {
    return handleShellOpenExternal(args);
});
```

- [ ] **Step 6: Add the channel to preload allowlist**

In `electron/preload.ts`, add `'shell:open-external'` to `ALLOWED_INVOKE_CHANNELS`. Insert alphabetically near the other `shell:`/`settings:` family (place it after `'searches:run'` or wherever alphabetical order fits — the array is grouped semantically, so put it under a new comment):

```ts
// Find the Phase 12.5 window-controls block and insert BEFORE it:
// External link opener (exact-URL allowlisted in main process)
'shell:open-external',
// Phase 12.5: Window controls + app info (frameless window)
'window:minimize',
```

- [ ] **Step 7: Run build to verify TypeScript accepts the wiring**

Run: `npm run lint`
Expected: zero warnings. If TypeScript complains about the channel literal type, verify `ALLOWED_INVOKE_CHANNELS` literal-array derivation still works.

- [ ] **Step 8: Commit**

```bash
git add electron/shellOpen.ts electron/shellOpen.test.ts electron/main.ts electron/preload.ts
git commit -m "feat(ipc): add shell:open-external handler with exact-URL allowlist"
```

---

## Task 3: Add i18n strings to all four locales

**Files:**
- Modify: `src/locales/en.json`
- Modify: `src/locales/fr.json`
- Modify: `src/locales/es.json`
- Modify: `src/locales/de.json`

No test for this task — the keys are exercised by downstream component tests in Tasks 4-7.

- [ ] **Step 1: Add `providerHelp` block to `en.json`**

Add this top-level key to `src/locales/en.json` (merge with existing keys, do not replace):

```json
{
    "providerHelp": {
        "common": {
            "showSteps": "Show steps",
            "hideSteps": "Hide steps",
            "openHelpPage": "Open official page",
            "oauth2NotSupported": "OAuth2 sign-in is not supported yet in this app.",
            "useCustomInstead": "Use Other / Custom only if your organization still allows password-based IMAP/SMTP."
        },
        "gmail": {
            "shortNote": "Gmail accepts App Passwords for personal accounts with 2-Step Verification enabled. OAuth2 sign-in is the preferred long-term path and is planned for a future update.",
            "steps": [
                "Sign in to your Google Account at myaccount.google.com",
                "Open Security, then turn on 2-Step Verification if it is not already on",
                "Under Security, open App passwords (or search for it)",
                "Generate a new app password labeled 'ExpressDelivery'",
                "Copy the 16-character password and paste it into the password field here"
            ]
        },
        "outlookPersonal": {
            "warning": "Microsoft is removing password-based SMTP on personal Outlook.com accounts in April 2026. New accounts cannot be added with a password.",
            "shortNote": "Outlook.com personal accounts require OAuth2 sign-in, which this app does not support yet.",
            "comingSoonMessage": "New Outlook.com accounts cannot be added yet. OAuth2 sign-in is planned for a future update. Use Other / Custom only if your organization still allows password-based IMAP/SMTP."
        },
        "outlookBusiness": {
            "shortNote": "Microsoft 365 (Work/School) accounts require OAuth2 / Modern Auth, which this app does not support yet.",
            "comingSoonMessage": "New Microsoft 365 accounts cannot be added yet. OAuth2 sign-in is planned for a future update. Use Other / Custom only if your organization still allows password-based IMAP/SMTP."
        },
        "outlookLegacy": {
            "warning": "Outlook accounts now require OAuth2 sign-in. This account was added before that change and may stop working on or after April 30, 2026.",
            "shortNote": "This is an existing Outlook account using Basic Authentication. You can still edit its settings, but new Outlook accounts must wait for OAuth2 support."
        },
        "yahoo": {
            "shortNote": "Yahoo requires a generated app password. Your regular Yahoo account password will not work here.",
            "steps": [
                "Sign in to your Yahoo Account Security page at login.yahoo.com/account/security",
                "Turn on 2-step verification if it is not already on",
                "Select 'Generate app password' (or 'Manage app passwords')",
                "Name the app 'ExpressDelivery' and click Generate",
                "Copy the generated password and paste it into the password field here"
            ]
        },
        "icloud": {
            "shortNote": "iCloud requires an app-specific password. Your regular Apple Account password will not work here.",
            "steps": [
                "Sign in to your Apple Account at account.apple.com",
                "In Sign-In and Security, select App-Specific Passwords",
                "Click Generate an App-Specific Password and name it 'ExpressDelivery'",
                "Copy the generated password and paste it into the password field here"
            ]
        },
        "custom": {
            "shortNote": "Enter the IMAP and SMTP settings provided by your email host. Most providers that still support password-based IMAP/SMTP will work here."
        }
    }
}
```

- [ ] **Step 2: Add equivalent block to `fr.json`**

Merge this into `src/locales/fr.json`:

```json
{
    "providerHelp": {
        "common": {
            "showSteps": "Afficher les étapes",
            "hideSteps": "Masquer les étapes",
            "openHelpPage": "Ouvrir la page officielle",
            "oauth2NotSupported": "La connexion OAuth2 n'est pas encore prise en charge par cette application.",
            "useCustomInstead": "N'utilisez Autre / Personnalisé que si votre organisation autorise encore l'IMAP/SMTP par mot de passe."
        },
        "gmail": {
            "shortNote": "Gmail accepte les mots de passe d'application pour les comptes personnels avec la validation en deux étapes activée. OAuth2 est la méthode préférée à long terme et est prévu pour une future mise à jour.",
            "steps": [
                "Connectez-vous à votre compte Google sur myaccount.google.com",
                "Ouvrez Sécurité, puis activez la validation en deux étapes si ce n'est pas déjà fait",
                "Sous Sécurité, ouvrez Mots de passe d'application",
                "Générez un nouveau mot de passe d'application nommé « ExpressDelivery »",
                "Copiez le mot de passe à 16 caractères et collez-le dans le champ mot de passe ici"
            ]
        },
        "outlookPersonal": {
            "warning": "Microsoft supprime le SMTP par mot de passe sur les comptes Outlook.com personnels en avril 2026. Les nouveaux comptes ne peuvent pas être ajoutés avec un mot de passe.",
            "shortNote": "Les comptes Outlook.com personnels nécessitent une connexion OAuth2, qui n'est pas encore prise en charge par cette application.",
            "comingSoonMessage": "Les nouveaux comptes Outlook.com ne peuvent pas encore être ajoutés. La connexion OAuth2 est prévue pour une future mise à jour. N'utilisez Autre / Personnalisé que si votre organisation autorise encore l'IMAP/SMTP par mot de passe."
        },
        "outlookBusiness": {
            "shortNote": "Les comptes Microsoft 365 (professionnel ou scolaire) nécessitent OAuth2 / Authentification moderne, qui n'est pas encore prise en charge par cette application.",
            "comingSoonMessage": "Les nouveaux comptes Microsoft 365 ne peuvent pas encore être ajoutés. La connexion OAuth2 est prévue pour une future mise à jour. N'utilisez Autre / Personnalisé que si votre organisation autorise encore l'IMAP/SMTP par mot de passe."
        },
        "outlookLegacy": {
            "warning": "Les comptes Outlook nécessitent désormais une connexion OAuth2. Ce compte a été ajouté avant ce changement et pourrait cesser de fonctionner à partir du 30 avril 2026.",
            "shortNote": "Ce compte Outlook existant utilise l'authentification de base. Vous pouvez toujours modifier ses paramètres, mais les nouveaux comptes Outlook doivent attendre la prise en charge OAuth2."
        },
        "yahoo": {
            "shortNote": "Yahoo exige un mot de passe d'application généré. Votre mot de passe Yahoo habituel ne fonctionnera pas ici.",
            "steps": [
                "Connectez-vous à la page Sécurité du compte Yahoo sur login.yahoo.com/account/security",
                "Activez la validation en deux étapes si ce n'est pas déjà fait",
                "Sélectionnez « Générer un mot de passe d'application » (ou « Gérer les mots de passe d'application »)",
                "Nommez l'application « ExpressDelivery » et cliquez sur Générer",
                "Copiez le mot de passe généré et collez-le dans le champ mot de passe ici"
            ]
        },
        "icloud": {
            "shortNote": "iCloud exige un mot de passe spécifique à l'application. Votre mot de passe Apple habituel ne fonctionnera pas ici.",
            "steps": [
                "Connectez-vous à votre compte Apple sur account.apple.com",
                "Dans Connexion et sécurité, sélectionnez Mots de passe spécifiques à l'application",
                "Cliquez sur Générer un mot de passe spécifique à l'application et nommez-le « ExpressDelivery »",
                "Copiez le mot de passe généré et collez-le dans le champ mot de passe ici"
            ]
        },
        "custom": {
            "shortNote": "Entrez les paramètres IMAP et SMTP fournis par votre fournisseur de messagerie. La plupart des fournisseurs qui prennent encore en charge l'IMAP/SMTP par mot de passe fonctionneront ici."
        }
    }
}
```

- [ ] **Step 3: Add equivalent block to `es.json`**

Merge this into `src/locales/es.json`:

```json
{
    "providerHelp": {
        "common": {
            "showSteps": "Mostrar pasos",
            "hideSteps": "Ocultar pasos",
            "openHelpPage": "Abrir página oficial",
            "oauth2NotSupported": "El inicio de sesión OAuth2 aún no es compatible con esta aplicación.",
            "useCustomInstead": "Use Otro / Personalizado solo si su organización todavía permite IMAP/SMTP con contraseña."
        },
        "gmail": {
            "shortNote": "Gmail acepta contraseñas de aplicación para cuentas personales con la verificación en dos pasos activada. OAuth2 es el método preferido a largo plazo y está previsto para una actualización futura.",
            "steps": [
                "Inicie sesión en su Cuenta de Google en myaccount.google.com",
                "Abra Seguridad y active la verificación en dos pasos si aún no está activa",
                "En Seguridad, abra Contraseñas de aplicación",
                "Genere una nueva contraseña de aplicación con el nombre 'ExpressDelivery'",
                "Copie la contraseña de 16 caracteres y péguela en el campo de contraseña aquí"
            ]
        },
        "outlookPersonal": {
            "warning": "Microsoft está eliminando el SMTP con contraseña en las cuentas personales de Outlook.com en abril de 2026. Las cuentas nuevas no pueden agregarse con contraseña.",
            "shortNote": "Las cuentas personales de Outlook.com requieren inicio de sesión OAuth2, que esta aplicación aún no admite.",
            "comingSoonMessage": "Las nuevas cuentas de Outlook.com todavía no pueden agregarse. El inicio de sesión OAuth2 está previsto para una actualización futura. Use Otro / Personalizado solo si su organización todavía permite IMAP/SMTP con contraseña."
        },
        "outlookBusiness": {
            "shortNote": "Las cuentas de Microsoft 365 (trabajo o escuela) requieren OAuth2 / Autenticación moderna, que esta aplicación aún no admite.",
            "comingSoonMessage": "Las nuevas cuentas de Microsoft 365 todavía no pueden agregarse. El inicio de sesión OAuth2 está previsto para una actualización futura. Use Otro / Personalizado solo si su organización todavía permite IMAP/SMTP con contraseña."
        },
        "outlookLegacy": {
            "warning": "Las cuentas de Outlook ahora requieren inicio de sesión OAuth2. Esta cuenta se agregó antes de ese cambio y puede dejar de funcionar a partir del 30 de abril de 2026.",
            "shortNote": "Esta es una cuenta de Outlook existente con autenticación básica. Aún puede editar sus ajustes, pero las cuentas nuevas de Outlook deben esperar al soporte de OAuth2."
        },
        "yahoo": {
            "shortNote": "Yahoo requiere una contraseña de aplicación generada. Su contraseña habitual de Yahoo no funcionará aquí.",
            "steps": [
                "Inicie sesión en la página de Seguridad de la cuenta de Yahoo en login.yahoo.com/account/security",
                "Active la verificación en dos pasos si aún no está activa",
                "Seleccione 'Generar contraseña de aplicación' (o 'Administrar contraseñas de aplicación')",
                "Nombre la aplicación 'ExpressDelivery' y haga clic en Generar",
                "Copie la contraseña generada y péguela en el campo de contraseña aquí"
            ]
        },
        "icloud": {
            "shortNote": "iCloud requiere una contraseña específica para la aplicación. Su contraseña habitual de Apple no funcionará aquí.",
            "steps": [
                "Inicie sesión en su Cuenta Apple en account.apple.com",
                "En Inicio de sesión y seguridad, seleccione Contraseñas específicas de la aplicación",
                "Haga clic en Generar una contraseña específica de la aplicación y nómbrela 'ExpressDelivery'",
                "Copie la contraseña generada y péguela en el campo de contraseña aquí"
            ]
        },
        "custom": {
            "shortNote": "Introduzca los ajustes de IMAP y SMTP que le proporcione su proveedor de correo. La mayoría de los proveedores que aún admiten IMAP/SMTP con contraseña funcionarán aquí."
        }
    }
}
```

- [ ] **Step 4: Add equivalent block to `de.json`**

Merge this into `src/locales/de.json`:

```json
{
    "providerHelp": {
        "common": {
            "showSteps": "Schritte anzeigen",
            "hideSteps": "Schritte ausblenden",
            "openHelpPage": "Offizielle Seite öffnen",
            "oauth2NotSupported": "OAuth2-Anmeldung wird von dieser App noch nicht unterstützt.",
            "useCustomInstead": "Verwenden Sie Andere / Benutzerdefiniert nur, wenn Ihre Organisation passwortbasiertes IMAP/SMTP noch erlaubt."
        },
        "gmail": {
            "shortNote": "Gmail akzeptiert App-Passwörter für persönliche Konten mit aktivierter Bestätigung in zwei Schritten. OAuth2-Anmeldung ist der langfristig bevorzugte Weg und ist für ein zukünftiges Update geplant.",
            "steps": [
                "Melden Sie sich unter myaccount.google.com in Ihrem Google-Konto an",
                "Öffnen Sie Sicherheit und aktivieren Sie die Bestätigung in zwei Schritten, falls noch nicht aktiv",
                "Öffnen Sie unter Sicherheit den Bereich App-Passwörter",
                "Erstellen Sie ein neues App-Passwort mit dem Namen „ExpressDelivery“",
                "Kopieren Sie das 16-stellige Passwort und fügen Sie es hier im Passwortfeld ein"
            ]
        },
        "outlookPersonal": {
            "warning": "Microsoft entfernt im April 2026 die passwortbasierte SMTP-Anmeldung für persönliche Outlook.com-Konten. Neue Konten können nicht mit einem Passwort hinzugefügt werden.",
            "shortNote": "Persönliche Outlook.com-Konten erfordern eine OAuth2-Anmeldung, die diese App noch nicht unterstützt.",
            "comingSoonMessage": "Neue Outlook.com-Konten können noch nicht hinzugefügt werden. OAuth2-Anmeldung ist für ein zukünftiges Update geplant. Verwenden Sie Andere / Benutzerdefiniert nur, wenn Ihre Organisation passwortbasiertes IMAP/SMTP noch erlaubt."
        },
        "outlookBusiness": {
            "shortNote": "Microsoft 365-Konten (Arbeit/Schule) erfordern OAuth2 / Modern Auth, das diese App noch nicht unterstützt.",
            "comingSoonMessage": "Neue Microsoft 365-Konten können noch nicht hinzugefügt werden. OAuth2-Anmeldung ist für ein zukünftiges Update geplant. Verwenden Sie Andere / Benutzerdefiniert nur, wenn Ihre Organisation passwortbasiertes IMAP/SMTP noch erlaubt."
        },
        "outlookLegacy": {
            "warning": "Outlook-Konten erfordern jetzt eine OAuth2-Anmeldung. Dieses Konto wurde vor dieser Änderung hinzugefügt und funktioniert möglicherweise ab dem 30. April 2026 nicht mehr.",
            "shortNote": "Dies ist ein vorhandenes Outlook-Konto mit Standardauthentifizierung. Sie können die Einstellungen weiterhin bearbeiten, aber neue Outlook-Konten müssen auf OAuth2-Unterstützung warten."
        },
        "yahoo": {
            "shortNote": "Yahoo benötigt ein generiertes App-Passwort. Ihr normales Yahoo-Passwort funktioniert hier nicht.",
            "steps": [
                "Melden Sie sich auf der Yahoo-Kontosicherheitsseite unter login.yahoo.com/account/security an",
                "Aktivieren Sie die Bestätigung in zwei Schritten, falls noch nicht aktiv",
                "Wählen Sie „App-Passwort generieren“ (oder „App-Passwörter verwalten“)",
                "Benennen Sie die App „ExpressDelivery“ und klicken Sie auf Generieren",
                "Kopieren Sie das generierte Passwort und fügen Sie es hier im Passwortfeld ein"
            ]
        },
        "icloud": {
            "shortNote": "iCloud benötigt ein app-spezifisches Passwort. Ihr normales Apple-Account-Passwort funktioniert hier nicht.",
            "steps": [
                "Melden Sie sich unter account.apple.com in Ihrem Apple-Account an",
                "Wählen Sie unter Anmelden und Sicherheit die Option App-spezifische Passwörter",
                "Klicken Sie auf App-spezifisches Passwort generieren und benennen Sie es „ExpressDelivery“",
                "Kopieren Sie das generierte Passwort und fügen Sie es hier im Passwortfeld ein"
            ]
        },
        "custom": {
            "shortNote": "Geben Sie die IMAP- und SMTP-Einstellungen Ihres E-Mail-Anbieters ein. Die meisten Anbieter, die passwortbasiertes IMAP/SMTP noch unterstützen, funktionieren hier."
        }
    }
}
```

- [ ] **Step 5: Run tests to confirm no existing i18n keys were broken**

Run: `npm run test`
Expected: PASS — no regressions. Existing tests reference keys like `onboarding.welcome` which should still be present; the new block is additive.

- [ ] **Step 6: Commit**

```bash
git add src/locales/en.json src/locales/fr.json src/locales/es.json src/locales/de.json
git commit -m "i18n: add providerHelp strings for all four locales"
```

---

## Task 4: `ProviderHelpPanel` component

**Files:**
- Create: `src/components/ProviderHelpPanel.tsx`
- Create: `src/components/ProviderHelpPanel.module.css`
- Test: `src/components/ProviderHelpPanel.test.tsx` (new)

This component is the reusable help panel used by both OnboardingScreen and SettingsModal.

- [ ] **Step 1: Write the failing test**

Create `src/components/ProviderHelpPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockIpcInvoke } = vi.hoisted(() => ({
    mockIpcInvoke: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../lib/ipc', () => ({
    ipcInvoke: mockIpcInvoke,
}));

import { ProviderHelpPanel } from './ProviderHelpPanel';
import { PROVIDER_PRESETS, OUTLOOK_LEGACY_PRESET } from '../lib/providerPresets';

function findPreset(id: string) {
    const p = PROVIDER_PRESETS.find(preset => preset.id === id);
    if (!p) throw new Error(`preset ${id} not found`);
    return p;
}

describe('ProviderHelpPanel', () => {
    beforeEach(() => {
        mockIpcInvoke.mockClear();
        mockIpcInvoke.mockResolvedValue({ success: true });
    });

    it('renders the gmail short note', () => {
        render(<ProviderHelpPanel preset={findPreset('gmail')} />);
        expect(screen.getByText('providerHelp.gmail.shortNote')).toBeInTheDocument();
    });

    it('renders the open help page button for gmail', () => {
        render(<ProviderHelpPanel preset={findPreset('gmail')} />);
        expect(screen.getByRole('button', { name: 'providerHelp.common.openHelpPage' })).toBeInTheDocument();
    });

    it('does not render help button for custom preset (no helpUrl)', () => {
        render(<ProviderHelpPanel preset={findPreset('custom')} />);
        expect(screen.queryByRole('button', { name: 'providerHelp.common.openHelpPage' })).not.toBeInTheDocument();
    });

    it('toggles the step list when disclosure button is clicked', async () => {
        const user = userEvent.setup();
        render(<ProviderHelpPanel preset={findPreset('yahoo')} />);

        // Steps hidden by default
        expect(screen.queryByRole('list')).not.toBeInTheDocument();

        // Click to show
        await user.click(screen.getByRole('button', { name: 'providerHelp.common.showSteps' }));
        expect(screen.getByRole('list')).toBeInTheDocument();

        // Click to hide
        await user.click(screen.getByRole('button', { name: 'providerHelp.common.hideSteps' }));
        expect(screen.queryByRole('list')).not.toBeInTheDocument();
    });

    it('does not render steps disclosure when stepsKey is null (custom)', () => {
        render(<ProviderHelpPanel preset={findPreset('custom')} />);
        expect(screen.queryByRole('button', { name: /showSteps/ })).not.toBeInTheDocument();
    });

    it('invokes shell:open-external IPC with the preset helpUrl', async () => {
        const user = userEvent.setup();
        const preset = findPreset('gmail');
        render(<ProviderHelpPanel preset={preset} />);
        await user.click(screen.getByRole('button', { name: 'providerHelp.common.openHelpPage' }));
        expect(mockIpcInvoke).toHaveBeenCalledWith('shell:open-external', { url: preset.helpUrl });
    });

    it('renders warning banner for outlook-personal', () => {
        render(<ProviderHelpPanel preset={findPreset('outlook-personal')} />);
        expect(screen.getByRole('alert')).toHaveTextContent('providerHelp.outlookPersonal.warning');
    });

    it('does not render warning banner for gmail', () => {
        render(<ProviderHelpPanel preset={findPreset('gmail')} />);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('renders outlook-legacy warning + shortNote but no steps and no help link', () => {
        render(<ProviderHelpPanel preset={OUTLOOK_LEGACY_PRESET} />);
        expect(screen.getByRole('alert')).toHaveTextContent('providerHelp.outlookLegacy.warning');
        expect(screen.getByText('providerHelp.outlookLegacy.shortNote')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /showSteps/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'providerHelp.common.openHelpPage' })).not.toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- ProviderHelpPanel`
Expected: FAIL — `./ProviderHelpPanel` module does not exist.

- [ ] **Step 3: Implement the CSS module**

Create `src/components/ProviderHelpPanel.module.css`:

```css
.panel {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem 0.875rem;
    margin-bottom: 1rem;
    border-radius: 0.625rem;
    background: rgb(var(--surface-rgb) / 0.6);
    border: 1px solid rgb(var(--border-rgb) / 0.6);
    font-size: 0.8125rem;
    line-height: 1.5;
}

.warning {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.625rem 0.75rem;
    border-radius: 0.5rem;
    background: rgb(255 184 0 / 0.12);
    border: 1px solid rgb(255 184 0 / 0.35);
    color: rgb(var(--text-rgb));
}

.warning-icon {
    flex-shrink: 0;
    margin-top: 0.0625rem;
    color: rgb(255 184 0);
}

.note {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    color: rgb(var(--text-rgb) / 0.9);
}

.note-icon {
    flex-shrink: 0;
    margin-top: 0.0625rem;
    color: rgb(var(--accent-rgb));
}

.actions {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    margin-top: 0.25rem;
}

.disclosure-button,
.help-button {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.25rem 0.5rem;
    background: transparent;
    border: none;
    color: rgb(var(--accent-rgb));
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    width: fit-content;
    border-radius: 0.375rem;
    transition: background 0.15s ease;
}

.disclosure-button:hover,
.help-button:hover {
    background: rgb(var(--accent-rgb) / 0.09);
}

.disclosure-button:active,
.help-button:active {
    background: rgb(var(--accent-rgb) / 0.15);
}

.steps {
    margin: 0.5rem 0 0.25rem 1.5rem;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    color: rgb(var(--text-rgb) / 0.85);
}

.steps li {
    list-style-position: outside;
}
```

- [ ] **Step 4: Implement the component**

Create `src/components/ProviderHelpPanel.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, AlertTriangle, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { ipcInvoke } from '../lib/ipc';
import type { ProviderPreset } from '../lib/providerPresets';
import styles from './ProviderHelpPanel.module.css';

interface ProviderHelpPanelProps {
    preset: ProviderPreset;
}

export const ProviderHelpPanel: React.FC<ProviderHelpPanelProps> = ({ preset }) => {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);

    const steps = preset.stepsKey
        ? (t(preset.stepsKey, { returnObjects: true }) as unknown as string[])
        : null;
    const hasSteps = Array.isArray(steps) && steps.length > 0;

    const handleOpenHelp = async () => {
        if (!preset.helpUrl) return;
        await ipcInvoke('shell:open-external', { url: preset.helpUrl });
    };

    return (
        <section
            className={styles['panel']}
            aria-label={`Help for ${preset.label}`}
        >
            {preset.warningKey && (
                <div className={styles['warning']} role="alert">
                    <AlertTriangle size={16} className={styles['warning-icon']} />
                    <span>{t(preset.warningKey)}</span>
                </div>
            )}

            <div className={styles['note']}>
                <Info size={16} className={styles['note-icon']} />
                <span>{t(preset.shortNoteKey)}</span>
            </div>

            <div className={styles['actions']}>
                {hasSteps && (
                    <button
                        type="button"
                        className={styles['disclosure-button']}
                        onClick={() => setOpen(!open)}
                        aria-expanded={open}
                    >
                        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        {open
                            ? t('providerHelp.common.hideSteps')
                            : t('providerHelp.common.showSteps')}
                    </button>
                )}

                {open && hasSteps && (
                    <ol className={styles['steps']}>
                        {steps!.map((step, i) => (
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
                        <ExternalLink size={14} />
                        {t('providerHelp.common.openHelpPage')}
                    </button>
                )}
            </div>
        </section>
    );
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- ProviderHelpPanel`
Expected: PASS — 9 assertions. If the steps test fails because `returnObjects` yields the key string rather than an array, verify the react-i18next version accepts the flag; if not, fall back to indexed keys (see spec §14 and task-time verification note below).

**Fallback if `returnObjects` does not work:** Replace the `steps` derivation with:

```tsx
const steps = preset.stepsKey ? (() => {
    const out: string[] = [];
    for (let i = 0; i < 10; i++) {
        const key = `${preset.stepsKey}.${i}`;
        const value = t(key);
        if (value === key) break;
        out.push(value);
    }
    return out;
})() : null;
```

And flatten the locale step arrays to indexed keys (`steps.0`, `steps.1`, …) in all four locale files. This fallback is documented here so the engineer doesn't have to improvise.

- [ ] **Step 6: Commit**

```bash
git add src/components/ProviderHelpPanel.tsx src/components/ProviderHelpPanel.module.css src/components/ProviderHelpPanel.test.tsx
git commit -m "feat(components): add ProviderHelpPanel for account auth guidance"
```

---

## Task 5: Integrate `ProviderHelpPanel` into `OnboardingScreen`

**Files:**
- Modify: `src/components/OnboardingScreen.tsx`
- Modify: `src/components/OnboardingScreen.test.tsx`

- [ ] **Step 1: Update the existing onboarding test for new provider grid + oauth2-required disabled state**

Edit `src/components/OnboardingScreen.test.tsx`. Replace the existing `"shows provider cards in provider step"` test and add new ones:

```tsx
it('shows all 6 provider cards in provider step', async () => {
    render(<OnboardingScreen onAccountAdded={vi.fn()} />);
    await userEvent.click(screen.getByText('onboarding.getStarted'));
    expect(screen.getByText('Gmail')).toBeInTheDocument();
    expect(screen.getByText('Outlook.com (Personal)')).toBeInTheDocument();
    expect(screen.getByText('Microsoft 365 (Work/School)')).toBeInTheDocument();
    expect(screen.getByText('Yahoo Mail')).toBeInTheDocument();
    expect(screen.getByText('iCloud Mail')).toBeInTheDocument();
    expect(screen.getByText('Other / Custom')).toBeInTheDocument();
});

it('renders ProviderHelpPanel on credentials step for gmail', async () => {
    render(<OnboardingScreen onAccountAdded={vi.fn()} />);
    await userEvent.click(screen.getByText('onboarding.getStarted'));
    await userEvent.click(screen.getByText('Gmail'));
    expect(screen.getByText('providerHelp.gmail.shortNote')).toBeInTheDocument();
});

it('shows disabled state for Outlook.com Personal with custom fallback CTA', async () => {
    render(<OnboardingScreen onAccountAdded={vi.fn()} />);
    await userEvent.click(screen.getByText('onboarding.getStarted'));
    await userEvent.click(screen.getByText('Outlook.com (Personal)'));
    expect(screen.getByText('providerHelp.outlookPersonal.comingSoonMessage')).toBeInTheDocument();
    // Password field is NOT rendered
    expect(screen.queryByLabelText('settings.password')).not.toBeInTheDocument();
    // Connect button is NOT rendered
    expect(screen.queryByText('onboarding.connect')).not.toBeInTheDocument();
    // Custom fallback CTA IS rendered
    expect(screen.getByText('onboarding.useCustomInstead')).toBeInTheDocument();
});

it('shows disabled state for Microsoft 365 business', async () => {
    render(<OnboardingScreen onAccountAdded={vi.fn()} />);
    await userEvent.click(screen.getByText('onboarding.getStarted'));
    await userEvent.click(screen.getByText('Microsoft 365 (Work/School)'));
    expect(screen.getByText('providerHelp.outlookBusiness.comingSoonMessage')).toBeInTheDocument();
    expect(screen.queryByLabelText('settings.password')).not.toBeInTheDocument();
});

it('Use Custom fallback CTA routes to custom preset credentials', async () => {
    render(<OnboardingScreen onAccountAdded={vi.fn()} />);
    await userEvent.click(screen.getByText('onboarding.getStarted'));
    await userEvent.click(screen.getByText('Outlook.com (Personal)'));
    await userEvent.click(screen.getByText('onboarding.useCustomInstead'));
    // Now on Custom credentials
    expect(screen.getByLabelText('settings.email')).toBeInTheDocument();
    expect(screen.getByLabelText('settings.password')).toBeInTheDocument();
});
```

Also add `onboarding.useCustomInstead` to `src/locales/en.json` (and the other three locale files) under the existing `onboarding` block. For example in `en.json`:

```json
"onboarding": {
    ...existing keys...,
    "useCustomInstead": "Use Other / Custom instead"
}
```

Equivalents:
- `fr.json`: `"useCustomInstead": "Utiliser Autre / Personnalisé à la place"`
- `es.json`: `"useCustomInstead": "Usar Otro / Personalizado en su lugar"`
- `de.json`: `"useCustomInstead": "Stattdessen Andere / Benutzerdefiniert verwenden"`

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- OnboardingScreen`
Expected: FAIL — new labels like "Outlook.com (Personal)" are not yet rendered; disabled state and Use Custom CTA do not exist.

- [ ] **Step 3: Update `OnboardingScreen.tsx`**

In `src/components/OnboardingScreen.tsx`:

**(a)** Add imports near the top:

```tsx
import { ProviderHelpPanel } from './ProviderHelpPanel';
```

**(b)** Replace the hardcoded `PROVIDER_ACCENTS` lookup for outlook to include the new split IDs:

```tsx
const PROVIDER_ACCENTS: Record<string, string> = {
    gmail:              '#EA4335',
    'outlook-personal': '#0078D4',
    'outlook-business': '#0078D4',
    yahoo:              '#6001D2',
    icloud:             '#007AFF',
    custom:             'var(--accent-color)',
};
```

**(c)** In the credentials step, insert the help panel above the form fields, and branch on `oauth2-required`:

Replace the existing `{step === 'credentials' && (...)}` block with:

```tsx
{step === 'credentials' && selectedPreset && (
    <div className={`${styles['ob-step']} ${styles['ob-step-left']}`}>
        <h2 className={styles['ob-step-title']}>{t('onboarding.accountDetails')}</h2>
        <p className={styles['ob-step-subtitle']}>
            {selectedPreset.id !== 'custom'
                ? t('onboarding.connectingTo', { provider: selectedPreset.label })
                : t('onboarding.enterYourCredentials')}
        </p>

        <ProviderHelpPanel preset={selectedPreset} />

        {selectedPreset.authModel === 'oauth2-required' ? (
            <>
                <div className={styles['ob-coming-soon-message']}>
                    {selectedPreset.comingSoonMessageKey && t(selectedPreset.comingSoonMessageKey)}
                </div>
                <div className={styles['ob-actions']}>
                    <button className={styles['ob-secondary-btn']} onClick={() => setStep('provider')}>
                        <ChevronLeft size={16} />
                        <span>{t('onboarding.back')}</span>
                    </button>
                    <button
                        className={`${styles['ob-primary-btn']} ${styles['ob-shimmer-btn']}`}
                        onClick={() => {
                            const customPreset = PROVIDER_PRESETS.find(p => p.id === 'custom')!;
                            selectProvider(customPreset);
                            setStep('server');
                        }}
                    >
                        <span>{t('onboarding.useCustomInstead')}</span>
                        <ChevronRight size={18} />
                    </button>
                </div>
            </>
        ) : (
            <>
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
                            placeholder="App Password"
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
                    <button
                        className={`${styles['ob-primary-btn']} ${styles['ob-shimmer-btn']}`}
                        onClick={handleCredentialsNext}
                        disabled={saving}
                    >
                        <span>
                            {saving
                                ? (testStatus === 'testing' ? t('onboarding.testingConnection') : t('onboarding.connecting'))
                                : selectedPreset.id === 'custom' ? t('onboarding.next') : t('onboarding.connect')}
                        </span>
                        <ChevronRight size={18} />
                    </button>
                </div>
            </>
        )}
    </div>
)}
```

**(d)** Remove the now-unused `preset.notes` rendering from the provider grid. In the `{step === 'provider' && ...}` block, replace the `{preset.notes && (<span>...</span>)}` line with a translated short note from `preset.shortNoteKey` (truncated to one line via CSS):

```tsx
<span className={styles['ob-provider-notes']}>{t(preset.shortNoteKey)}</span>
```

- [ ] **Step 4: Add the new CSS class for the coming-soon message**

Edit `src/components/OnboardingScreen.module.css`. Add:

```css
.ob-coming-soon-message {
    padding: 0.875rem 1rem;
    margin: 0.5rem 0 1rem;
    border-radius: 0.625rem;
    background: rgb(var(--surface-rgb) / 0.6);
    border: 1px solid rgb(var(--border-rgb) / 0.6);
    font-size: 0.8125rem;
    line-height: 1.5;
    color: rgb(var(--text-rgb) / 0.9);
}
```

- [ ] **Step 5: Run all tests**

Run: `npm run test -- OnboardingScreen ProviderHelpPanel`
Expected: PASS — new assertions pass, existing tests that referenced `"Outlook / Hotmail"` must have been replaced with `"Outlook.com (Personal)"` in Step 1.

- [ ] **Step 6: Commit**

```bash
git add src/components/OnboardingScreen.tsx src/components/OnboardingScreen.module.css src/components/OnboardingScreen.test.tsx src/locales/en.json src/locales/fr.json src/locales/es.json src/locales/de.json
git commit -m "feat(onboarding): integrate ProviderHelpPanel + disable Outlook add flow"
```

---

## Task 6: Integrate `ProviderHelpPanel` into `SettingsModal` (add + edit)

**Files:**
- Modify: `src/components/SettingsModal.tsx`
- Modify: `src/components/SettingsModal.test.tsx`

- [ ] **Step 1: Read the account add/edit flow context**

Use `Read` with line range on `src/components/SettingsModal.tsx` around lines 490-610 (the account save logic) and around line 840 (the provider grid rendering). Understand:
- how `editingAccountId` gates the edit vs add path
- where `PROVIDER_PRESETS.map(preset => ...)` renders the grid — this must still exclude `outlook-legacy`
- where the password input is rendered in both add and edit flows

This is a reading step, not a modification step. It exists so the engineer doesn't flail when editing the file.

- [ ] **Step 2: Write the failing test**

Append to `src/components/SettingsModal.test.tsx` inside the existing `describe` block (or a new nested describe):

```tsx
describe('Provider help panel integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIpcInvoke.mockResolvedValue(null);
        useThemeStore.setState({ themeName: 'light' });
    });

    it('shows ProviderHelpPanel when adding a Gmail account', async () => {
        const user = userEvent.setup();
        mockIpcInvoke.mockImplementation(async (channel: string) => {
            if (channel === 'accounts:list') return [];
            return null;
        });

        renderSettings();
        await user.click(screen.getByRole('tab', { name: /accounts/i }));
        await waitFor(() => expect(screen.getByText(/add account/i)).toBeInTheDocument());
        await user.click(screen.getByText(/add account/i));
        await user.click(screen.getByText('Gmail'));

        expect(screen.getByText('providerHelp.gmail.shortNote')).toBeInTheDocument();
    });

    it('disables add flow for outlook-personal with coming soon message', async () => {
        const user = userEvent.setup();
        mockIpcInvoke.mockImplementation(async (channel: string) => {
            if (channel === 'accounts:list') return [];
            return null;
        });

        renderSettings();
        await user.click(screen.getByRole('tab', { name: /accounts/i }));
        await user.click(screen.getByText(/add account/i));
        await user.click(screen.getByText('Outlook.com (Personal)'));

        expect(screen.getByText('providerHelp.outlookPersonal.comingSoonMessage')).toBeInTheDocument();
        expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    });

    it('shows legacy warning but keeps form editable for stored provider="outlook"', async () => {
        const user = userEvent.setup();
        mockIpcInvoke.mockImplementation(async (channel: string) => {
            if (channel === 'accounts:list') {
                return [{
                    id: 'acc-legacy',
                    email: 'legacy@outlook.com',
                    provider: 'outlook',
                    display_name: 'Legacy',
                    imap_host: 'outlook.office365.com',
                    imap_port: 993,
                    smtp_host: 'smtp.office365.com',
                    smtp_port: 587,
                    signature_html: null,
                }];
            }
            return null;
        });

        renderSettings();
        await user.click(screen.getByRole('tab', { name: /accounts/i }));
        await waitFor(() => expect(screen.getByText('legacy@outlook.com')).toBeInTheDocument());
        // Open edit
        await user.click(screen.getByText('legacy@outlook.com'));

        // Warning banner present
        expect(screen.getByRole('alert')).toHaveTextContent('providerHelp.outlookLegacy.warning');
        // Form still editable — password field is still rendered and enabled
        const passwordInput = screen.getByLabelText(/password/i) as HTMLInputElement;
        expect(passwordInput).toBeInTheDocument();
        expect(passwordInput.disabled).toBe(false);
    });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test -- SettingsModal`
Expected: FAIL — the panel and legacy handling don't exist yet.

- [ ] **Step 4: Update `SettingsModal.tsx`**

Make the following changes to `src/components/SettingsModal.tsx`:

**(a)** Add imports:

```tsx
import { ProviderHelpPanel } from './ProviderHelpPanel';
import { getPresetForAccount, PROVIDER_PRESETS } from '../lib/providerPresets';
```

(`PROVIDER_PRESETS` may already be imported — don't duplicate.)

**(b)** Update the provider name lookup helper (line ~45) to handle legacy:

```tsx
const providerLabel = (providerId: string) => {
    if (providerId === 'outlook') return 'Outlook (Legacy)';
    return PROVIDER_PRESETS.find(p => p.id === providerId)?.label ?? providerId;
};
```

**(c)** Compute the current preset in the render path. Find where the account form is rendered, and derive:

```tsx
const currentPreset = editingAccountId
    ? getPresetForAccount({ provider: currentFormProvider })
    : selectedPresetForAdd; // whatever local state holds the chosen add-flow preset
```

Replace references to `PROVIDER_PRESETS.find(...)` for the current form's preset with `currentPreset`.

**(d)** Insert `<ProviderHelpPanel preset={currentPreset} />` immediately above the credentials form fields in both the add flow and edit flow (they share the same JSX — a single insertion point).

**(e)** In the add flow, gate the form rendering on `authModel`:

```tsx
{!editingAccountId && currentPreset.authModel === 'oauth2-required' ? (
    <>
        <div className={styles['coming-soon-message']}>
            {currentPreset.comingSoonMessageKey && t(currentPreset.comingSoonMessageKey)}
        </div>
        <button
            className={styles['secondary-btn']}
            onClick={() => {
                // Reset form with custom preset
                const custom = PROVIDER_PRESETS.find(p => p.id === 'custom')!;
                setSelectedPresetForAdd(custom); // adjust to actual state setter
                /* ...clear host/port fields to custom defaults... */
            }}
        >
            {t('onboarding.useCustomInstead')}
        </button>
    </>
) : (
    /* existing form fields (inputs, password, ports, save button) */
)}
```

**(f)** In the edit flow (`editingAccountId !== null`), render the full form as before — no gating. Just prepend the `<ProviderHelpPanel>` so the legacy warning banner appears for stored `outlook` accounts. Do **not** block any field or the Save/Test button for legacy accounts.

**(g)** Add minimal CSS for `.coming-soon-message` to `SettingsModal.module.css`:

```css
.coming-soon-message {
    padding: 0.875rem 1rem;
    margin: 0.5rem 0 1rem;
    border-radius: 0.625rem;
    background: rgb(var(--surface-rgb) / 0.6);
    border: 1px solid rgb(var(--border-rgb) / 0.6);
    font-size: 0.8125rem;
    line-height: 1.5;
    color: rgb(var(--text-rgb) / 0.9);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- SettingsModal ProviderHelpPanel`
Expected: PASS — new assertions pass, existing SettingsModal tests still pass. If a specific existing test breaks because it expected "Outlook / Hotmail" in the grid, update that assertion to "Outlook.com (Personal)".

- [ ] **Step 6: Commit**

```bash
git add src/components/SettingsModal.tsx src/components/SettingsModal.module.css src/components/SettingsModal.test.tsx
git commit -m "feat(settings): integrate ProviderHelpPanel into add + edit flows"
```

---

## Task 7: Full suite verification and build

**Files:** none modified — this task is pure validation.

- [ ] **Step 1: Run the full lint**

Run: `npm run lint`
Expected: **zero warnings**. Fix any new lint issues introduced by Phase 1 before proceeding.

- [ ] **Step 2: Run the full test suite**

Run: `npm run test`
Expected: All existing + new tests pass. Target count: ~820-830 tests across ~35 files.

- [ ] **Step 3: Run a Windows build**

Run: `npm run build:win`
Expected: success — no TypeScript errors, no electron-builder packaging errors.

If `electron/main.ts` fails to import from `src/lib/providerPresets.ts` because of the bundler topology (see spec §14), fall back to:
1. Create `shared/helpUrls.ts` containing only `export const HELP_URLS = [...] as const;`
2. Import `HELP_URLS` from `shared/helpUrls.ts` in both `src/lib/providerPresets.ts` (re-export) and `electron/shellOpen.ts`
3. Re-run build

- [ ] **Step 4: Manual smoke test (optional but strongly recommended)**

1. Launch the app (`npm run dev`)
2. Open Settings → Accounts → Add Account
3. Verify all 6 cards render
4. Click Gmail — verify ProviderHelpPanel shows short note, expandable steps, and "Open official page" button
5. Click "Open official page" — verify the browser opens to the exact Gmail URL
6. Click Outlook.com (Personal) — verify the disabled state, no password field, and "Use Other / Custom instead" button
7. Click "Use Other / Custom instead" — verify the custom flow engages
8. If a legacy `outlook` account is present, open its edit view and verify the warning banner + fully-editable form

- [ ] **Step 5: Final commit (if any cleanup was needed)**

```bash
git status
# If clean, skip. If any .json/.css/.ts cleanup was made:
git add -A
git commit -m "chore: Phase 1 provider guidance final cleanup"
```

---

## Self-review checklist (run this before marking the plan complete)

- [x] **Spec §1 Summary** → Tasks 1-6 cover all four providers with accurate guidance
- [x] **Spec §3 Data model** → Task 1
- [x] **Spec §4 ProviderHelpPanel** → Task 4
- [x] **Spec §5 Outlook add vs edit split** → Tasks 5 (onboarding) and 6 (settings)
- [x] **Spec §6 No DB migration** → No migration task exists; Task 1 uses `getPresetForAccount` mapping instead
- [x] **Spec §7 shell:open-external IPC** → Task 2
- [x] **Spec §8 i18n** → Task 3
- [x] **Spec §9 Integration points** → Tasks 5, 6
- [x] **Spec §10 Testing** → Every new file has a test task; every modified file has test updates
- [x] **Spec §14 verification items** → `returnObjects` fallback documented in Task 4; bundler fallback documented in Task 7
- [x] **Spec §15 Acceptance criteria** → Task 7 validates all 11 criteria (lint, build, tests, manual smoke covers 1-6 and 9-11; 7-8 covered by Tasks 1-4 tests)

**Placeholder scan:** No "TBD", no "add appropriate X", no "similar to". All test code is complete. All component code is complete. Fallback plans are documented inline.

**Type consistency:**
- `ProviderPreset` fields match between Task 1 (declaration) and Task 4 (consumption): `authModel`, `shortNoteKey`, `stepsKey`, `helpUrl`, `warningKey`, `comingSoonMessageKey` ✓
- `getPresetForAccount` signature matches between Task 1 declaration and Task 6 usage ✓
- `HELP_URLS` is used in Task 2 test and in Task 2 handler, identical import path ✓
- `handleShellOpenExternal` signature is consistent between Task 2 test, Task 2 implementation, and Task 2 main.ts wiring ✓

No gaps identified.
