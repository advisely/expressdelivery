import { useState, useEffect, useCallback, useMemo, Component } from 'react';
import type { ReactNode } from 'react';
import { Sidebar } from './components/Sidebar';
import { ThreadList } from './components/ThreadList';
import { ReadingPane } from './components/ReadingPane';
import { ComposeModal } from './components/ComposeModal';
import { SettingsModal } from './components/SettingsModal';
import { OnboardingScreen } from './components/OnboardingScreen';
import { useEmailStore } from './stores/emailStore';
import type { Account, EmailFull, EmailSummary, Folder } from './stores/emailStore';
import { ipcInvoke } from './lib/ipc';
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

  const isModalOpen = composeState !== null || isSettingsOpen;

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
      </div>
    </ErrorBoundary>
  );
}

export default App;
