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

    it('shows provider cards in provider step', async () => {
        render(<OnboardingScreen onAccountAdded={vi.fn()} />);
        await userEvent.click(screen.getByText('onboarding.getStarted'));
        expect(screen.getByText('Gmail')).toBeInTheDocument();
        expect(screen.getByText('Outlook / Hotmail')).toBeInTheDocument();
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
});
