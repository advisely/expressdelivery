import { describe, it, expect, beforeEach } from 'vitest';
import { useEmailStore } from './emailStore';
import type { Draft, EmailFull, Account } from './emailStore';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const mockDraft: Draft = {
    id: 'draft-1',
    account_id: 'acc-1',
    to_email: 'user@test.com',
    subject: 'Draft Subject',
    body_html: '<p>Draft body</p>',
    cc: null,
    bcc: null,
    created_at: '2026-02-24T12:00:00Z',
    updated_at: '2026-02-24T12:00:00Z',
};

const mockDraft2: Draft = {
    id: 'draft-2',
    account_id: 'acc-1',
    to_email: 'user2@test.com',
    subject: 'Draft 2',
    body_html: null,
    cc: 'cc@test.com',
    bcc: null,
    created_at: '2026-02-24T13:00:00Z',
    updated_at: '2026-02-24T13:00:00Z',
};

const mockAccount: Account = {
    id: 'acc-1',
    email: 'a@t.com',
    provider: 'gmail',
    display_name: null,
    imap_host: null,
    imap_port: null,
    smtp_host: null,
    smtp_port: null,
};

const mockAccount2: Account = {
    id: 'acc-2',
    email: 'b@t.com',
    provider: 'outlook',
    display_name: null,
    imap_host: null,
    imap_port: null,
    smtp_host: null,
    smtp_port: null,
};

const mockEmailFull: EmailFull = {
    id: 'email-1',
    account_id: 'acc-1',
    folder_id: 'f1',
    thread_id: null,
    subject: 'Test Subject',
    from_name: null,
    from_email: null,
    to_email: null,
    date: null,
    snippet: null,
    body_text: null,
    body_html: null,
    is_read: 1,
    is_flagged: 0,
};

// ---------------------------------------------------------------------------
// Helper: reset store to a clean slate before every test
// ---------------------------------------------------------------------------

function resetStore() {
    useEmailStore.setState({
        drafts: [],
        accounts: [],
        folders: [],
        emails: [],
        selectedEmail: null,
        selectedAccountId: null,
        selectedFolderId: null,
        selectedEmailId: null,
        isLoading: false,
        searchQuery: '',
    });
}

// ---------------------------------------------------------------------------
// Draft management
// ---------------------------------------------------------------------------

describe('emailStore draft management', () => {
    beforeEach(resetStore);

    it('setDrafts replaces the drafts array', () => {
        useEmailStore.getState().setDrafts([mockDraft, mockDraft2]);
        expect(useEmailStore.getState().drafts).toHaveLength(2);
        expect(useEmailStore.getState().drafts[0].id).toBe('draft-1');
    });

    it('setDrafts overwrites a previously populated list', () => {
        useEmailStore.getState().setDrafts([mockDraft, mockDraft2]);
        useEmailStore.getState().setDrafts([mockDraft]);
        expect(useEmailStore.getState().drafts).toHaveLength(1);
        expect(useEmailStore.getState().drafts[0].id).toBe('draft-1');
    });

    it('setDrafts with empty array clears drafts', () => {
        useEmailStore.getState().setDrafts([mockDraft]);
        useEmailStore.getState().setDrafts([]);
        expect(useEmailStore.getState().drafts).toHaveLength(0);
    });

    it('addDraft prepends new draft to the list', () => {
        useEmailStore.getState().setDrafts([mockDraft]);
        useEmailStore.getState().addDraft(mockDraft2);
        const drafts = useEmailStore.getState().drafts;
        expect(drafts).toHaveLength(2);
        expect(drafts[0].id).toBe('draft-2'); // prepended
        expect(drafts[1].id).toBe('draft-1');
    });

    it('addDraft on empty list results in a single-element array', () => {
        useEmailStore.getState().addDraft(mockDraft);
        expect(useEmailStore.getState().drafts).toHaveLength(1);
        expect(useEmailStore.getState().drafts[0].id).toBe('draft-1');
    });

    it('addDraft preserves all Draft fields', () => {
        useEmailStore.getState().addDraft(mockDraft);
        const stored = useEmailStore.getState().drafts[0];
        expect(stored.account_id).toBe('acc-1');
        expect(stored.to_email).toBe('user@test.com');
        expect(stored.subject).toBe('Draft Subject');
        expect(stored.body_html).toBe('<p>Draft body</p>');
        expect(stored.cc).toBeNull();
        expect(stored.bcc).toBeNull();
        expect(stored.created_at).toBe('2026-02-24T12:00:00Z');
        expect(stored.updated_at).toBe('2026-02-24T12:00:00Z');
    });

    it('removeDraft removes draft by ID', () => {
        useEmailStore.getState().setDrafts([mockDraft, mockDraft2]);
        useEmailStore.getState().removeDraft('draft-1');
        const drafts = useEmailStore.getState().drafts;
        expect(drafts).toHaveLength(1);
        expect(drafts[0].id).toBe('draft-2');
    });

    it('removeDraft removes the last remaining draft', () => {
        useEmailStore.getState().setDrafts([mockDraft]);
        useEmailStore.getState().removeDraft('draft-1');
        expect(useEmailStore.getState().drafts).toHaveLength(0);
    });

    it('removeDraft is a no-op for non-existent ID', () => {
        useEmailStore.getState().setDrafts([mockDraft]);
        useEmailStore.getState().removeDraft('non-existent');
        expect(useEmailStore.getState().drafts).toHaveLength(1);
    });

    it('removeDraft is a no-op on an empty list', () => {
        useEmailStore.getState().removeDraft('draft-1');
        expect(useEmailStore.getState().drafts).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Account management
// ---------------------------------------------------------------------------

describe('emailStore account management', () => {
    beforeEach(resetStore);

    it('setAccounts replaces the accounts array', () => {
        useEmailStore.getState().setAccounts([mockAccount, mockAccount2]);
        expect(useEmailStore.getState().accounts).toHaveLength(2);
    });

    it('addAccount appends to the accounts list', () => {
        useEmailStore.getState().setAccounts([mockAccount]);
        useEmailStore.getState().addAccount(mockAccount2);
        expect(useEmailStore.getState().accounts).toHaveLength(2);
        expect(useEmailStore.getState().accounts[1].id).toBe('acc-2');
    });

    it('updateAccount replaces the matching account in place', () => {
        useEmailStore.getState().setAccounts([mockAccount]);
        const updated: Account = { ...mockAccount, display_name: 'Updated Name' };
        useEmailStore.getState().updateAccount(updated);
        expect(useEmailStore.getState().accounts[0].display_name).toBe('Updated Name');
    });

    it('updateAccount does not affect other accounts', () => {
        useEmailStore.getState().setAccounts([mockAccount, mockAccount2]);
        const updated: Account = { ...mockAccount, display_name: 'Changed' };
        useEmailStore.getState().updateAccount(updated);
        expect(useEmailStore.getState().accounts[1].display_name).toBeNull();
    });

    it('removeAccount removes the specified account', () => {
        useEmailStore.getState().setAccounts([mockAccount, mockAccount2]);
        useEmailStore.getState().removeAccount('acc-1');
        const accounts = useEmailStore.getState().accounts;
        expect(accounts).toHaveLength(1);
        expect(accounts[0].id).toBe('acc-2');
    });

    it('selectAccount clears selection state', () => {
        useEmailStore.setState({
            selectedAccountId: 'acc-1',
            selectedFolderId: 'folder-1',
            selectedEmailId: 'email-1',
            selectedEmail: mockEmailFull,
        });
        useEmailStore.getState().selectAccount('acc-2');
        const state = useEmailStore.getState();
        expect(state.selectedAccountId).toBe('acc-2');
        expect(state.selectedFolderId).toBeNull();
        expect(state.selectedEmailId).toBeNull();
        expect(state.selectedEmail).toBeNull();
    });

    it('selectAccount accepts null to deselect', () => {
        useEmailStore.setState({ selectedAccountId: 'acc-1' });
        useEmailStore.getState().selectAccount(null);
        expect(useEmailStore.getState().selectedAccountId).toBeNull();
    });

    it('removeAccount clears selection when removing the active account', () => {
        useEmailStore.setState({
            accounts: [mockAccount, mockAccount2],
            selectedAccountId: 'acc-1',
            selectedFolderId: 'f1',
            selectedEmailId: 'e1',
        });
        useEmailStore.getState().removeAccount('acc-1');
        const state = useEmailStore.getState();
        expect(state.accounts).toHaveLength(1);
        expect(state.selectedAccountId).toBe('acc-2');
        expect(state.selectedFolderId).toBeNull();
    });

    it('removeAccount selects null when the last account is removed', () => {
        useEmailStore.setState({
            accounts: [mockAccount],
            selectedAccountId: 'acc-1',
        });
        useEmailStore.getState().removeAccount('acc-1');
        const state = useEmailStore.getState();
        expect(state.accounts).toHaveLength(0);
        expect(state.selectedAccountId).toBeNull();
    });

    it('removeAccount does not change selection when a non-active account is removed', () => {
        useEmailStore.setState({
            accounts: [mockAccount, mockAccount2],
            selectedAccountId: 'acc-1',
            selectedFolderId: 'f1',
        });
        useEmailStore.getState().removeAccount('acc-2');
        const state = useEmailStore.getState();
        expect(state.selectedAccountId).toBe('acc-1');
        expect(state.selectedFolderId).toBe('f1');
    });
});

// ---------------------------------------------------------------------------
// Folder and email selection
// ---------------------------------------------------------------------------

describe('emailStore folder and email selection', () => {
    beforeEach(resetStore);

    it('selectFolder sets selectedFolderId and clears email selection', () => {
        useEmailStore.setState({
            selectedFolderId: 'old-folder',
            selectedEmailId: 'old-email',
            selectedEmail: mockEmailFull,
        });
        useEmailStore.getState().selectFolder('new-folder');
        const state = useEmailStore.getState();
        expect(state.selectedFolderId).toBe('new-folder');
        expect(state.selectedEmailId).toBeNull();
        expect(state.selectedEmail).toBeNull();
    });

    it('selectFolder accepts null to deselect', () => {
        useEmailStore.setState({ selectedFolderId: 'f1' });
        useEmailStore.getState().selectFolder(null);
        expect(useEmailStore.getState().selectedFolderId).toBeNull();
    });

    it('selectEmail sets selectedEmailId only', () => {
        useEmailStore.getState().selectEmail('email-42');
        expect(useEmailStore.getState().selectedEmailId).toBe('email-42');
    });

    it('setSelectedEmail stores the full email object', () => {
        useEmailStore.getState().setSelectedEmail(mockEmailFull);
        expect(useEmailStore.getState().selectedEmail).toEqual(mockEmailFull);
    });

    it('setSelectedEmail accepts null to clear', () => {
        useEmailStore.setState({ selectedEmail: mockEmailFull });
        useEmailStore.getState().setSelectedEmail(null);
        expect(useEmailStore.getState().selectedEmail).toBeNull();
    });

    it('setFolders replaces the folders array', () => {
        useEmailStore.getState().setFolders([{ id: 'f1', name: 'Inbox', path: 'INBOX', type: 'inbox' }]);
        expect(useEmailStore.getState().folders).toHaveLength(1);
        expect(useEmailStore.getState().folders[0].id).toBe('f1');
    });

    it('setEmails replaces the emails array', () => {
        const summary = {
            id: 'e1', thread_id: null, subject: 'Hi', from_name: null,
            from_email: null, to_email: null, date: null, snippet: null,
            is_read: 0, is_flagged: 0,
        };
        useEmailStore.getState().setEmails([summary]);
        expect(useEmailStore.getState().emails).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// Auxiliary state
// ---------------------------------------------------------------------------

describe('emailStore auxiliary state', () => {
    beforeEach(resetStore);

    it('setLoading updates isLoading flag', () => {
        useEmailStore.getState().setLoading(true);
        expect(useEmailStore.getState().isLoading).toBe(true);
        useEmailStore.getState().setLoading(false);
        expect(useEmailStore.getState().isLoading).toBe(false);
    });

    it('setSearchQuery stores the query string', () => {
        useEmailStore.getState().setSearchQuery('invoice');
        expect(useEmailStore.getState().searchQuery).toBe('invoice');
    });

    it('setSearchQuery accepts empty string to clear', () => {
        useEmailStore.setState({ searchQuery: 'test' });
        useEmailStore.getState().setSearchQuery('');
        expect(useEmailStore.getState().searchQuery).toBe('');
    });

    it('store initialises with expected defaults', () => {
        const state = useEmailStore.getState();
        expect(state.accounts).toEqual([]);
        expect(state.folders).toEqual([]);
        expect(state.emails).toEqual([]);
        expect(state.drafts).toEqual([]);
        expect(state.selectedEmail).toBeNull();
        expect(state.selectedAccountId).toBeNull();
        expect(state.selectedFolderId).toBeNull();
        expect(state.selectedEmailId).toBeNull();
        expect(state.isLoading).toBe(false);
        expect(state.searchQuery).toBe('');
    });
});
