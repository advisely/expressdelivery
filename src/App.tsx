import { useState, useEffect, useCallback, useMemo, useRef, Component } from 'react';
import type { ReactNode } from 'react';
import { Sidebar } from './components/Sidebar';
import { ThreadList } from './components/ThreadList';
import { ReadingPane } from './components/ReadingPane';
import { ComposeModal } from './components/ComposeModal';
import { SettingsModal } from './components/SettingsModal';
import { OnboardingScreen } from './components/OnboardingScreen';
import { UpdateBanner } from './components/UpdateBanner';
import { useEmailStore } from './stores/emailStore';
import type { Account, EmailFull, EmailSummary, Folder } from './stores/emailStore';
import { ipcInvoke, ipcOn } from './lib/ipc';
import { useKeyboardShortcuts } from './lib/useKeyboardShortcuts';
import './index.css';

interface ErrorBoundaryState { hasError: boolean; error: Error | null }

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, color: 'var(--text-primary)' }}>
          <h2>Something went wrong</h2>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{this.state.error?.message}</pre>
          <button onClick={() => this.setState({ hasError: false, error: null })}>
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

interface ComposeState {
  to: string;
  subject: string;
  body: string;
  draftId?: string;
}

function App() {
  const [composeState, setComposeState] = useState<ComposeState | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { accounts, setAccounts, setFolders, selectAccount, setSelectedEmail, selectEmail, setEmails } = useEmailStore();
  const selectedAccountId = useEmailStore(s => s.selectedAccountId);

  const [toast, setToast] = useState<{ message: string; emailId?: string } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const isModalOpen = composeState !== null || isSettingsOpen;

  // Listen for reminder:due events
  useEffect(() => {
    const cleanup = ipcOn('reminder:due', (...args: unknown[]) => {
      const data = args[0] as { emailId?: string; subject?: string; note?: string } | undefined;
      if (!data) return;
      const msg = data.note
        ? `Reminder: ${data.note}`
        : `Reminder: ${data.subject ?? 'Follow up on email'}`;
      clearTimeout(toastTimerRef.current);
      setToast({ message: msg, emailId: data.emailId });
      toastTimerRef.current = setTimeout(() => setToast(null), 8000);
    });
    return () => { cleanup?.(); };
  }, []);

  // Listen for notification:click to navigate to email
  useEffect(() => {
    const cleanup = ipcOn('notification:click', (...args: unknown[]) => {
      const data = args[0] as { emailId?: string } | undefined;
      if (data?.emailId) {
        selectEmail(data.emailId);
        ipcInvoke<EmailFull>('emails:read', data.emailId).then(full => {
          if (full) setSelectedEmail(full);
        });
      }
    });
    return () => { cleanup?.(); };
  }, [selectEmail, setSelectedEmail]);

  // Listen for scheduled:sent and scheduled:failed events
  useEffect(() => {
    const cleanupSent = ipcOn('scheduled:sent', (...args: unknown[]) => {
      const data = args[0] as { scheduledId?: string } | undefined;
      void data;
      clearTimeout(toastTimerRef.current);
      setToast({ message: 'Scheduled email sent successfully' });
      toastTimerRef.current = setTimeout(() => setToast(null), 5000);
    });
    const cleanupFailed = ipcOn('scheduled:failed', (...args: unknown[]) => {
      const data = args[0] as { error?: string } | undefined;
      clearTimeout(toastTimerRef.current);
      setToast({ message: `Scheduled email failed: ${(data?.error ?? 'unknown error').slice(0, 200)}` });
      toastTimerRef.current = setTimeout(() => setToast(null), 8000);
    });
    return () => { cleanupSent?.(); cleanupFailed?.(); };
  }, []);

  const loadAccounts = useCallback(async () => {
    const result = await ipcInvoke<Account[]>('accounts:list');
    if (result && result.length > 0) {
      setAccounts(result);
      selectAccount(result[0].id);
    }
  }, [setAccounts, selectAccount]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    if (!selectedAccountId) return;
    let cancelled = false;
    async function loadFolders() {
      const folders = await ipcInvoke<Folder[]>('folders:list', selectedAccountId);
      if (folders && !cancelled) setFolders(folders);
    }
    loadFolders();
    return () => { cancelled = true; };
  }, [selectedAccountId, setFolders]);

  const handleReply = useCallback((email: EmailFull) => {
    const subject = email.subject?.startsWith('Re:') ? email.subject : `Re: ${email.subject ?? ''}`;
    setComposeState({
      to: email.from_email ?? '',
      subject,
      body: '',
    });
  }, []);

  const handleForward = useCallback((email: EmailFull) => {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const subject = email.subject?.startsWith('Fwd:') ? email.subject : `Fwd: ${email.subject ?? ''}`;
    const fromLine = email.from_name
      ? `${esc(email.from_name)} &lt;${esc(email.from_email ?? '')}&gt;`
      : esc(email.from_email ?? '');
    const dateLine = email.date ? esc(new Date(email.date).toLocaleString()) : '';
    const bodyContent = email.body_html ?? `<p>${esc(email.body_text ?? '').replace(/\n/g, '<br />')}</p>`;
    const forwardedBody = `<br /><hr /><p><strong>---------- Forwarded message ----------</strong><br />From: ${fromLine}<br />Date: ${dateLine}<br />Subject: ${esc(email.subject ?? '')}</p>${bodyContent}`;
    setComposeState({
      to: '',
      subject,
      body: forwardedBody,
    });
  }, []);

  const handleNavigateEmail = useCallback(async (direction: 'next' | 'prev') => {
    const currentEmails = useEmailStore.getState().emails;
    const currentId = useEmailStore.getState().selectedEmailId;
    if (currentEmails.length === 0) return;

    const currentIndex = currentEmails.findIndex(e => e.id === currentId);
    let nextIndex: number;
    if (direction === 'next') {
      nextIndex = currentIndex < currentEmails.length - 1 ? currentIndex + 1 : currentIndex;
    } else {
      nextIndex = currentIndex > 0 ? currentIndex - 1 : 0;
    }

    const nextEmail = currentEmails[nextIndex];
    if (nextEmail && nextEmail.id !== currentId) {
      selectEmail(nextEmail.id);
      const full = await ipcInvoke<EmailFull>('emails:read', nextEmail.id);
      if (full) setSelectedEmail(full);
    }
  }, [selectEmail, setSelectedEmail]);

  const handleDeleteSelected = useCallback(async () => {
    const email = useEmailStore.getState().selectedEmail;
    if (!email) return;
    try {
      const result = await ipcInvoke<{ success: boolean }>('emails:delete', email.id);
      if (result?.success) {
        setSelectedEmail(null);
        const folderId = useEmailStore.getState().selectedFolderId;
        if (folderId) {
          const refreshed = await ipcInvoke<EmailSummary[]>('emails:list', folderId);
          if (refreshed) setEmails(refreshed);
        }
      }
    } catch { /* deletion failed silently */ }
  }, [setSelectedEmail, setEmails]);

  const handleArchiveSelected = useCallback(async () => {
    const email = useEmailStore.getState().selectedEmail;
    if (!email) return;
    const result = await ipcInvoke<{ success: boolean }>('emails:archive', email.id);
    if (result?.success) {
      setSelectedEmail(null);
      const folderId = useEmailStore.getState().selectedFolderId;
      if (folderId) {
        const refreshed = await ipcInvoke<EmailSummary[]>('emails:list', folderId);
        if (refreshed) setEmails(refreshed);
      }
    }
  }, [setSelectedEmail, setEmails]);

  const shortcuts = useMemo(() => ({
    'mod+n': () => setComposeState({ to: '', subject: '', body: '' }),
    'mod+,': () => setIsSettingsOpen(true),
    'r': () => {
      const email = useEmailStore.getState().selectedEmail;
      if (email) handleReply(email);
    },
    'f': () => {
      const email = useEmailStore.getState().selectedEmail;
      if (email) handleForward(email);
    },
    'delete': handleDeleteSelected,
    'e': handleArchiveSelected,
    'j': () => handleNavigateEmail('next'),
    'k': () => handleNavigateEmail('prev'),
    'escape': () => {
      if (composeState !== null) setComposeState(null);
      else if (isSettingsOpen) setIsSettingsOpen(false);
      else setSelectedEmail(null);
    },
  }), [handleReply, handleForward, handleDeleteSelected, handleArchiveSelected, handleNavigateEmail, composeState, isSettingsOpen, setSelectedEmail]);

  useKeyboardShortcuts(shortcuts, !isModalOpen);

  if (accounts.length === 0) {
    return (
      <ErrorBoundary>
        <OnboardingScreen onAccountAdded={loadAccounts} />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <div className="app-container">
        <UpdateBanner />
        <Sidebar
          onCompose={() => setComposeState({ to: '', subject: '', body: '' })}
          onSettings={() => setIsSettingsOpen(true)}
        />
        <div className="main-content">
          <ThreadList />
          <ReadingPane onReply={handleReply} onForward={handleForward} />
        </div>

        {composeState !== null && (
          <ComposeModal
            onClose={() => setComposeState(null)}
            initialTo={composeState.to}
            initialSubject={composeState.subject}
            initialBody={composeState.body}
            draftId={composeState.draftId}
          />
        )}

        {isSettingsOpen && (
          <SettingsModal onClose={() => setIsSettingsOpen(false)} />
        )}

        {toast && (
          <div className="toast-notification" role="alert" aria-live="polite">
            <span>{toast.message}</span>
            <button className="toast-close" onClick={() => setToast(null)} aria-label="Dismiss notification">
              &times;
            </button>
          </div>
        )}
      </div>
      <style>{`
        .toast-notification {
          position: fixed;
          bottom: 24px;
          right: 24px;
          background: rgb(var(--color-bg-elevated));
          color: var(--text-primary);
          border: 1px solid var(--glass-border);
          border-radius: 8px;
          padding: 12px 16px;
          display: flex;
          align-items: center;
          gap: 12px;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
          z-index: 2000;
          max-width: 400px;
          font-size: 13px;
          animation: toastSlideIn 0.2s ease-out;
        }

        .toast-close {
          color: var(--text-secondary);
          font-size: 18px;
          line-height: 1;
          padding: 2px 4px;
          border-radius: 4px;
          flex-shrink: 0;
        }

        .toast-close:hover {
          background: var(--hover-bg);
          color: var(--text-primary);
        }

        @keyframes toastSlideIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @media (prefers-reduced-motion: reduce) {
          .toast-notification { animation: none !important; }
        }
      `}</style>
    </ErrorBoundary>
  );
}

export default App;
