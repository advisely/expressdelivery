import { useState, type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, LogIn } from 'lucide-react';
import { ipcInvoke } from '../lib/ipc';
import styles from './OAuthSignInButton.module.css';

export type OAuthProvider = 'google' | 'microsoft';

export interface OAuthSignInResult {
    accountId: string;
    /**
     * For microsoft flows, the tenant classification determined from the id_token
     * `tid` claim. Undefined for google. Callers can use this to warn when the
     * user picked a personal preset but the token resolved as business (or vice
     * versa).
     */
    classifiedProvider?: 'microsoft_personal' | 'microsoft_business';
}

interface OAuthSignInButtonProps {
    provider: OAuthProvider;
    onSuccess: (result: OAuthSignInResult) => void;
    onError: (err: string) => void;
    disabled?: boolean;
}

/**
 * Sign-in button that triggers the main-process OAuth2 flow for Google or
 * Microsoft accounts. The flow opens an external browser, listens on a loopback
 * port, exchanges the code, persists tokens, and (for new accounts) inserts the
 * account row. The button reports the result back to its parent via callbacks.
 *
 * Renders an in-flight spinner while the flow is pending and disables itself
 * so double-clicks cannot launch a second concurrent flow.
 */
export const OAuthSignInButton: FC<OAuthSignInButtonProps> = ({
    provider,
    onSuccess,
    onError,
    disabled = false,
}) => {
    const { t } = useTranslation();
    const [inFlight, setInFlight] = useState(false);

    const handleClick = async () => {
        if (inFlight || disabled) return;
        setInFlight(true);
        try {
            const result = await ipcInvoke<{
                success: boolean;
                accountId?: string;
                classifiedProvider?: 'microsoft_personal' | 'microsoft_business';
                error?: string;
            }>('auth:start-oauth-flow', { provider });

            if (!result || !result.success || !result.accountId) {
                onError(result?.error ?? 'oauth flow failed');
                return;
            }
            onSuccess({
                accountId: result.accountId,
                classifiedProvider: result.classifiedProvider,
            });
        } catch (err) {
            onError(err instanceof Error ? err.message : String(err));
        } finally {
            setInFlight(false);
        }
    };

    const labelKey = inFlight
        ? 'oauth.button.signingIn'
        : provider === 'google'
            ? 'oauth.button.google'
            : 'oauth.button.microsoft';

    return (
        <button
            type="button"
            className={styles['oauth-btn']}
            data-provider={provider}
            onClick={handleClick}
            disabled={disabled || inFlight}
            aria-busy={inFlight || undefined}
        >
            {inFlight
                ? <Loader2 size={16} className={styles['oauth-spinner']} aria-hidden="true" />
                : <LogIn size={16} aria-hidden="true" />
            }
            <span>{t(labelKey)}</span>
        </button>
    );
};
