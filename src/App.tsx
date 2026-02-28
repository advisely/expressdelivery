import { useState, useEffect, useCallback, useMemo, useRef, Component, lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import { Sidebar } from './components/Sidebar';
import { ThreadList } from './components/ThreadList';
import { ReadingPane } from './components/ReadingPane';
const ComposeModal = lazy(() => import('./components/ComposeModal').then(m => ({ default: m.ComposeModal })));
const SettingsModal = lazy(() => import('./components/SettingsModal').then(m => ({ default: m.SettingsModal })));
import { OnboardingScreen } from './components/OnboardingScreen';
import { UpdateBanner } from './components/UpdateBanner';
import { useEmailStore } from './stores/emailStore';
import type { Account, EmailFull, EmailSummary, Folder } from './stores/emailStore';
import { useTranslation } from 'react-i18next';
import { ipcInvoke, ipcOn } from './lib/ipc';
import { useKeyboardShortcuts } from './lib/useKeyboardShortcuts';
import type { SendPayload } from './components/ComposeModal';
import './index.css';
import appStyles from './components/App.module.css';

interface ErrorBoundaryState { hasError: boolean; error: Error | null }

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log renderer crashes to main process log file — pre-truncate each field so the most diagnostic parts survive
    const msg = `[RENDERER CRASH] ${error.message} | Stack: ${(error.stack ?? '').slice(0, 800)} | Component: ${(info.componentStack ?? '').slice(0, 800)}`;
    ipcInvoke('log:error', msg).catch(() => {});
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
  accountId?: string;
}

interface PendingSend {
  payload: SendPayload;
  timerId: ReturnType<typeof setTimeout>;
  countdown: number;
}

function App() {
  const { t } = useTranslation();
  const [composeState, setComposeState] = useState<ComposeState | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { accounts, setAccounts, setFolders, selectAccount, selectFolder, setSelectedEmail, selectEmail, setEmails } = useEmailStore();
  const selectedAccountId = useEmailStore(s => s.selectedAccountId);

  const [startupReady, setStartupReady] = useState(false);
  const [toast, setToast] = useState<{ message: string; emailId?: string; undo?: () => void } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [undoSendDelay, setUndoSendDelay] = useState(5);
  const [pendingSend, setPendingSend] = useState<PendingSend | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const showToast = useCallback((message: string, undo?: () => void) => {
    clearTimeout(toastTimerRef.current);
    setToast({ message, undo });
    toastTimerRef.current = setTimeout(() => setToast(null), 5000);
  }, []);

  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const isModalOpen = composeState !== null || isSettingsOpen || showShortcutHelp;

  // Listen for reminder:due events
  useEffect(() => {
    const cleanup = ipcOn('reminder:due', (...args: unknown[]) => {
      const data = args[0] as { emailId?: string; subject?: string; note?: string } | undefined;
      if (!data) return;
      const msg = data.note
        ? t('toast.reminderNote', { note: data.note })
        : data.subject ? t('toast.reminderSubject', { subject: data.subject }) : t('toast.reminderDefault');
      showToast(msg);
    });
    return () => { cleanup?.(); };
  }, [t, showToast]);

  // Listen for notification:click to navigate to email
  useEffect(() => {
    const cleanup = ipcOn('notification:click', (...args: unknown[]) => {
      const data = args[0] as { emailId?: string; accountId?: string; folderId?: string } | undefined;
      if (!data) return;
      // Switch account if needed
      if (data.accountId && data.accountId !== useEmailStore.getState().selectedAccountId) {
        selectAccount(data.accountId);
      }
      // Switch folder if needed
      if (data.folderId) {
        selectFolder(data.folderId);
      }
      // Select email if specified
      if (data.emailId) {
        selectEmail(data.emailId);
        ipcInvoke<EmailFull>('emails:read', data.emailId).then(full => {
          if (full) setSelectedEmail(full);
        });
      }
    });
    return () => { cleanup?.(); };
  }, [selectEmail, selectAccount, selectFolder, setSelectedEmail]);

  // Listen for scheduled:sent and scheduled:failed events
  useEffect(() => {
    const cleanupSent = ipcOn('scheduled:sent', (...args: unknown[]) => {
      const data = args[0] as { scheduledId?: string } | undefined;
      void data;
      showToast(t('toast.scheduledSent'));
    });
    const cleanupFailed = ipcOn('scheduled:failed', (...args: unknown[]) => {
      const data = args[0] as { error?: string } | undefined;
      showToast(t('toast.scheduledFailed', { error: (data?.error ?? 'unknown error').slice(0, 200) }));
    });
    return () => { cleanupSent?.(); cleanupFailed?.(); };
  }, [t, showToast]);

  const loadAccounts = useCallback(async () => {
    const result = await ipcInvoke<Account[]>('accounts:list');
    if (result && result.length > 0) {
      setAccounts(result);
      selectAccount(result[0].id);
    }
  }, [setAccounts, selectAccount]);

  // Single IPC call at startup: accounts + folders + inbox emails + settings in one round-trip
  useEffect(() => {
    let cancelled = false;

    function updateSplash(text: string, percent: number) {
      const splash = document.getElementById('splash');
      if (!splash) return;
      const textEl = document.getElementById('splash-text');
      const barEl = document.getElementById('splash-progress-bar');
      if (textEl) textEl.textContent = text;
      if (barEl) barEl.style.width = `${percent}%`;
      splash.setAttribute('aria-valuenow', String(percent));
    }

    function removeSplash() {
      const splash = document.getElementById('splash');
      if (splash) {
        splash.classList.add('fade-out');
        setTimeout(() => splash.remove(), 300);
      }
    }

    async function startupLoad() {
      updateSplash('Loading accounts...', 30);

      const result = await ipcInvoke<{
        accounts: Account[]; folders: Folder[]; emails: EmailSummary[];
        selectedAccountId: string | null; selectedFolderId: string | null;
        settings?: { undo_send_delay?: string };
        appVersion?: string;
      }>('startup:load');
      if (!result || cancelled) return;

      updateSplash('Loading mailbox...', 60);

      if (result.accounts.length > 0) {
        setAccounts(result.accounts);
        selectAccount(result.selectedAccountId ?? result.accounts[0].id);
        setFolders(result.folders);
        if (result.selectedFolderId) selectFolder(result.selectedFolderId);
        if (result.emails.length > 0) setEmails(result.emails);
      }

      // Apply bundled settings
      if (result.settings?.undo_send_delay) {
        setUndoSendDelay(Number(result.settings.undo_send_delay) || 5);
      }
      if (result.appVersion) {
        useEmailStore.getState().setAppVersion(result.appVersion);
      }

      updateSplash('Ready', 100);

      if (!cancelled) {
        setStartupReady(true);
        removeSplash();
      }
    }

    updateSplash('Initializing...', 10);
    startupLoad();
    return () => { cancelled = true; };
  }, [setAccounts, selectAccount, setFolders, selectFolder, setEmails]);

  // Clean up pending send timers on unmount
  useEffect(() => {
    return () => {
      if (pendingSend) {
        clearTimeout(pendingSend.timerId);
        clearInterval(countdownRef.current);
      }
    };
  }, [pendingSend]);

  // Reload folders when account changes (after initial startup)
  useEffect(() => {
    if (!selectedAccountId) return;
    let cancelled = false;
    async function loadFolders() {
      const folders = await ipcInvoke<Folder[]>('folders:list', selectedAccountId);
      if (Array.isArray(folders) && !cancelled) {
        setFolders(folders);
        const inbox = folders.find((f: Folder) => f.type === 'inbox');
        if (inbox) selectFolder(inbox.id);
      }
    }
    loadFolders();
    return () => { cancelled = true; };
  }, [selectedAccountId, setFolders, selectFolder]);

  const handleReply = useCallback((email: EmailFull, initialBody?: string) => {
    const subject = email.subject?.startsWith('Re:') ? email.subject : `Re: ${email.subject ?? ''}`;
    setComposeState({
      to: email.from_email ?? '',
      subject,
      body: initialBody ?? '',
      accountId: email.account_id,
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
      accountId: email.account_id,
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

  const handleSendPending = useCallback((payload: SendPayload) => {
    const ipcPayload = {
      accountId: payload.accountId,
      to: payload.to,
      subject: payload.subject,
      html: payload.body,
      ...(payload.cc ? { cc: payload.cc } : {}),
      ...(payload.bcc ? { bcc: payload.bcc } : {}),
      ...(payload.attachments ? { attachments: payload.attachments } : {}),
    };

    if (undoSendDelay === 0) {
      ipcInvoke('email:send', ipcPayload);
      return;
    }

    let remaining = undoSendDelay;
    const timerId = setTimeout(() => {
      clearInterval(countdownRef.current);
      setPendingSend(null);
      ipcInvoke('email:send', ipcPayload);
    }, undoSendDelay * 1000);

    countdownRef.current = setInterval(() => {
      remaining--;
      setPendingSend(prev => prev ? { ...prev, countdown: remaining } : null);
    }, 1000);

    setPendingSend({ payload, timerId, countdown: undoSendDelay });
  }, [undoSendDelay]);

  const handleUndoSend = useCallback(() => {
    if (!pendingSend) return;
    clearTimeout(pendingSend.timerId);
    clearInterval(countdownRef.current);
    setComposeState({
      to: pendingSend.payload.to.join(', '),
      subject: pendingSend.payload.subject,
      body: pendingSend.payload.body,
    });
    setPendingSend(null);
  }, [pendingSend]);

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
      if (showShortcutHelp) setShowShortcutHelp(false);
      else if (composeState !== null) setComposeState(null);
      else if (isSettingsOpen) setIsSettingsOpen(false);
      else setSelectedEmail(null);
    },
    'shift+?': () => setShowShortcutHelp(v => !v),
  }), [handleReply, handleForward, handleDeleteSelected, handleArchiveSelected, handleNavigateEmail, composeState, isSettingsOpen, showShortcutHelp, setSelectedEmail]);

  useKeyboardShortcuts(shortcuts, !isModalOpen);

  // Show nothing while startup:load is in flight (HTML splash is visible)
  if (!startupReady) return null;

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
          onToast={showToast}
        />
        <div className="main-content">
          <ThreadList onReply={handleReply} onForward={handleForward} />
          <ReadingPane onReply={handleReply} onForward={handleForward} onToast={showToast} />
        </div>

        <Suspense fallback={null}>
          {composeState !== null && (
            <ComposeModal
              onClose={() => setComposeState(null)}
              onSendPending={handleSendPending}
              initialTo={composeState.to}
              initialSubject={composeState.subject}
              initialBody={composeState.body}
              draftId={composeState.draftId}
              initialAccountId={composeState.accountId}
            />
          )}

          {isSettingsOpen && (
            <SettingsModal onClose={() => setIsSettingsOpen(false)} />
          )}
        </Suspense>

        {pendingSend && (
          <div className={appStyles['toast-notification']} role="alert" aria-live="polite">
            <span>{t('compose.sendingIn', { seconds: pendingSend.countdown })}</span>
            <button className={appStyles['toast-action']} onClick={handleUndoSend}>
              {t('compose.undoSend')}
            </button>
          </div>
        )}

        {toast && (
          <div className={appStyles['toast-notification']} role="alert" aria-live="polite">
            <span>{toast.message}</span>
            {toast.undo && (
              <button className={appStyles['toast-action']} onClick={() => { toast.undo?.(); setToast(null); }}>
                {t('toast.undo')}
              </button>
            )}
            <button className={appStyles['toast-close']} onClick={() => setToast(null)} aria-label={t('toast.dismissNotification')}>
              &times;
            </button>
          </div>
        )}

        {showShortcutHelp && (
          <div className={appStyles['shortcut-overlay']} onClick={() => setShowShortcutHelp(false)} role="dialog" aria-label={t('shortcuts.title')}>
            <div className={appStyles['shortcut-modal']} onClick={(e) => e.stopPropagation()}>
              <h2 className={appStyles['shortcut-title']}>{t('shortcuts.title')}</h2>
              <div className={appStyles['shortcut-grid']}>
                <div className={appStyles['shortcut-section']}>
                  <h3>{t('shortcuts.navigation')}</h3>
                  <div className={appStyles['shortcut-row']}><kbd>J</kbd> <span>{t('shortcuts.nextEmail')}</span></div>
                  <div className={appStyles['shortcut-row']}><kbd>K</kbd> <span>{t('shortcuts.prevEmail')}</span></div>
                  <div className={appStyles['shortcut-row']}><kbd>Esc</kbd> <span>{t('shortcuts.deselect')}</span></div>
                </div>
                <div className={appStyles['shortcut-section']}>
                  <h3>{t('shortcuts.actions')}</h3>
                  <div className={appStyles['shortcut-row']}><kbd>R</kbd> <span>{t('shortcuts.reply')}</span></div>
                  <div className={appStyles['shortcut-row']}><kbd>F</kbd> <span>{t('shortcuts.forward')}</span></div>
                  <div className={appStyles['shortcut-row']}><kbd>E</kbd> <span>{t('shortcuts.archive')}</span></div>
                  <div className={appStyles['shortcut-row']}><kbd>Del</kbd> <span>{t('shortcuts.delete')}</span></div>
                </div>
                <div className={appStyles['shortcut-section']}>
                  <h3>{t('shortcuts.compose')}</h3>
                  <div className={appStyles['shortcut-row']}><kbd>Ctrl+N</kbd> <span>{t('shortcuts.newEmail')}</span></div>
                  <div className={appStyles['shortcut-row']}><kbd>Ctrl+,</kbd> <span>{t('shortcuts.settings')}</span></div>
                  <div className={appStyles['shortcut-row']}><kbd>?</kbd> <span>{t('shortcuts.help')}</span></div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}

export default App;
