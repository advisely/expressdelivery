import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockIpcInvoke } = vi.hoisted(() => ({
    mockIpcInvoke: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../lib/ipc', () => ({
    ipcInvoke: mockIpcInvoke,
}));

// Override the global react-i18next mock from setupTests.ts so that
// `t(key, { returnObjects: true })` returns a fake array when the key looks
// like a steps list. The default mock returns the key string unconditionally,
// which would collapse the steps disclosure (never rendered) and break the
// toggle test. All other calls still return the literal key, so the other
// assertions in this suite can match on key strings.
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, opts?: { returnObjects?: boolean }) => {
            if (opts?.returnObjects) {
                if (key.endsWith('.steps')) {
                    return ['Step 1', 'Step 2', 'Step 3'];
                }
                return key;
            }
            return key;
        },
        i18n: {
            language: 'en',
            changeLanguage: vi.fn().mockResolvedValue(undefined),
        },
    }),
    Trans: ({ children }: { children: React.ReactNode }) => children,
    initReactI18next: { type: '3rdParty', init: vi.fn() },
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
