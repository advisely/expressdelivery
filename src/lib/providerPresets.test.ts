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
