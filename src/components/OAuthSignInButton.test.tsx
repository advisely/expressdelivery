import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockIpcInvoke } = vi.hoisted(() => ({
    mockIpcInvoke: vi.fn(),
}));

vi.mock('../lib/ipc', () => ({
    ipcInvoke: mockIpcInvoke,
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
}));

import { OAuthSignInButton } from './OAuthSignInButton';

describe('OAuthSignInButton', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders google label when provider is google', () => {
        render(<OAuthSignInButton provider="google" onSuccess={vi.fn()} onError={vi.fn()} />);
        expect(screen.getByText('oauth.button.google')).toBeInTheDocument();
    });

    it('renders microsoft label when provider is microsoft', () => {
        render(<OAuthSignInButton provider="microsoft" onSuccess={vi.fn()} onError={vi.fn()} />);
        expect(screen.getByText('oauth.button.microsoft')).toBeInTheDocument();
    });

    it('dispatches auth:start-oauth-flow with the provider on click', async () => {
        mockIpcInvoke.mockResolvedValueOnce({ success: true, accountId: 'a1' });
        render(<OAuthSignInButton provider="google" onSuccess={vi.fn()} onError={vi.fn()} />);
        await userEvent.click(screen.getByRole('button'));
        expect(mockIpcInvoke).toHaveBeenCalledWith('auth:start-oauth-flow', { provider: 'google' });
    });

    it('calls onSuccess with the accountId returned by the IPC', async () => {
        mockIpcInvoke.mockResolvedValueOnce({ success: true, accountId: 'acct-42' });
        const onSuccess = vi.fn();
        render(<OAuthSignInButton provider="google" onSuccess={onSuccess} onError={vi.fn()} />);
        await userEvent.click(screen.getByRole('button'));
        await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
        expect(onSuccess).toHaveBeenCalledWith({ accountId: 'acct-42', classifiedProvider: undefined });
    });

    it('passes classifiedProvider through to onSuccess for microsoft flows', async () => {
        mockIpcInvoke.mockResolvedValueOnce({
            success: true,
            accountId: 'acct-7',
            classifiedProvider: 'microsoft_business',
        });
        const onSuccess = vi.fn();
        render(<OAuthSignInButton provider="microsoft" onSuccess={onSuccess} onError={vi.fn()} />);
        await userEvent.click(screen.getByRole('button'));
        await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
        expect(onSuccess).toHaveBeenCalledWith({
            accountId: 'acct-7',
            classifiedProvider: 'microsoft_business',
        });
    });

    it('calls onError when IPC reports failure', async () => {
        mockIpcInvoke.mockResolvedValueOnce({ success: false, error: 'user cancelled' });
        const onError = vi.fn();
        render(<OAuthSignInButton provider="google" onSuccess={vi.fn()} onError={onError} />);
        await userEvent.click(screen.getByRole('button'));
        await waitFor(() => expect(onError).toHaveBeenCalledWith('user cancelled'));
    });

    it('calls onError when IPC throws', async () => {
        mockIpcInvoke.mockRejectedValueOnce(new Error('network down'));
        const onError = vi.fn();
        render(<OAuthSignInButton provider="google" onSuccess={vi.fn()} onError={onError} />);
        await userEvent.click(screen.getByRole('button'));
        await waitFor(() => expect(onError).toHaveBeenCalledWith('network down'));
    });

    it('shows signing-in label and aria-busy while in-flight', async () => {
        let resolveFn: ((v: { success: boolean; accountId: string }) => void) = () => {};
        mockIpcInvoke.mockImplementationOnce(() => new Promise(r => { resolveFn = r; }));
        render(<OAuthSignInButton provider="google" onSuccess={vi.fn()} onError={vi.fn()} />);
        await userEvent.click(screen.getByRole('button'));
        expect(screen.getByText('oauth.button.signingIn')).toBeInTheDocument();
        expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByRole('button')).toBeDisabled();
        resolveFn({ success: true, accountId: 'a1' });
        await waitFor(() => expect(screen.queryByText('oauth.button.signingIn')).not.toBeInTheDocument());
    });

    it('respects the disabled prop', async () => {
        render(<OAuthSignInButton provider="google" onSuccess={vi.fn()} onError={vi.fn()} disabled />);
        expect(screen.getByRole('button')).toBeDisabled();
        await userEvent.click(screen.getByRole('button'));
        expect(mockIpcInvoke).not.toHaveBeenCalled();
    });
});
