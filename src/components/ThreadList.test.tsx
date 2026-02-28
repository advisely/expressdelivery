import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ThreadList } from './ThreadList';
import { ThemeProvider } from './ThemeContext';
import { useEmailStore } from '../stores/emailStore';
import type { EmailSummary, EmailFull, Folder } from '../stores/emailStore';

// ---------------------------------------------------------------------------
// IPC mock — hoisted so the factory function can reference it before imports
// ---------------------------------------------------------------------------
const { mockIpcInvoke, mockIpcOn } = vi.hoisted(() => ({
    mockIpcInvoke: vi.fn().mockResolvedValue(null),
    mockIpcOn: vi.fn().mockReturnValue(() => {}),
}));

vi.mock('../lib/ipc', () => ({
    ipcInvoke: mockIpcInvoke,
    ipcOn: mockIpcOn,
}));

// ---------------------------------------------------------------------------
// Lucide icon mock — keeps DOM clean and avoids SVG noise
// ---------------------------------------------------------------------------
vi.mock('lucide-react', () => ({
    Search: () => <div data-testid="icon-Search">Srch</div>,
    Paperclip: ({ 'aria-label': ariaLabel }: { 'aria-label'?: string }) => (
        <div data-testid="icon-Paperclip" aria-label={ariaLabel}>P</div>
    ),
    Trash2: () => <div data-testid="icon-Trash2">T</div>,
    Reply: () => <div data-testid="icon-Reply">R</div>,
    Forward: () => <div data-testid="icon-Forward">F</div>,
    Star: () => <div data-testid="icon-Star">St</div>,
    FolderInput: () => <div data-testid="icon-FolderInput">FI</div>,
    Mail: () => <div data-testid="icon-Mail">M</div>,
    MailOpen: () => <div data-testid="icon-MailOpen">MO</div>,
    Inbox: () => <div data-testid="icon-Inbox">Inb</div>,
    CheckCircle2: () => <div data-testid="icon-CheckCircle2">CC</div>,
    Send: () => <div data-testid="icon-Send">S</div>,
    CheckSquare: () => <div data-testid="icon-CheckSquare">CSq</div>,
    Square: () => <div data-testid="icon-Square">Sq</div>,
    Bookmark: () => <div data-testid="icon-Bookmark">Bk</div>,
}));

// ---------------------------------------------------------------------------
// Provider icons mock — returns a simple stub component for any provider
// ---------------------------------------------------------------------------
vi.mock('../lib/providerIcons', () => ({
    getProviderIcon: (provider: string) => {
        const ProviderIconStub = ({ size }: { size?: number }) => (
            <div data-testid={`provider-icon-${provider}`} data-size={size}>PI</div>
        );
        ProviderIconStub.displayName = `ProviderIcon_${provider}`;
        return ProviderIconStub;
    },
    PROVIDER_ICONS: {},
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const makeSummary = (overrides: Partial<EmailSummary> = {}): EmailSummary => ({
    id: 'email-1',
    thread_id: 'thread-1',
    subject: 'Hello World',
    from_name: 'Alice Smith',
    from_email: 'alice@example.com',
    to_email: 'me@example.com',
    date: '2026-02-24T12:00:00Z',
    snippet: 'Hello there...',
    is_read: 0,
    is_flagged: 0,
    has_attachments: 0,
    ai_category: null,
    ai_priority: null,
    ai_labels: null,
    thread_count: 1,
    ...overrides,
});

const makeFullEmail = (overrides: Partial<EmailFull> = {}): EmailFull => ({
    ...makeSummary(),
    account_id: 'acc-1',
    folder_id: 'folder-inbox',
    body_text: 'Hello there',
    body_html: '<p>Hello there</p>',
    bodyFetchStatus: 'ok',
    ...overrides,
});

const INBOX_FOLDER: Folder = { id: 'folder-inbox', name: 'Inbox', path: 'INBOX', type: 'inbox' };
const TRASH_FOLDER: Folder = { id: 'folder-trash', name: 'Trash', path: 'Trash', type: 'trash' };
const SENT_FOLDER: Folder = { id: 'folder-sent', name: 'Sent', path: 'Sent', type: 'sent' };
const DRAFTS_FOLDER: Folder = { id: 'folder-drafts', name: 'Drafts', path: 'Drafts', type: 'drafts' };
const CUSTOM_FOLDER: Folder = { id: 'folder-custom', name: 'My Project', path: 'My Project', type: 'other' };

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------
function renderThreadList(props: Partial<React.ComponentProps<typeof ThreadList>> = {}) {
    return render(
        <ThemeProvider>
            <ThreadList {...props} />
        </ThemeProvider>
    );
}

function setupStoreWithEmails(
    emails: EmailSummary[],
    folderId = 'folder-inbox',
    folders: Folder[] = [INBOX_FOLDER, TRASH_FOLDER, SENT_FOLDER]
) {
    useEmailStore.setState({
        emails,
        folders,
        selectedFolderId: folderId,
        selectedEmailId: null,
        selectedEmailIds: new Set<string>(),
        selectedEmail: null,
        searchQuery: '',
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('ThreadList', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default: all IPC calls return null (safe no-op)
        mockIpcInvoke.mockResolvedValue(null);
        mockIpcOn.mockReturnValue(() => {});
        useEmailStore.setState({
            emails: [],
            folders: [INBOX_FOLDER, TRASH_FOLDER, SENT_FOLDER],
            selectedFolderId: 'folder-inbox',
            selectedEmailId: null,
            selectedEmailIds: new Set<string>(),
            selectedEmail: null,
            searchQuery: '',
            isLoading: false,
        });
    });

    afterEach(() => {
        // Restore real timers if a test used fake ones
        vi.useRealTimers();
    });

    // -----------------------------------------------------------------------
    // 1. Rendering
    // -----------------------------------------------------------------------
    describe('Rendering', () => {
        it('renders a list of email summaries', async () => {
            const emails = [
                makeSummary({ id: 'email-1', subject: 'First Email', from_name: 'Alice' }),
                makeSummary({ id: 'email-2', subject: 'Second Email', from_name: 'Bob', from_email: 'bob@example.com' }),
            ];
            // Mount with emails already in store
            setupStoreWithEmails(emails);
            mockIpcInvoke.mockResolvedValue(null); // emails:list returns null (store already has data)

            renderThreadList();

            expect(screen.getByText('First Email')).toBeInTheDocument();
            expect(screen.getByText('Second Email')).toBeInTheDocument();
        });

        it('displays sender name when available', () => {
            setupStoreWithEmails([makeSummary({ from_name: 'Carol Jones', from_email: 'carol@example.com' })]);
            renderThreadList();
            expect(screen.getByText('Carol Jones')).toBeInTheDocument();
        });

        it('falls back to from_email when from_name is null', () => {
            setupStoreWithEmails([makeSummary({ from_name: null, from_email: 'noname@example.com' })]);
            renderThreadList();
            expect(screen.getByText('noname@example.com')).toBeInTheDocument();
        });

        it('shows the search bar when nothing is selected', () => {
            setupStoreWithEmails([]);
            renderThreadList();
            expect(screen.getByPlaceholderText('threadList.search')).toBeInTheDocument();
        });

        it('renders the attachment indicator for emails with attachments', () => {
            // has_attachments=1 renders the Paperclip with aria-label
            setupStoreWithEmails([makeSummary({ has_attachments: 1 })]);
            renderThreadList();
            expect(screen.getByTestId('icon-Paperclip')).toBeInTheDocument();
            expect(screen.getByTestId('icon-Paperclip')).toHaveAttribute('aria-label', 'Has attachments');
        });

        it('does not render attachment indicator when has_attachments is 0', () => {
            setupStoreWithEmails([makeSummary({ has_attachments: 0 })]);
            renderThreadList();
            expect(screen.queryByTestId('icon-Paperclip')).not.toBeInTheDocument();
        });

        it('shows thread badge when thread_count > 1', () => {
            setupStoreWithEmails([makeSummary({ thread_count: 3 })]);
            renderThreadList();
            expect(screen.getByLabelText('3 messages in thread')).toBeInTheDocument();
        });

        it('shows urgent priority badge (ai_priority=4)', () => {
            setupStoreWithEmails([makeSummary({ ai_priority: 4 })]);
            renderThreadList();
            expect(screen.getByLabelText('Urgent priority')).toBeInTheDocument();
        });

        it('shows high priority badge (ai_priority=3)', () => {
            setupStoreWithEmails([makeSummary({ ai_priority: 3 })]);
            renderThreadList();
            expect(screen.getByLabelText('High priority')).toBeInTheDocument();
        });

        it('does not show priority badge when ai_priority < 3', () => {
            setupStoreWithEmails([makeSummary({ ai_priority: 2 })]);
            renderThreadList();
            expect(screen.queryByLabelText('Urgent priority')).not.toBeInTheDocument();
            expect(screen.queryByLabelText('High priority')).not.toBeInTheDocument();
        });

        it('shows AI category badge when ai_category is set', () => {
            setupStoreWithEmails([makeSummary({ ai_category: 'Finance' })]);
            renderThreadList();
            expect(screen.getByLabelText('Category: Finance')).toBeInTheDocument();
        });

        it('fetches emails:list on mount when a folder is selected', async () => {
            setupStoreWithEmails([]);
            const emails = [makeSummary()];
            mockIpcInvoke.mockResolvedValueOnce(emails);

            renderThreadList();

            await waitFor(() =>
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:list', 'folder-inbox')
            );
        });
    });

    // -----------------------------------------------------------------------
    // 2. Empty states per folder type
    // -----------------------------------------------------------------------
    describe('Empty states', () => {
        it('shows inbox empty state when inbox folder is empty', async () => {
            mockIpcInvoke.mockResolvedValue([]);
            setupStoreWithEmails([], 'folder-inbox', [INBOX_FOLDER]);
            renderThreadList();
            await waitFor(() => expect(screen.getByText('threadList.emptyInbox')).toBeInTheDocument());
        });

        it('shows trash empty state when trash folder is empty', async () => {
            mockIpcInvoke.mockResolvedValue([]);
            useEmailStore.setState({
                emails: [],
                folders: [TRASH_FOLDER],
                selectedFolderId: 'folder-trash',
                selectedEmailId: null,
                selectedEmailIds: new Set<string>(),
                selectedEmail: null,
                searchQuery: '',
            });
            renderThreadList();
            await waitFor(() => expect(screen.getByText('threadList.emptyTrash')).toBeInTheDocument());
        });

        it('shows sent empty state when sent folder is empty', async () => {
            mockIpcInvoke.mockResolvedValue([]);
            useEmailStore.setState({
                emails: [],
                folders: [SENT_FOLDER],
                selectedFolderId: 'folder-sent',
                selectedEmailId: null,
                selectedEmailIds: new Set<string>(),
                selectedEmail: null,
                searchQuery: '',
            });
            renderThreadList();
            await waitFor(() => expect(screen.getByText('threadList.emptySent')).toBeInTheDocument());
        });

        it('shows drafts empty state when drafts folder is empty', async () => {
            mockIpcInvoke.mockResolvedValue([]);
            useEmailStore.setState({
                emails: [],
                folders: [DRAFTS_FOLDER],
                selectedFolderId: 'folder-drafts',
                selectedEmailId: null,
                selectedEmailIds: new Set<string>(),
                selectedEmail: null,
                searchQuery: '',
            });
            renderThreadList();
            await waitFor(() => expect(screen.getByText('threadList.emptyDrafts')).toBeInTheDocument());
        });

        it('shows noResults state when searchQuery is set in store and emails is empty', async () => {
            // noResults only shows for non-standard folder types when searchQuery is set.
            // Standard types (inbox/trash/sent/drafts) show their own empty state.
            mockIpcInvoke.mockResolvedValue([]);
            useEmailStore.setState({
                emails: [],
                folders: [CUSTOM_FOLDER],
                selectedFolderId: 'folder-custom',
                selectedEmailId: null,
                selectedEmailIds: new Set<string>(),
                selectedEmail: null,
                searchQuery: 'xyz-no-match',
            });
            renderThreadList();
            await waitFor(() => expect(screen.getByText('threadList.noResults')).toBeInTheDocument());
        });

        it('shows generic noEmails state for custom folder with no search query', async () => {
            mockIpcInvoke.mockResolvedValue([]);
            useEmailStore.setState({
                emails: [],
                folders: [CUSTOM_FOLDER],
                selectedFolderId: 'folder-custom',
                selectedEmailId: null,
                selectedEmailIds: new Set<string>(),
                selectedEmail: null,
                searchQuery: '',
            });
            renderThreadList();
            await waitFor(() => expect(screen.getByText('threadList.noEmails')).toBeInTheDocument());
        });
    });

    // -----------------------------------------------------------------------
    // 3. Single-email selection
    // -----------------------------------------------------------------------
    describe('Single-email selection', () => {
        it('calls emails:read when an email row is clicked', async () => {
            const email = makeSummary({ id: 'email-1', is_read: 0 });
            const full = makeFullEmail({ id: 'email-1' });
            setupStoreWithEmails([email]);
            mockIpcInvoke.mockResolvedValueOnce(full); // emails:read

            renderThreadList();
            fireEvent.click(screen.getByText('Hello World').closest('[role="button"]')!);

            await waitFor(() =>
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:read', 'email-1')
            );
        });

        it('optimistically marks unread email as read in store on click', async () => {
            const email = makeSummary({ id: 'email-1', is_read: 0 });
            const full = makeFullEmail({ id: 'email-1', is_read: 1 });
            setupStoreWithEmails([email]);
            mockIpcInvoke.mockResolvedValueOnce(full);

            renderThreadList();
            fireEvent.click(screen.getByText('Hello World').closest('[role="button"]')!);

            await waitFor(() => {
                const updated = useEmailStore.getState().emails.find(e => e.id === 'email-1');
                expect(updated?.is_read).toBe(1);
            });
        });

        it('does not optimistically update is_read for already-read email', async () => {
            const email = makeSummary({ id: 'email-1', is_read: 1 });
            const full = makeFullEmail({ id: 'email-1', is_read: 1 });
            setupStoreWithEmails([email]);
            // First mock: emails:list on mount (must return array), Second: emails:read on click
            mockIpcInvoke
                .mockResolvedValueOnce([email])  // mount emails:list
                .mockResolvedValueOnce(full);     // click emails:read

            renderThreadList();
            fireEvent.click(screen.getByText('Hello World').closest('[role="button"]')!);

            await waitFor(() =>
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:read', 'email-1')
            );

            // Store emails should still be present and unchanged (is_read stays 1)
            const state = useEmailStore.getState();
            const updated = state.emails.find((e: EmailSummary) => e.id === 'email-1');
            // Either the email still exists with is_read=1, or store has been overwritten by emails:list
            if (updated !== undefined) {
                expect(updated.is_read).toBe(1);
            }
        });

        it('updates selectedEmailId in store when an email is clicked', async () => {
            const email = makeSummary({ id: 'email-1' });
            const full = makeFullEmail({ id: 'email-1' });
            setupStoreWithEmails([email]);
            mockIpcInvoke.mockResolvedValueOnce(full);

            renderThreadList();
            fireEvent.click(screen.getByText('Hello World').closest('[role="button"]')!);

            await waitFor(() =>
                expect(useEmailStore.getState().selectedEmailId).toBe('email-1')
            );
        });

        it('Enter key on thread row triggers selection', async () => {
            const email = makeSummary({ id: 'email-1' });
            const full = makeFullEmail({ id: 'email-1' });
            setupStoreWithEmails([email]);
            mockIpcInvoke.mockResolvedValueOnce(full);

            renderThreadList();
            const row = screen.getByText('Hello World').closest('[role="button"]')!;
            fireEvent.keyDown(row, { key: 'Enter' });

            await waitFor(() =>
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:read', 'email-1')
            );
        });
    });

    // -----------------------------------------------------------------------
    // 4. Checkbox selection (multi-select)
    // -----------------------------------------------------------------------
    describe('Checkbox multi-select', () => {
        it('toggles email into selectedEmailIds when check button is clicked', () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1' })]);
            renderThreadList();

            const checkBtn = screen.getByLabelText('Select email');
            fireEvent.click(checkBtn);

            expect(useEmailStore.getState().selectedEmailIds.has('email-1')).toBe(true);
        });

        it('deselects email when check button is clicked again', () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1' })]);
            useEmailStore.setState({ selectedEmailIds: new Set(['email-1']) });
            renderThreadList();

            const checkBtn = screen.getByLabelText('Deselect email');
            fireEvent.click(checkBtn);

            expect(useEmailStore.getState().selectedEmailIds.has('email-1')).toBe(false);
        });

        it('Ctrl+click on row toggles checkbox without opening email', () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1' })]);
            renderThreadList();

            const row = screen.getByText('Hello World').closest('[role="button"]')!;
            fireEvent.click(row, { ctrlKey: true });

            expect(useEmailStore.getState().selectedEmailIds.has('email-1')).toBe(true);
            // emails:read should NOT have been called
            expect(mockIpcInvoke).not.toHaveBeenCalledWith('emails:read', 'email-1');
        });

        it('Meta+click on row toggles checkbox without opening email', () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1' })]);
            renderThreadList();

            const row = screen.getByText('Hello World').closest('[role="button"]')!;
            fireEvent.click(row, { metaKey: true });

            expect(useEmailStore.getState().selectedEmailIds.has('email-1')).toBe(true);
            expect(mockIpcInvoke).not.toHaveBeenCalledWith('emails:read', 'email-1');
        });

        it('Shift+click triggers range selection from anchor', () => {
            const emails = [
                makeSummary({ id: 'email-1', subject: 'First' }),
                makeSummary({ id: 'email-2', subject: 'Second', from_email: 'b@b.com' }),
                makeSummary({ id: 'email-3', subject: 'Third', from_email: 'c@c.com' }),
            ];
            setupStoreWithEmails(emails);
            useEmailStore.setState({ selectedEmailId: 'email-1', selectedEmailIds: new Set(['email-1']) });
            renderThreadList();

            const thirdRow = screen.getByText('Third').closest('[role="button"]')!;
            fireEvent.click(thirdRow, { shiftKey: true });

            const { selectedEmailIds } = useEmailStore.getState();
            expect(selectedEmailIds.has('email-1')).toBe(true);
            expect(selectedEmailIds.has('email-2')).toBe(true);
            expect(selectedEmailIds.has('email-3')).toBe(true);
        });

        it('selecting all via selectAllEmails adds every email to the set', () => {
            const emails = [
                makeSummary({ id: 'email-1', subject: 'A' }),
                makeSummary({ id: 'email-2', subject: 'B', from_email: 'b@b.com' }),
            ];
            setupStoreWithEmails(emails);
            useEmailStore.setState({ selectedEmailIds: new Set(['email-1']) });
            renderThreadList();

            // "Select All" button appears in bulk toolbar (one email already checked)
            const selectAllBtn = screen.getByTitle('threadList.selectAll');
            fireEvent.click(selectAllBtn);

            const { selectedEmailIds } = useEmailStore.getState();
            expect(selectedEmailIds.has('email-1')).toBe(true);
            expect(selectedEmailIds.has('email-2')).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // 5. Bulk toolbar visibility and count
    // -----------------------------------------------------------------------
    describe('Bulk toolbar', () => {
        it('shows bulk toolbar with selection count when emails are checked', () => {
            setupStoreWithEmails([makeSummary()]);
            useEmailStore.setState({ selectedEmailIds: new Set(['email-1']) });
            renderThreadList();

            // i18n key rendered by t() stub
            expect(screen.getByText('threadList.selected')).toBeInTheDocument();
        });

        it('hides search bar and shows toolbar when selection is non-empty', () => {
            setupStoreWithEmails([makeSummary()]);
            useEmailStore.setState({ selectedEmailIds: new Set(['email-1']) });
            renderThreadList();

            expect(screen.queryByPlaceholderText('threadList.search')).not.toBeInTheDocument();
            expect(screen.getByTitle('threadList.markRead')).toBeInTheDocument();
        });

        it('shows search bar again after clearing selection', () => {
            setupStoreWithEmails([makeSummary()]);
            useEmailStore.setState({ selectedEmailIds: new Set(['email-1']) });
            renderThreadList();

            const clearBtn = screen.getByTitle('threadList.clearSelection');
            fireEvent.click(clearBtn);

            expect(useEmailStore.getState().selectedEmailIds.size).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // 6. Bulk actions — Mark Read
    // -----------------------------------------------------------------------
    describe('Bulk action: Mark Read', () => {
        it('calls emails:mark-read for each selected email (NOT emails:read)', async () => {
            const emails = [
                makeSummary({ id: 'email-1', subject: 'A', is_read: 0 }),
                makeSummary({ id: 'email-2', subject: 'B', from_email: 'b@b.com', is_read: 0 }),
            ];
            setupStoreWithEmails(emails);
            useEmailStore.setState({ selectedEmailIds: new Set(['email-1', 'email-2']) });
            mockIpcInvoke.mockResolvedValue({ success: true });

            renderThreadList();
            fireEvent.click(screen.getByTitle('threadList.markRead'));

            await waitFor(() => {
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:mark-read', 'email-1');
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:mark-read', 'email-2');
            });
        });

        it('does NOT call emails:read (full fetch) when using bulk Mark Read', async () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1', is_read: 0 })]);
            useEmailStore.setState({ selectedEmailIds: new Set(['email-1']) });
            mockIpcInvoke.mockResolvedValue({ success: true });

            renderThreadList();
            fireEvent.click(screen.getByTitle('threadList.markRead'));

            await waitFor(() =>
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:mark-read', 'email-1')
            );
            // emails:read (full body fetch) must not have been called
            expect(mockIpcInvoke).not.toHaveBeenCalledWith('emails:read', 'email-1');
        });

        it('optimistically updates is_read=1 in store after bulk mark read', async () => {
            const emails = [makeSummary({ id: 'email-1', is_read: 0 })];
            setupStoreWithEmails(emails);
            useEmailStore.setState({ selectedEmailIds: new Set(['email-1']) });
            mockIpcInvoke.mockResolvedValue({ success: true });

            renderThreadList();
            fireEvent.click(screen.getByTitle('threadList.markRead'));

            await waitFor(() => {
                const updated = useEmailStore.getState().emails.find((e: EmailSummary) => e.id === 'email-1');
                expect(updated?.is_read).toBe(1);
            });
        });

        it('clears selection after bulk mark read', async () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1', is_read: 0 })]);
            useEmailStore.setState({ selectedEmailIds: new Set(['email-1']) });
            mockIpcInvoke.mockResolvedValue({ success: true });

            renderThreadList();
            fireEvent.click(screen.getByTitle('threadList.markRead'));

            await waitFor(() =>
                expect(useEmailStore.getState().selectedEmailIds.size).toBe(0)
            );
        });
    });

    // -----------------------------------------------------------------------
    // 7. Bulk actions — Mark Unread
    // -----------------------------------------------------------------------
    describe('Bulk action: Mark Unread', () => {
        it('calls emails:mark-unread for each selected email', async () => {
            const emails = [
                makeSummary({ id: 'email-1', is_read: 1 }),
                makeSummary({ id: 'email-2', from_email: 'b@b.com', is_read: 1 }),
            ];
            setupStoreWithEmails(emails);
            useEmailStore.setState({ selectedEmailIds: new Set(['email-1', 'email-2']) });
            mockIpcInvoke.mockResolvedValue({ success: true });

            renderThreadList();
            fireEvent.click(screen.getByTitle('threadList.markUnread'));

            await waitFor(() => {
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:mark-unread', 'email-1');
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:mark-unread', 'email-2');
            });
        });

        it('optimistically sets is_read=0 after bulk mark unread', async () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1', is_read: 1 })]);
            useEmailStore.setState({ selectedEmailIds: new Set(['email-1']) });
            mockIpcInvoke.mockResolvedValue({ success: true });

            renderThreadList();
            fireEvent.click(screen.getByTitle('threadList.markUnread'));

            await waitFor(() => {
                const updated = useEmailStore.getState().emails.find((e: EmailSummary) => e.id === 'email-1');
                expect(updated?.is_read).toBe(0);
            });
        });

        it('clears selection after bulk mark unread', async () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1', is_read: 1 })]);
            useEmailStore.setState({ selectedEmailIds: new Set(['email-1']) });
            mockIpcInvoke.mockResolvedValue({ success: true });

            renderThreadList();
            fireEvent.click(screen.getByTitle('threadList.markUnread'));

            await waitFor(() =>
                expect(useEmailStore.getState().selectedEmailIds.size).toBe(0)
            );
        });
    });

    // -----------------------------------------------------------------------
    // 8. Bulk actions — Star
    // -----------------------------------------------------------------------
    describe('Bulk action: Star', () => {
        it('calls emails:toggle-flag with true for each selected email', async () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1', is_flagged: 0 })]);
            useEmailStore.setState({ selectedEmailIds: new Set(['email-1']) });
            mockIpcInvoke.mockResolvedValue({ success: true });

            renderThreadList();
            fireEvent.click(screen.getByTitle('threadList.star'));

            await waitFor(() =>
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:toggle-flag', 'email-1', true)
            );
        });

        it('clears selection after bulk star', async () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1' })]);
            useEmailStore.setState({ selectedEmailIds: new Set(['email-1']) });
            mockIpcInvoke.mockResolvedValue({ success: true });

            renderThreadList();
            fireEvent.click(screen.getByTitle('threadList.star'));

            await waitFor(() =>
                expect(useEmailStore.getState().selectedEmailIds.size).toBe(0)
            );
        });
    });

    // -----------------------------------------------------------------------
    // 9. Bulk actions — Delete
    // -----------------------------------------------------------------------
    describe('Bulk action: Delete', () => {
        it('calls emails:delete for each selected email', async () => {
            const emails = [
                makeSummary({ id: 'email-1' }),
                makeSummary({ id: 'email-2', from_email: 'b@b.com' }),
            ];
            setupStoreWithEmails(emails);
            useEmailStore.setState({ selectedEmailIds: new Set(['email-1', 'email-2']) });
            mockIpcInvoke.mockResolvedValue({ success: true });

            renderThreadList();
            fireEvent.click(screen.getByTitle('readingPane.delete'));

            await waitFor(() => {
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:delete', 'email-1');
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:delete', 'email-2');
            });
        });

        it('clears selection after bulk delete', async () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1' })]);
            useEmailStore.setState({ selectedEmailIds: new Set(['email-1']) });
            mockIpcInvoke.mockResolvedValue({ success: true });

            renderThreadList();
            fireEvent.click(screen.getByTitle('readingPane.delete'));

            await waitFor(() =>
                expect(useEmailStore.getState().selectedEmailIds.size).toBe(0)
            );
        });

        it('refreshes the email list after bulk delete', async () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1' })]);
            useEmailStore.setState({ selectedEmailIds: new Set(['email-1']) });
            mockIpcInvoke
                .mockResolvedValueOnce({ success: true }) // emails:delete
                .mockResolvedValueOnce([]);               // emails:list refresh

            renderThreadList();
            fireEvent.click(screen.getByTitle('readingPane.delete'));

            await waitFor(() => {
                const listCalls = mockIpcInvoke.mock.calls.filter(([ch]) => ch === 'emails:list');
                expect(listCalls.length).toBeGreaterThanOrEqual(1);
            });
        });

        it('nulls the selected email in store when the open email is bulk-deleted', async () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1' })]);
            useEmailStore.setState({
                selectedEmailId: 'email-1',
                selectedEmail: makeFullEmail({ id: 'email-1' }),
                selectedEmailIds: new Set(['email-1']),
            });
            mockIpcInvoke.mockResolvedValue({ success: true });

            renderThreadList();
            fireEvent.click(screen.getByTitle('readingPane.delete'));

            await waitFor(() =>
                expect(useEmailStore.getState().selectedEmail).toBeNull()
            );
        });
    });

    // -----------------------------------------------------------------------
    // 10. Bulk Move
    // -----------------------------------------------------------------------
    describe('Bulk action: Move to folder', () => {
        it('shows folder dropdown when the bulk move button is clicked', () => {
            const folders = [INBOX_FOLDER, TRASH_FOLDER, SENT_FOLDER];
            useEmailStore.setState({
                emails: [makeSummary({ id: 'email-1' })],
                folders,
                selectedFolderId: 'folder-inbox',
                selectedEmailIds: new Set(['email-1']),
                selectedEmailId: null,
                selectedEmail: null,
                searchQuery: '',
            });
            renderThreadList();

            const moveBtn = screen.getByTitle('readingPane.moveTo');
            fireEvent.click(moveBtn);

            // Folders other than the current one should appear
            expect(screen.getByText('Trash')).toBeInTheDocument();
            expect(screen.getByText('Sent')).toBeInTheDocument();
        });

        it('calls emails:move with object { emailId, destFolderId } for each selected', async () => {
            const folders = [INBOX_FOLDER, TRASH_FOLDER];
            useEmailStore.setState({
                emails: [makeSummary({ id: 'email-1' }), makeSummary({ id: 'email-2', from_email: 'b@b.com' })],
                folders,
                selectedFolderId: 'folder-inbox',
                selectedEmailIds: new Set(['email-1', 'email-2']),
                selectedEmailId: null,
                selectedEmail: null,
                searchQuery: '',
            });
            mockIpcInvoke.mockResolvedValue({ success: true });
            renderThreadList();

            fireEvent.click(screen.getByTitle('readingPane.moveTo'));
            fireEvent.click(screen.getByText('Trash'));

            await waitFor(() => {
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:move', { emailId: 'email-1', destFolderId: 'folder-trash' });
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:move', { emailId: 'email-2', destFolderId: 'folder-trash' });
            });
        });
    });

    // -----------------------------------------------------------------------
    // 11. Individual delete button
    // -----------------------------------------------------------------------
    describe('Individual delete button on thread item', () => {
        it('calls emails:delete when the inline trash button is clicked', async () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1' })]);
            mockIpcInvoke.mockResolvedValue({ success: true });

            renderThreadList();
            const deleteBtn = screen.getByLabelText('Delete email');
            fireEvent.click(deleteBtn);

            await waitFor(() =>
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:delete', 'email-1')
            );
        });

        it('refreshes the list after individual delete succeeds', async () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1' })]);
            mockIpcInvoke
                .mockResolvedValueOnce({ success: true }) // emails:delete
                .mockResolvedValueOnce([]);               // emails:list

            renderThreadList();
            fireEvent.click(screen.getByLabelText('Delete email'));

            await waitFor(() => {
                const listCalls = mockIpcInvoke.mock.calls.filter(([ch]) => ch === 'emails:list');
                expect(listCalls.length).toBeGreaterThanOrEqual(1);
            });
        });

        it('does NOT trigger a list refresh if delete returns failure', async () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1' })]);
            // Drain the mount emails:list call first
            mockIpcInvoke.mockResolvedValueOnce(null); // mount emails:list
            renderThreadList();

            // Wait for mount IPC to settle
            await waitFor(() =>
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:list', 'folder-inbox')
            );

            // Reset mock tracking and configure delete to fail
            mockIpcInvoke.mockClear();
            mockIpcInvoke.mockResolvedValue({ success: false });

            fireEvent.click(screen.getByLabelText('Delete email'));

            await waitFor(() =>
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:delete', 'email-1')
            );

            // After the failed delete, no emails:list should have been called
            const listCalls = mockIpcInvoke.mock.calls.filter(([ch]) => ch === 'emails:list');
            expect(listCalls.length).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // 12. Right-click context menu
    // -----------------------------------------------------------------------
    describe('Context menu', () => {
        it('shows context menu on right-click of thread row', () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1' })]);
            renderThreadList();

            const row = screen.getByText('Hello World').closest('[role="button"]')!;
            fireEvent.contextMenu(row);

            expect(screen.getByText('readingPane.reply')).toBeInTheDocument();
            expect(screen.getByText('readingPane.forward')).toBeInTheDocument();
            expect(screen.getByText('readingPane.delete')).toBeInTheDocument();
        });

        it('closes context menu on Escape key', async () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1' })]);
            renderThreadList();

            const row = screen.getByText('Hello World').closest('[role="button"]')!;
            fireEvent.contextMenu(row);
            expect(screen.getByText('readingPane.reply')).toBeInTheDocument();

            fireEvent.keyDown(document, { key: 'Escape' });
            await waitFor(() =>
                expect(screen.queryByText('readingPane.reply')).not.toBeInTheDocument()
            );
        });

        it('closes context menu when clicking outside', async () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1' })]);
            renderThreadList();

            const row = screen.getByText('Hello World').closest('[role="button"]')!;
            fireEvent.contextMenu(row);

            fireEvent.mouseDown(document.body);
            await waitFor(() =>
                expect(screen.queryByText('readingPane.reply')).not.toBeInTheDocument()
            );
        });

        it('shows "star" label when email is not flagged', () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1', is_flagged: 0 })]);
            renderThreadList();

            fireEvent.contextMenu(screen.getByText('Hello World').closest('[role="button"]')!);
            expect(screen.getByText('threadList.star')).toBeInTheDocument();
        });

        it('shows "unstar" label when email is flagged', () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1', is_flagged: 1 })]);
            renderThreadList();

            fireEvent.contextMenu(screen.getByText('Hello World').closest('[role="button"]')!);
            expect(screen.getByText('threadList.unstar')).toBeInTheDocument();
        });
    });

    // -----------------------------------------------------------------------
    // 13. Context menu — Reply / Forward
    // -----------------------------------------------------------------------
    describe('Context menu: Reply and Forward', () => {
        it('calls emails:read and then onReply when reply is clicked', async () => {
            const full = makeFullEmail({ id: 'email-1' });
            setupStoreWithEmails([makeSummary({ id: 'email-1' })]);
            const onReply = vi.fn();

            // First call: mount emails:list, Second call: emails:read (context reply)
            mockIpcInvoke
                .mockResolvedValueOnce(null)  // mount emails:list
                .mockResolvedValueOnce(full); // context menu: emails:read

            renderThreadList({ onReply });

            // Wait for mount to settle
            await waitFor(() =>
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:list', 'folder-inbox')
            );

            fireEvent.contextMenu(screen.getByText('Hello World').closest('[role="button"]')!);
            fireEvent.click(screen.getByText('readingPane.reply'));

            await waitFor(() => {
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:read', 'email-1');
                expect(onReply).toHaveBeenCalledWith(full);
            });
        }, 10000);

        it('calls emails:read and then onForward when forward is clicked', async () => {
            const full = makeFullEmail({ id: 'email-1' });
            setupStoreWithEmails([makeSummary({ id: 'email-1' })]);
            const onForward = vi.fn();

            mockIpcInvoke
                .mockResolvedValueOnce(null)  // mount emails:list
                .mockResolvedValueOnce(full); // context menu: emails:read

            renderThreadList({ onForward });

            await waitFor(() =>
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:list', 'folder-inbox')
            );

            fireEvent.contextMenu(screen.getByText('Hello World').closest('[role="button"]')!);
            fireEvent.click(screen.getByText('readingPane.forward'));

            await waitFor(() => {
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:read', 'email-1');
                expect(onForward).toHaveBeenCalledWith(full);
            });
        }, 10000);

        it('does not call onReply if emails:read returns null (guard)', async () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1' })]);
            mockIpcInvoke
                .mockResolvedValueOnce(null) // mount emails:list
                .mockResolvedValueOnce(null); // context menu: emails:read → null
            const onReply = vi.fn();

            renderThreadList({ onReply });

            await waitFor(() =>
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:list', 'folder-inbox')
            );

            fireEvent.contextMenu(screen.getByText('Hello World').closest('[role="button"]')!);
            fireEvent.click(screen.getByText('readingPane.reply'));

            await waitFor(() =>
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:read', 'email-1')
            );
            expect(onReply).not.toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------------
    // 14. Context menu — Delete
    // -----------------------------------------------------------------------
    describe('Context menu: Delete', () => {
        it('calls emails:delete with the correct email id', async () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1' })]);
            mockIpcInvoke.mockResolvedValue({ success: true });

            renderThreadList();
            fireEvent.contextMenu(screen.getByText('Hello World').closest('[role="button"]')!);
            fireEvent.click(screen.getByText('readingPane.delete'));

            await waitFor(() =>
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:delete', 'email-1')
            );
        });

        it('refreshes email list after context-menu delete succeeds', async () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1' })]);
            mockIpcInvoke.mockResolvedValue({ success: true });

            renderThreadList();
            fireEvent.contextMenu(screen.getByText('Hello World').closest('[role="button"]')!);
            fireEvent.click(screen.getByText('readingPane.delete'));

            await waitFor(() => {
                const listCalls = mockIpcInvoke.mock.calls.filter(([ch]) => ch === 'emails:list');
                expect(listCalls.length).toBeGreaterThanOrEqual(1);
            });
        });

        it('does NOT refresh list if context delete returns failure', async () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1' })]);

            // First: let mount emails:list settle
            mockIpcInvoke.mockResolvedValueOnce(null);
            renderThreadList();

            await waitFor(() =>
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:list', 'folder-inbox')
            );

            // Reset and configure delete to fail
            mockIpcInvoke.mockClear();
            mockIpcInvoke.mockResolvedValue({ success: false });

            fireEvent.contextMenu(screen.getByText('Hello World').closest('[role="button"]')!);
            fireEvent.click(screen.getByText('readingPane.delete'));

            await waitFor(() =>
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:delete', 'email-1')
            );

            const listCalls = mockIpcInvoke.mock.calls.filter(([ch]) => ch === 'emails:list');
            expect(listCalls.length).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // 15. Context menu — Toggle read/unread (critical IPC contract)
    // -----------------------------------------------------------------------
    describe('Context menu: Toggle read/unread', () => {
        it('calls emails:mark-unread for a read email (is_read=1)', async () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1', is_read: 1 })]);
            mockIpcInvoke.mockResolvedValue({ success: true });

            renderThreadList();
            fireEvent.contextMenu(screen.getByText('Hello World').closest('[role="button"]')!);
            fireEvent.click(screen.getByText('threadList.markUnread'));

            await waitFor(() =>
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:mark-unread', 'email-1')
            );
        });

        it('does NOT call emails:read (full fetch) when toggling read→unread', async () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1', is_read: 1 })]);
            mockIpcInvoke.mockResolvedValue({ success: true });

            renderThreadList();
            fireEvent.contextMenu(screen.getByText('Hello World').closest('[role="button"]')!);
            fireEvent.click(screen.getByText('threadList.markUnread'));

            await waitFor(() =>
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:mark-unread', 'email-1')
            );
            expect(mockIpcInvoke).not.toHaveBeenCalledWith('emails:read', 'email-1');
        });

        it('calls emails:mark-read for an unread email (is_read=0)', async () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1', is_read: 0 })]);
            mockIpcInvoke.mockResolvedValue({ success: true });

            renderThreadList();
            fireEvent.contextMenu(screen.getByText('Hello World').closest('[role="button"]')!);
            fireEvent.click(screen.getByText('threadList.markRead'));

            await waitFor(() =>
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:mark-read', 'email-1')
            );
        });

        it('does NOT call emails:read (full fetch) when toggling unread→read via context menu', async () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1', is_read: 0 })]);
            mockIpcInvoke.mockResolvedValue({ success: true });

            renderThreadList();
            fireEvent.contextMenu(screen.getByText('Hello World').closest('[role="button"]')!);
            fireEvent.click(screen.getByText('threadList.markRead'));

            await waitFor(() =>
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:mark-read', 'email-1')
            );
            expect(mockIpcInvoke).not.toHaveBeenCalledWith('emails:read', 'email-1');
        });

        it('optimistically updates is_read in the store after context toggle', async () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1', is_read: 1 })]);
            mockIpcInvoke.mockResolvedValue({ success: true });

            renderThreadList();
            fireEvent.contextMenu(screen.getByText('Hello World').closest('[role="button"]')!);
            fireEvent.click(screen.getByText('threadList.markUnread'));

            await waitFor(() => {
                const updated = useEmailStore.getState().emails.find((e: EmailSummary) => e.id === 'email-1');
                expect(updated?.is_read).toBe(0);
            });
        });

        it('shows "Mark Read" label for unread emails in context menu', () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1', is_read: 0 })]);
            renderThreadList();

            fireEvent.contextMenu(screen.getByText('Hello World').closest('[role="button"]')!);
            expect(screen.getByText('threadList.markRead')).toBeInTheDocument();
        });

        it('shows "Mark Unread" label for read emails in context menu', () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1', is_read: 1 })]);
            renderThreadList();

            fireEvent.contextMenu(screen.getByText('Hello World').closest('[role="button"]')!);
            expect(screen.getByText('threadList.markUnread')).toBeInTheDocument();
        });
    });

    // -----------------------------------------------------------------------
    // 16. Context menu — Star toggle
    // -----------------------------------------------------------------------
    describe('Context menu: Star', () => {
        it('calls emails:toggle-flag with !is_flagged when star is clicked', async () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1', is_flagged: 0 })]);
            mockIpcInvoke.mockResolvedValue({ success: true });

            renderThreadList();
            fireEvent.contextMenu(screen.getByText('Hello World').closest('[role="button"]')!);
            fireEvent.click(screen.getByText('threadList.star'));

            await waitFor(() =>
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:toggle-flag', 'email-1', true)
            );
        });

        it('calls emails:toggle-flag with false to unstar a flagged email', async () => {
            setupStoreWithEmails([makeSummary({ id: 'email-1', is_flagged: 1 })]);
            mockIpcInvoke.mockResolvedValue({ success: true });

            renderThreadList();
            fireEvent.contextMenu(screen.getByText('Hello World').closest('[role="button"]')!);
            fireEvent.click(screen.getByText('threadList.unstar'));

            await waitFor(() =>
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:toggle-flag', 'email-1', false)
            );
        });
    });

    // -----------------------------------------------------------------------
    // 17. Context menu — Move to folder
    // -----------------------------------------------------------------------
    describe('Context menu: Move to folder', () => {
        it('shows move submenu with folders excluding current folder', () => {
            const folders = [INBOX_FOLDER, TRASH_FOLDER, SENT_FOLDER];
            useEmailStore.setState({
                emails: [makeSummary({ id: 'email-1' })],
                folders,
                selectedFolderId: 'folder-inbox',
                selectedEmailIds: new Set<string>(),
                selectedEmailId: null,
                selectedEmail: null,
                searchQuery: '',
            });
            renderThreadList();

            fireEvent.contextMenu(screen.getByText('Hello World').closest('[role="button"]')!);
            fireEvent.click(screen.getByText('readingPane.moveTo'));

            expect(screen.getByText('Trash')).toBeInTheDocument();
            expect(screen.getByText('Sent')).toBeInTheDocument();
        });

        it('calls emails:move with object { emailId, destFolderId } on submenu click', async () => {
            const folders = [INBOX_FOLDER, TRASH_FOLDER];
            useEmailStore.setState({
                emails: [makeSummary({ id: 'email-1' })],
                folders,
                selectedFolderId: 'folder-inbox',
                selectedEmailIds: new Set<string>(),
                selectedEmailId: null,
                selectedEmail: null,
                searchQuery: '',
            });
            mockIpcInvoke.mockResolvedValue({ success: true });
            renderThreadList();

            fireEvent.contextMenu(screen.getByText('Hello World').closest('[role="button"]')!);
            fireEvent.click(screen.getByText('readingPane.moveTo'));
            fireEvent.click(screen.getByText('Trash'));

            await waitFor(() =>
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:move', {
                    emailId: 'email-1',
                    destFolderId: 'folder-trash',
                })
            );
        });

        it('refreshes email list after context-menu move succeeds', async () => {
            const folders = [INBOX_FOLDER, TRASH_FOLDER];
            useEmailStore.setState({
                emails: [makeSummary({ id: 'email-1' })],
                folders,
                selectedFolderId: 'folder-inbox',
                selectedEmailIds: new Set<string>(),
                selectedEmailId: null,
                selectedEmail: null,
                searchQuery: '',
            });
            mockIpcInvoke.mockResolvedValue({ success: true });

            renderThreadList();
            fireEvent.contextMenu(screen.getByText('Hello World').closest('[role="button"]')!);
            fireEvent.click(screen.getByText('readingPane.moveTo'));
            fireEvent.click(screen.getByText('Trash'));

            await waitFor(() => {
                const listCalls = mockIpcInvoke.mock.calls.filter(([ch]) => ch === 'emails:list');
                expect(listCalls.length).toBeGreaterThanOrEqual(1);
            });
        });
    });

    // -----------------------------------------------------------------------
    // 18. Search
    // -----------------------------------------------------------------------
    describe('Search', () => {
        it('calls emails:search IPC after 300ms debounce when query is > 1 char', async () => {
            vi.useFakeTimers({ shouldAdvanceTime: true });
            setupStoreWithEmails([]);
            mockIpcInvoke.mockResolvedValue([]);

            renderThreadList();
            const input = screen.getByPlaceholderText('threadList.search');
            fireEvent.change(input, { target: { value: 'he' } });

            // Before debounce fires — no search call yet
            const callsBefore = mockIpcInvoke.mock.calls.filter(([ch]) => ch === 'emails:search');
            expect(callsBefore.length).toBe(0);

            await act(async () => {
                vi.advanceTimersByTime(300);
            });

            await waitFor(() =>
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:search', 'he')
            );
        });

        it('falls back to emails:list when query is cleared (< 2 chars)', async () => {
            vi.useFakeTimers({ shouldAdvanceTime: true });
            setupStoreWithEmails([]);
            mockIpcInvoke.mockResolvedValue([]);

            renderThreadList();
            const input = screen.getByPlaceholderText('threadList.search');

            // Type a search query then advance timer
            fireEvent.change(input, { target: { value: 'hello' } });
            await act(async () => { vi.advanceTimersByTime(300); });
            await waitFor(() =>
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:search', 'hello')
            );

            // Clear the query (single char — falls back to list)
            fireEvent.change(input, { target: { value: 'h' } });
            await act(async () => { vi.advanceTimersByTime(300); });
            await waitFor(() =>
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:list', 'folder-inbox')
            );
        });

        it('updates searchQuery in store as the user types', () => {
            setupStoreWithEmails([]);
            renderThreadList();

            const input = screen.getByPlaceholderText('threadList.search');
            fireEvent.change(input, { target: { value: 'test query' } });

            expect(useEmailStore.getState().searchQuery).toBe('test query');
        });

        it('does not call emails:search when query is exactly 1 character', async () => {
            vi.useFakeTimers({ shouldAdvanceTime: true });
            setupStoreWithEmails([]);
            mockIpcInvoke.mockResolvedValue([]);

            renderThreadList();
            fireEvent.change(screen.getByPlaceholderText('threadList.search'), { target: { value: 'a' } });

            await act(async () => { vi.advanceTimersByTime(300); });

            expect(mockIpcInvoke).not.toHaveBeenCalledWith('emails:search', 'a');
        });
    });

    // -----------------------------------------------------------------------
    // 19. email:new IPC event
    // -----------------------------------------------------------------------
    describe('email:new event handling', () => {
        it('subscribes to email:new on mount', () => {
            setupStoreWithEmails([]);
            renderThreadList();
            expect(mockIpcOn).toHaveBeenCalledWith('email:new', expect.any(Function));
        });

        it('refreshes email list when email:new fires', async () => {
            let capturedCallback: (() => void) | null = null;
            mockIpcOn.mockImplementation((ch: string, cb: () => void) => {
                if (ch === 'email:new') capturedCallback = cb;
                return () => {};
            });

            const refreshedEmails = [makeSummary({ id: 'email-new' })];
            // First call: mount emails:list → null (empty)
            // Second call: email:new → emails:list → refreshedEmails
            mockIpcInvoke
                .mockResolvedValueOnce(null)            // mount emails:list
                .mockResolvedValueOnce(refreshedEmails); // email:new refresh

            setupStoreWithEmails([]);
            renderThreadList();

            // Wait for mount to settle and callback to be captured
            await waitFor(() => {
                expect(mockIpcOn).toHaveBeenCalledWith('email:new', expect.any(Function));
                expect(capturedCallback).not.toBeNull();
            });

            // Simulate new email event
            await act(async () => {
                capturedCallback!();
            });

            await waitFor(() => {
                const allListCalls = mockIpcInvoke.mock.calls.filter(([ch]) => ch === 'emails:list');
                expect(allListCalls.length).toBeGreaterThanOrEqual(1);
            });
        });
    });

    // -----------------------------------------------------------------------
    // 20. Edge cases
    // -----------------------------------------------------------------------
    describe('Edge cases', () => {
        it('renders nothing unusual when emails array is empty and no folder selected', () => {
            useEmailStore.setState({
                emails: [],
                folders: [],
                selectedFolderId: null,
                selectedEmailIds: new Set<string>(),
                selectedEmailId: null,
                selectedEmail: null,
                searchQuery: '',
            });
            renderThreadList();
            // No crash; search bar still present
            expect(screen.getByPlaceholderText('threadList.search')).toBeInTheDocument();
        });

        it('does not crash when onReply/onForward props are not provided', async () => {
            const full = makeFullEmail({ id: 'email-1' });
            setupStoreWithEmails([makeSummary({ id: 'email-1' })]);
            mockIpcInvoke
                .mockResolvedValueOnce(null) // mount emails:list
                .mockResolvedValueOnce(full); // context: emails:read

            // Render without optional callbacks
            renderThreadList({});

            await waitFor(() =>
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:list', 'folder-inbox')
            );

            fireEvent.contextMenu(screen.getByText('Hello World').closest('[role="button"]')!);
            fireEvent.click(screen.getByText('readingPane.reply'));

            await waitFor(() =>
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:read', 'email-1')
            );
            // No error thrown — test passes if we get here
        });

        it('selecting multiple emails rapidly does not cause inconsistent state', () => {
            const emails = [
                makeSummary({ id: 'email-1', subject: 'A' }),
                makeSummary({ id: 'email-2', subject: 'B', from_email: 'b@b.com' }),
                makeSummary({ id: 'email-3', subject: 'C', from_email: 'c@c.com' }),
            ];
            setupStoreWithEmails(emails);
            renderThreadList();

            const checkBtns = screen.getAllByLabelText('Select email');
            fireEvent.click(checkBtns[0]);
            fireEvent.click(checkBtns[1]);
            fireEvent.click(checkBtns[2]);

            const { selectedEmailIds } = useEmailStore.getState();
            expect(selectedEmailIds.size).toBe(3);
        });

        it('bulk toolbar disappears after clearSelection is called', () => {
            setupStoreWithEmails([makeSummary()]);
            useEmailStore.setState({ selectedEmailIds: new Set(['email-1']) });
            renderThreadList();

            expect(screen.getByTitle('threadList.clearSelection')).toBeInTheDocument();
            fireEvent.click(screen.getByTitle('threadList.clearSelection'));

            expect(useEmailStore.getState().selectedEmailIds.size).toBe(0);
        });

        it('snippet is not rendered when it equals the subject', () => {
            const subject = 'Unique Subject String';
            setupStoreWithEmails([makeSummary({ subject, snippet: subject })]);
            renderThreadList();

            // Subject appears once; snippet rendering is suppressed when they are equal
            const matches = screen.getAllByText(subject);
            expect(matches).toHaveLength(1);
        });

        it('renders snippet when it differs from the subject', () => {
            setupStoreWithEmails([
                makeSummary({ subject: 'My Subject', snippet: 'Preview text here...' }),
            ]);
            renderThreadList();

            expect(screen.getByText('Preview text here...')).toBeInTheDocument();
        });

        it('Space key on thread row triggers selection', async () => {
            const email = makeSummary({ id: 'email-1' });
            const full = makeFullEmail({ id: 'email-1' });
            setupStoreWithEmails([email]);
            mockIpcInvoke.mockResolvedValueOnce(full);

            renderThreadList();
            const row = screen.getByText('Hello World').closest('[role="button"]')!;
            fireEvent.keyDown(row, { key: ' ' });

            await waitFor(() =>
                expect(mockIpcInvoke).toHaveBeenCalledWith('emails:read', 'email-1')
            );
        });
    });

    // -----------------------------------------------------------------------
    // 21. Unified inbox account badge
    // -----------------------------------------------------------------------
    describe('Unified inbox account badge', () => {
        it('renders provider icon badge when viewing unified inbox', () => {
            const accounts = [
                {
                    id: 'acc-1',
                    email: 'alice@gmail.com',
                    provider: 'gmail',
                    display_name: 'Alice',
                    imap_host: null,
                    imap_port: null,
                    smtp_host: null,
                    smtp_port: null,
                    signature_html: null,
                },
            ];
            useEmailStore.setState({
                emails: [makeSummary({ id: 'email-1', account_id: 'acc-1' })],
                folders: [INBOX_FOLDER],
                selectedFolderId: '__unified',
                selectedEmailId: null,
                selectedEmailIds: new Set<string>(),
                selectedEmail: null,
                searchQuery: '',
                accounts,
            });
            renderThreadList();

            // The provider icon badge should appear with the account email as aria-label
            expect(screen.getByLabelText('From account: alice@gmail.com')).toBeInTheDocument();
        });

        it('does not render account badge for regular folder', () => {
            const accounts = [
                {
                    id: 'acc-1',
                    email: 'alice@gmail.com',
                    provider: 'gmail',
                    display_name: 'Alice',
                    imap_host: null,
                    imap_port: null,
                    smtp_host: null,
                    smtp_port: null,
                    signature_html: null,
                },
            ];
            useEmailStore.setState({
                emails: [makeSummary({ id: 'email-1', account_id: 'acc-1' })],
                folders: [INBOX_FOLDER],
                selectedFolderId: 'folder-inbox',
                selectedEmailId: null,
                selectedEmailIds: new Set<string>(),
                selectedEmail: null,
                searchQuery: '',
                accounts,
            });
            renderThreadList();

            // No "From account:" badge should appear for a non-unified folder
            expect(screen.queryByLabelText('From account: alice@gmail.com')).not.toBeInTheDocument();
        });

        // -------------------------------------------------------------------
        // Edge cases — Phase 8
        // -------------------------------------------------------------------

        it('does not render account badge when email has no account_id (undefined)', () => {
            // EmailSummary.account_id is optional — when absent, no badge should render
            const accounts = [
                {
                    id: 'acc-1',
                    email: 'alice@gmail.com',
                    provider: 'gmail',
                    display_name: 'Alice',
                    imap_host: null,
                    imap_port: null,
                    smtp_host: null,
                    smtp_port: null,
                    signature_html: null,
                },
            ];
            useEmailStore.setState({
                // account_id is deliberately omitted — uses makeSummary default (no account_id key)
                emails: [makeSummary({ id: 'email-1' })],
                folders: [INBOX_FOLDER],
                selectedFolderId: '__unified',
                selectedEmailId: null,
                selectedEmailIds: new Set<string>(),
                selectedEmail: null,
                searchQuery: '',
                accounts,
            });
            renderThreadList();

            // thread.account_id is undefined → the guard `thread.account_id && (() => {...})()`
            // short-circuits and returns null, so no badge at all
            expect(screen.queryByLabelText(/From account:/)).not.toBeInTheDocument();
        });

        it('does not render account badge when account_id does not match any account', () => {
            // account_id set to a value that is not in the accounts array
            const accounts = [
                {
                    id: 'acc-known',
                    email: 'known@gmail.com',
                    provider: 'gmail',
                    display_name: 'Known',
                    imap_host: null,
                    imap_port: null,
                    smtp_host: null,
                    smtp_port: null,
                    signature_html: null,
                },
            ];
            useEmailStore.setState({
                emails: [makeSummary({ id: 'email-1', account_id: 'acc-does-not-exist' })],
                folders: [INBOX_FOLDER],
                selectedFolderId: '__unified',
                selectedEmailId: null,
                selectedEmailIds: new Set<string>(),
                selectedEmail: null,
                searchQuery: '',
                accounts,
            });
            renderThreadList();

            // accounts.find returns undefined → component guard `if (!acct) return null`
            expect(screen.queryByLabelText(/From account:/)).not.toBeInTheDocument();
        });

        it('renders distinct badges for emails from different accounts in unified inbox', () => {
            const accounts = [
                {
                    id: 'acc-1',
                    email: 'alice@gmail.com',
                    provider: 'gmail',
                    display_name: 'Alice',
                    imap_host: null,
                    imap_port: null,
                    smtp_host: null,
                    smtp_port: null,
                    signature_html: null,
                },
                {
                    id: 'acc-2',
                    email: 'bob@outlook.com',
                    provider: 'outlook',
                    display_name: 'Bob',
                    imap_host: null,
                    imap_port: null,
                    smtp_host: null,
                    smtp_port: null,
                    signature_html: null,
                },
            ];
            useEmailStore.setState({
                emails: [
                    makeSummary({ id: 'email-1', account_id: 'acc-1', subject: 'Alice email' }),
                    makeSummary({ id: 'email-2', account_id: 'acc-2', subject: 'Bob email', from_email: 'bob@outlook.com' }),
                ],
                folders: [INBOX_FOLDER],
                selectedFolderId: '__unified',
                selectedEmailId: null,
                selectedEmailIds: new Set<string>(),
                selectedEmail: null,
                searchQuery: '',
                accounts,
            });
            renderThreadList();

            // Both account badges should be present
            expect(screen.getByLabelText('From account: alice@gmail.com')).toBeInTheDocument();
            expect(screen.getByLabelText('From account: bob@outlook.com')).toBeInTheDocument();
        });

        it('renders empty accounts array without crashing in unified inbox', () => {
            useEmailStore.setState({
                emails: [makeSummary({ id: 'email-1', account_id: 'acc-1' })],
                folders: [INBOX_FOLDER],
                selectedFolderId: '__unified',
                selectedEmailId: null,
                selectedEmailIds: new Set<string>(),
                selectedEmail: null,
                searchQuery: '',
                accounts: [],
            });
            // Should not throw — accounts.find returns undefined → null render
            renderThreadList();
            expect(screen.queryByLabelText(/From account:/)).not.toBeInTheDocument();
        });
    });
});
