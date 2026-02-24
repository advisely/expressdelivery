import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReadingPane } from './ReadingPane';
import { ThemeProvider } from './ThemeContext';
import { useEmailStore } from '../stores/emailStore';
import { ipcInvoke } from '../lib/ipc';
import type { EmailFull } from '../stores/emailStore';

vi.mock('../lib/ipc', () => ({
    ipcInvoke: vi.fn(),
}));

vi.mock('dompurify', () => ({
    default: {
        sanitize: (html: string) => html,
    },
}));

vi.mock('lucide-react', () => ({
    Reply: () => <div data-testid="icon-Reply">R</div>,
    Forward: () => <div data-testid="icon-Forward">F</div>,
    Trash2: () => <div data-testid="icon-Trash2">T</div>,
    Star: ({ fill }: { fill?: string }) => <div data-testid="icon-Star" data-fill={fill}>S</div>,
    Archive: () => <div data-testid="icon-Archive">A</div>,
    FolderInput: () => <div data-testid="icon-FolderInput">FI</div>,
}));

vi.mock('@radix-ui/react-dropdown-menu', () => ({
    Root: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Trigger: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) => asChild ? <>{children}</> : <button>{children}</button>,
    Portal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Content: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className} role="menu">{children}</div>,
    Item: ({ children, onSelect, disabled, className }: { children: React.ReactNode; onSelect?: () => void; disabled?: boolean; className?: string }) => (
        <div role="menuitem" className={className} onClick={onSelect} aria-disabled={disabled}>{children}</div>
    ),
}));

const mockIpcInvoke = vi.mocked(ipcInvoke);

const mockEmail: EmailFull = {
    id: 'email-1',
    account_id: 'acc-1',
    folder_id: 'folder-inbox',
    thread_id: null,
    subject: 'Test Subject',
    from_name: 'John Doe',
    from_email: 'john@example.com',
    to_email: 'me@example.com',
    date: '2026-02-24T12:00:00Z',
    snippet: 'Hello world...',
    body_text: 'Hello world',
    body_html: '<p>Hello world</p>',
    is_read: 1,
    is_flagged: 0,
};

function renderReadingPane(props: Partial<Parameters<typeof ReadingPane>[0]> = {}) {
    return render(
        <ThemeProvider>
            <ReadingPane {...props} />
        </ThemeProvider>
    );
}

describe('ReadingPane', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIpcInvoke.mockResolvedValue(null);
        useEmailStore.setState({
            selectedEmail: null,
            folders: [
                { id: 'folder-inbox', name: 'Inbox', path: 'INBOX', type: 'inbox' },
                { id: 'folder-archive', name: 'Archive', path: 'Archive', type: 'archive' },
                { id: 'folder-sent', name: 'Sent', path: 'Sent', type: 'sent' },
            ],
            selectedFolderId: 'folder-inbox',
        });
    });

    it('renders placeholder when no email is selected', () => {
        renderReadingPane();
        expect(screen.getByText('Select an email to read')).toBeInTheDocument();
    });

    it('renders email content when email is selected', () => {
        useEmailStore.setState({ selectedEmail: mockEmail });
        renderReadingPane();
        expect(screen.getByText('Test Subject')).toBeInTheDocument();
        expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    it('renders all action buttons including archive and move', () => {
        useEmailStore.setState({ selectedEmail: mockEmail });
        renderReadingPane();
        expect(screen.getByTitle('Reply')).toBeInTheDocument();
        expect(screen.getByTitle('Forward')).toBeInTheDocument();
        expect(screen.getByTitle('Delete')).toBeInTheDocument();
        expect(screen.getByTitle('Archive (E)')).toBeInTheDocument();
        expect(screen.getByTitle('Move to folder')).toBeInTheDocument();
    });

    it('calls onReply callback when reply button is clicked', () => {
        useEmailStore.setState({ selectedEmail: mockEmail });
        const onReply = vi.fn();
        renderReadingPane({ onReply });
        fireEvent.click(screen.getByTitle('Reply'));
        expect(onReply).toHaveBeenCalledWith(mockEmail);
    });

    it('calls onForward callback when forward button is clicked', () => {
        useEmailStore.setState({ selectedEmail: mockEmail });
        const onForward = vi.fn();
        renderReadingPane({ onForward });
        fireEvent.click(screen.getByTitle('Forward'));
        expect(onForward).toHaveBeenCalledWith(mockEmail);
    });

    it('calls emails:delete IPC on delete button click', async () => {
        useEmailStore.setState({ selectedEmail: mockEmail });
        renderReadingPane();
        fireEvent.click(screen.getByTitle('Delete'));
        await waitFor(() => {
            expect(mockIpcInvoke).toHaveBeenCalledWith('emails:delete', 'email-1');
        });
    });

    it('calls emails:archive IPC on archive button click', async () => {
        mockIpcInvoke.mockResolvedValueOnce({ success: true });
        useEmailStore.setState({ selectedEmail: mockEmail });
        renderReadingPane();
        fireEvent.click(screen.getByTitle('Archive (E)'));
        await waitFor(() => {
            expect(mockIpcInvoke).toHaveBeenCalledWith('emails:archive', 'email-1');
        });
    });

    it('calls emails:toggle-flag IPC on star button click', async () => {
        useEmailStore.setState({ selectedEmail: mockEmail });
        renderReadingPane();
        fireEvent.click(screen.getByTitle('Flag'));
        await waitFor(() => {
            expect(mockIpcInvoke).toHaveBeenCalledWith('emails:toggle-flag', 'email-1', true);
        });
    });

    it('renders move dropdown with other folders (excludes current folder)', () => {
        useEmailStore.setState({ selectedEmail: mockEmail });
        renderReadingPane();
        // The mock dropdown renders inline, so menu items should appear
        expect(screen.getByText('Archive')).toBeInTheDocument();
        expect(screen.getByText('Sent')).toBeInTheDocument();
        // Inbox should NOT appear (it's the current folder)
        const menuItems = screen.getAllByRole('menuitem');
        const inboxItem = menuItems.find(item => item.textContent === 'Inbox');
        expect(inboxItem).toBeUndefined();
    });

    it('renders HTML email content', () => {
        useEmailStore.setState({ selectedEmail: mockEmail });
        renderReadingPane();
        const bodyHtml = document.querySelector('.email-body-html');
        expect(bodyHtml).toBeTruthy();
        expect(bodyHtml?.innerHTML).toContain('Hello world');
    });

    it('renders plain text when no body_html', () => {
        useEmailStore.setState({
            selectedEmail: { ...mockEmail, body_html: null },
        });
        renderReadingPane();
        expect(screen.getByText('Hello world')).toBeInTheDocument();
    });
});
