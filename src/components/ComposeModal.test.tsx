import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ComposeModal } from './ComposeModal';
import { ThemeProvider } from './ThemeContext';
import { useEmailStore } from '../stores/emailStore';
import { ipcInvoke } from '../lib/ipc';

vi.mock('../lib/ipc', () => ({
    ipcInvoke: vi.fn(),
}));

vi.mock('../lib/formatFileSize', () => ({
    formatFileSize: (bytes: number) => `${bytes} bytes`,
}));

// Mock TipTap
let mockEditorContent = '';
const mockEditor = {
    getHTML: () => mockEditorContent,
    chain: () => ({ focus: () => ({ toggleBold: () => ({ run: vi.fn() }), toggleItalic: () => ({ run: vi.fn() }), toggleUnderline: () => ({ run: vi.fn() }), toggleBulletList: () => ({ run: vi.fn() }), toggleOrderedList: () => ({ run: vi.fn() }), setLink: () => ({ run: vi.fn() }) }) }),
    isActive: () => false,
    on: vi.fn(),
    off: vi.fn(),
};

vi.mock('@tiptap/react', () => ({
    useEditor: () => mockEditor,
    EditorContent: ({ className }: { className?: string; editor: unknown }) => (
        <div className={className} data-testid="compose-editor" contentEditable>
            <div className="tiptap">{mockEditorContent}</div>
        </div>
    ),
}));

vi.mock('@tiptap/starter-kit', () => ({ default: {} }));
vi.mock('@tiptap/extension-link', () => ({ default: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-underline', () => ({ default: {} }));

vi.mock('dompurify', () => ({
    default: { sanitize: (html: string) => html },
}));

vi.mock('lucide-react', () => ({
    X: () => <div data-testid="icon-X">X</div>,
    Send: () => <div data-testid="icon-Send">S</div>,
    Paperclip: () => <div data-testid="icon-Paperclip">P</div>,
    Bold: () => <div data-testid="icon-Bold">B</div>,
    Italic: () => <div data-testid="icon-Italic">I</div>,
    Underline: () => <div data-testid="icon-Underline">U</div>,
    List: () => <div data-testid="icon-List">L</div>,
    ListOrdered: () => <div data-testid="icon-ListOrdered">LO</div>,
    Link: () => <div data-testid="icon-Link">Lk</div>,
    ChevronDown: () => <div data-testid="icon-ChevronDown">CD</div>,
    ChevronUp: () => <div data-testid="icon-ChevronUp">CU</div>,
    CalendarClock: () => <div data-testid="icon-CalendarClock">CC</div>,
    FileText: () => <div data-testid="icon-FileText">Ft</div>,
}));

vi.mock('@radix-ui/react-dropdown-menu', () => ({
    Root: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Trigger: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) => asChild ? <>{children}</> : <button>{children}</button>,
    Portal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Content: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className} role="menu">{children}</div>,
    Item: ({ children, onSelect, className }: { children: React.ReactNode; onSelect?: () => void; className?: string }) => (
        <div role="menuitem" className={className} onClick={onSelect}>{children}</div>
    ),
}));

vi.mock('./DateTimePicker', () => ({
    default: ({ label, onCancel }: { label?: string; onSelect?: (v: string) => void; onCancel?: () => void }) => (
        <div data-testid="date-time-picker">
            {label}
            {onCancel && <button onClick={onCancel}>Cancel</button>}
        </div>
    ),
}));

// Mock ContactAutocomplete to a simple input for testing
vi.mock('./ContactAutocomplete', () => ({
    ContactAutocomplete: ({ id, value, onChange, placeholder, className }: {
        id: string; value: string; onChange: (v: string) => void; placeholder?: string; className?: string;
    }) => (
        <input
            id={id}
            className={className}
            placeholder={placeholder}
            value={value}
            onChange={e => onChange(e.target.value)}
            data-testid={`autocomplete-${id}`}
        />
    ),
}));

const mockIpcInvoke = vi.mocked(ipcInvoke);

function renderCompose(props: Partial<Parameters<typeof ComposeModal>[0]> = {}) {
    const defaultProps = { onClose: vi.fn() };
    return render(
        <ThemeProvider>
            <ComposeModal {...defaultProps} {...props} />
        </ThemeProvider>
    );
}

describe('ComposeModal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIpcInvoke.mockResolvedValue(null);
        mockEditorContent = '';
        // Set up a test account in the store
        useEmailStore.setState({
            accounts: [{ id: 'acc-1', email: 'test@example.com', provider: 'gmail', display_name: 'Test', imap_host: null, imap_port: null, smtp_host: null, smtp_port: null, signature_html: null }],
        });
    });

    it('renders compose form with title and all fields', () => {
        renderCompose();
        expect(screen.getByText('compose.newMessage')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('compose.recipientPlaceholder')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('compose.subjectPlaceholder')).toBeInTheDocument();
        expect(screen.getByTestId('compose-editor')).toBeInTheDocument();
    });

    it('does not have glass class on modal element', () => {
        renderCompose();
        const modal = document.querySelector('.compose-modal');
        expect(modal).toBeTruthy();
        expect(modal?.classList.contains('glass')).toBe(false);
    });

    it('calls onClose when close button is clicked', () => {
        const onClose = vi.fn();
        renderCompose({ onClose });
        fireEvent.click(screen.getByLabelText('compose.close'));
        expect(onClose).toHaveBeenCalled();
    });

    it('shows CC/BCC fields when toggle is clicked', () => {
        renderCompose();
        expect(screen.queryByPlaceholderText('compose.ccPlaceholder')).not.toBeInTheDocument();
        fireEvent.click(screen.getByLabelText('compose.toggleCcBcc'));
        expect(screen.getByPlaceholderText('compose.ccPlaceholder')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('compose.bccPlaceholder')).toBeInTheDocument();
    });

    it('shows validation error when To is empty on send', async () => {
        renderCompose();
        fireEvent.click(screen.getByText('compose.send'));
        expect(screen.getByRole('alert')).toHaveTextContent('compose.recipientRequired');
    });

    it('shows validation error when Subject is empty on send', async () => {
        renderCompose();
        fireEvent.change(screen.getByPlaceholderText('compose.recipientPlaceholder'), { target: { value: 'user@test.com' } });
        fireEvent.click(screen.getByText('compose.send'));
        expect(screen.getByRole('alert')).toHaveTextContent('compose.subjectRequired');
    });

    it('calls email:send IPC with correct params on successful send', async () => {
        mockIpcInvoke.mockResolvedValueOnce(null); // templates:list (on mount)
        mockIpcInvoke.mockResolvedValueOnce({ success: true }); // email:send
        const onClose = vi.fn();
        mockEditorContent = '<p>Hello world</p>';
        renderCompose({ onClose });

        fireEvent.change(screen.getByPlaceholderText('compose.recipientPlaceholder'), { target: { value: 'user@test.com' } });
        fireEvent.change(screen.getByPlaceholderText('compose.subjectPlaceholder'), { target: { value: 'Test Subject' } });
        fireEvent.click(screen.getByText('compose.send'));

        await waitFor(() => {
            expect(mockIpcInvoke).toHaveBeenCalledWith('email:send', expect.objectContaining({
                accountId: 'acc-1',
                to: ['user@test.com'],
                subject: 'Test Subject',
            }));
        });

        await waitFor(() => {
            expect(onClose).toHaveBeenCalled();
        });
    });

    it('pre-fills fields from initialTo and initialSubject', () => {
        renderCompose({
            initialTo: 'reply@test.com',
            initialSubject: 'Re: Hello',
            initialBody: 'Original message',
        });
        expect(screen.getByPlaceholderText('compose.recipientPlaceholder')).toHaveValue('reply@test.com');
        expect(screen.getByPlaceholderText('compose.subjectPlaceholder')).toHaveValue('Re: Hello');
    });

    it('shows error when no account is configured', async () => {
        useEmailStore.setState({ accounts: [] });
        renderCompose();
        fireEvent.change(screen.getByPlaceholderText('compose.recipientPlaceholder'), { target: { value: 'user@test.com' } });
        fireEvent.change(screen.getByPlaceholderText('compose.subjectPlaceholder'), { target: { value: 'Sub' } });
        fireEvent.click(screen.getByText('compose.send'));
        expect(screen.getByRole('alert')).toHaveTextContent('compose.noAccount');
    });

    it('renders toolbar with formatting buttons', () => {
        renderCompose();
        expect(screen.getByTitle('compose.bold')).toBeInTheDocument();
        expect(screen.getByTitle('compose.italic')).toBeInTheDocument();
        expect(screen.getByTitle('compose.underline')).toBeInTheDocument();
        expect(screen.getByTitle('compose.bulletList')).toBeInTheDocument();
        expect(screen.getByTitle('compose.orderedList')).toBeInTheDocument();
        expect(screen.getByTitle('compose.insertLink')).toBeInTheDocument();
        expect(screen.getByTitle('compose.attachFiles')).toBeInTheDocument();
    });

    it('adds attachments when file picker returns files', async () => {
        mockIpcInvoke.mockImplementation(async (channel: string) => {
            if (channel === 'dialog:open-file') {
                return [{ filename: 'doc.pdf', content: 'base64data', contentType: 'application/pdf', size: 5000 }];
            }
            return null;
        });
        renderCompose();
        fireEvent.click(screen.getByTitle('compose.attachFiles'));
        await waitFor(() => {
            expect(screen.getByText('doc.pdf')).toBeInTheDocument();
            expect(screen.getByText('5000 bytes')).toBeInTheDocument();
        });
    });

    it('allows removing an attachment', async () => {
        mockIpcInvoke.mockImplementation(async (channel: string) => {
            if (channel === 'dialog:open-file') {
                return [{ filename: 'doc.pdf', content: 'base64data', contentType: 'application/pdf', size: 5000 }];
            }
            return null;
        });
        renderCompose();
        fireEvent.click(screen.getByTitle('compose.attachFiles'));
        await waitFor(() => {
            expect(screen.getByText('doc.pdf')).toBeInTheDocument();
        });
        fireEvent.click(screen.getByLabelText('compose.removeAttachment'));
        expect(screen.queryByText('doc.pdf')).not.toBeInTheDocument();
    });

    it('includes attachments in send payload', async () => {
        mockIpcInvoke.mockImplementation(async (channel: string) => {
            if (channel === 'dialog:open-file') {
                return [{ filename: 'doc.pdf', content: 'base64data', contentType: 'application/pdf', size: 5000 }];
            }
            if (channel === 'email:send') return { success: true };
            return null;
        });
        const onClose = vi.fn();
        renderCompose({ onClose });

        fireEvent.click(screen.getByTitle('compose.attachFiles'));
        await waitFor(() => expect(screen.getByText('doc.pdf')).toBeInTheDocument());

        fireEvent.change(screen.getByPlaceholderText('compose.recipientPlaceholder'), { target: { value: 'user@test.com' } });
        fireEvent.change(screen.getByPlaceholderText('compose.subjectPlaceholder'), { target: { value: 'With attachment' } });
        fireEvent.click(screen.getByText('compose.send'));

        await waitFor(() => {
            expect(mockIpcInvoke).toHaveBeenCalledWith('email:send', expect.objectContaining({
                attachments: [{ filename: 'doc.pdf', content: 'base64data', contentType: 'application/pdf' }],
            }));
        });
    });

    it('shows signature preview when account has signature', () => {
        useEmailStore.setState({
            accounts: [{ id: 'acc-1', email: 'test@example.com', provider: 'gmail', display_name: 'Test', imap_host: null, imap_port: null, smtp_host: null, smtp_port: null, signature_html: 'Best regards,<br />Test' }],
        });
        renderCompose();
        expect(screen.getByText(/Best regards/)).toBeInTheDocument();
    });

    it('does not show signature preview when account has no signature', () => {
        renderCompose();
        expect(screen.queryByText(/Best regards/)).not.toBeInTheDocument();
    });

    it('appends signature to HTML in send payload', async () => {
        useEmailStore.setState({
            accounts: [{ id: 'acc-1', email: 'test@example.com', provider: 'gmail', display_name: 'Test', imap_host: null, imap_port: null, smtp_host: null, smtp_port: null, signature_html: 'Best regards' }],
        });
        mockEditorContent = '<p>Hello</p>';
        mockIpcInvoke.mockResolvedValueOnce({ success: true });
        const onClose = vi.fn();
        renderCompose({ onClose });

        fireEvent.change(screen.getByPlaceholderText('compose.recipientPlaceholder'), { target: { value: 'user@test.com' } });
        fireEvent.change(screen.getByPlaceholderText('compose.subjectPlaceholder'), { target: { value: 'Sub' } });
        fireEvent.click(screen.getByText('compose.send'));

        await waitFor(() => {
            const call = mockIpcInvoke.mock.calls.find(c => c[0] === 'email:send');
            expect(call).toBeTruthy();
            const payload = call![1] as { html: string };
            expect(payload.html).toContain('Best regards');
            expect(payload.html).toContain('<hr />');
        });
    });
});
