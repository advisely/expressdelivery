import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockIpcInvoke } = vi.hoisted(() => ({
    mockIpcInvoke: vi.fn().mockResolvedValue(null),
}));

vi.mock('../lib/ipc', () => ({
    ipcInvoke: mockIpcInvoke,
}));

import { OnboardingScreen } from './OnboardingScreen';
import { useEmailStore } from '../stores/emailStore';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OnboardingScreen', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIpcInvoke.mockResolvedValue(null);
        useEmailStore.setState({
            accounts: [], folders: [], emails: [],
            selectedAccountId: null, selectedFolderId: null,
            selectedEmailId: null, selectedEmail: null, searchQuery: '',
        });
    });

    it('renders welcome step by default', () => {
        render(<OnboardingScreen onAccountAdded={vi.fn()} />);
        expect(screen.getByText('onboarding.welcome')).toBeInTheDocument();
        expect(screen.getByText('onboarding.getStarted')).toBeInTheDocument();
    });

    it('advances to provider step on Get Started click', async () => {
        render(<OnboardingScreen onAccountAdded={vi.fn()} />);
        await userEvent.click(screen.getByText('onboarding.getStarted'));
        expect(screen.getByText('onboarding.chooseProvider')).toBeInTheDocument();
    });

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

    it('advances to credentials step when a provider is selected', async () => {
        render(<OnboardingScreen onAccountAdded={vi.fn()} />);
        await userEvent.click(screen.getByText('onboarding.getStarted'));
        await userEvent.click(screen.getByText('Gmail'));
        expect(screen.getByLabelText('settings.email')).toBeInTheDocument();
        expect(screen.getByLabelText('settings.password')).toBeInTheDocument();
    });

    it('shows validation error for empty email', async () => {
        render(<OnboardingScreen onAccountAdded={vi.fn()} />);
        await userEvent.click(screen.getByText('onboarding.getStarted'));
        await userEvent.click(screen.getByText('Gmail'));
        // Try to proceed without filling fields
        await userEvent.click(screen.getByText('onboarding.connect'));
        expect(screen.getByText('onboarding.emailRequired')).toBeInTheDocument();
    });

    it('shows validation error for empty password', async () => {
        render(<OnboardingScreen onAccountAdded={vi.fn()} />);
        await userEvent.click(screen.getByText('onboarding.getStarted'));
        await userEvent.click(screen.getByText('Gmail'));
        await userEvent.type(screen.getByLabelText('settings.email'), 'user@gmail.com');
        await userEvent.click(screen.getByText('onboarding.connect'));
        expect(screen.getByText('onboarding.passwordRequired')).toBeInTheDocument();
    });

    it('calls onAccountAdded on successful submit', async () => {
        const onAccountAdded = vi.fn();
        mockIpcInvoke
            .mockResolvedValueOnce({ success: true }) // accounts:test
            .mockResolvedValueOnce({ id: 'a1' });     // accounts:add

        render(<OnboardingScreen onAccountAdded={onAccountAdded} />);
        await userEvent.click(screen.getByText('onboarding.getStarted'));
        await userEvent.click(screen.getByText('Gmail'));
        await userEvent.type(screen.getByLabelText('settings.email'), 'user@gmail.com');
        await userEvent.type(screen.getByLabelText('settings.password'), 'app-password');

        await act(async () => {
            await userEvent.click(screen.getByText('onboarding.connect'));
        });

        expect(onAccountAdded).toHaveBeenCalledTimes(1);
    });

    it('shows connection error on test failure', async () => {
        mockIpcInvoke.mockResolvedValueOnce({ success: false, error: 'Invalid credentials' });

        render(<OnboardingScreen onAccountAdded={vi.fn()} />);
        await userEvent.click(screen.getByText('onboarding.getStarted'));
        await userEvent.click(screen.getByText('Gmail'));
        await userEvent.type(screen.getByLabelText('settings.email'), 'user@gmail.com');
        await userEvent.type(screen.getByLabelText('settings.password'), 'wrong-pass');

        await act(async () => {
            await userEvent.click(screen.getByText('onboarding.connect'));
        });

        expect(screen.getByText('onboarding.connectionFailed')).toBeInTheDocument();
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
        expect(screen.queryByLabelText('settings.password')).not.toBeInTheDocument();
        expect(screen.queryByText('onboarding.connect')).not.toBeInTheDocument();
        expect(screen.getByText('onboarding.useCustomInstead')).toBeInTheDocument();
    });

    it('announces the Outlook disabled state via role="status" / aria-live', async () => {
        render(<OnboardingScreen onAccountAdded={vi.fn()} />);
        await userEvent.click(screen.getByText('onboarding.getStarted'));
        await userEvent.click(screen.getByText('Outlook.com (Personal)'));
        const status = screen.getByRole('status');
        expect(status).toHaveTextContent('providerHelp.outlookPersonal.comingSoonMessage');
        expect(status).toHaveAttribute('aria-live', 'polite');
    });

    it('shows disabled state for Microsoft 365 business', async () => {
        render(<OnboardingScreen onAccountAdded={vi.fn()} />);
        await userEvent.click(screen.getByText('onboarding.getStarted'));
        await userEvent.click(screen.getByText('Microsoft 365 (Work/School)'));
        expect(screen.getByText('providerHelp.outlookBusiness.comingSoonMessage')).toBeInTheDocument();
        expect(screen.queryByLabelText('settings.password')).not.toBeInTheDocument();
    });

    it('Use Custom Instead button pivots an oauth2-gated flow to the server step', async () => {
        render(<OnboardingScreen onAccountAdded={vi.fn()} />);
        await userEvent.click(screen.getByText('onboarding.getStarted'));
        await userEvent.click(screen.getByText('Outlook.com (Personal)'));

        // Still on credentials step showing the disabled state
        expect(screen.getByText('providerHelp.outlookPersonal.comingSoonMessage')).toBeInTheDocument();

        // Click the custom fallback button
        await userEvent.click(screen.getByText('onboarding.useCustomInstead'));

        // Jumped straight to the server step — disabled state is gone, server heading is present
        expect(screen.queryByText('providerHelp.outlookPersonal.comingSoonMessage')).not.toBeInTheDocument();
        expect(screen.getByText('onboarding.serverSettings')).toBeInTheDocument();
    });
});
