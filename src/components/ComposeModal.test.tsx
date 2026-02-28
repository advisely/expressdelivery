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
    chain: () => ({ focus: () => ({ toggleBold: () => ({ run: vi.fn() }), toggleItalic: () => ({ run: vi.fn() }), toggleUnderline: () => ({ run: vi.fn() }), toggleBulletList: () => ({ run: vi.fn() }), toggleOrderedList: () => ({ run: vi.fn() }), setLink: () => ({ run: vi.fn() }), insertContent: () => ({ run: vi.fn() }) }) }),
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
        mockIpcInvoke.mockImplementation((channel: string) => {
            if (channel === 'email:send') return Promise.resolve({ success: true });
            return Promise.resolve(null);
        });
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

    // -----------------------------------------------------------------------
    // Account selection
    // -----------------------------------------------------------------------
    describe('Account selection', () => {
        it('uses initialAccountId for sending when provided', async () => {
            useEmailStore.setState({
                accounts: [
                    { id: 'acc-1', email: 'first@example.com', provider: 'gmail', display_name: 'First', imap_host: null, imap_port: null, smtp_host: null, smtp_port: null, signature_html: null },
                    { id: 'acc-2', email: 'second@example.com', provider: 'outlook', display_name: 'Second', imap_host: null, imap_port: null, smtp_host: null, smtp_port: null, signature_html: null },
                ],
            });
            mockIpcInvoke.mockImplementation((channel: string) => {
                if (channel === 'email:send') return Promise.resolve({ success: true });
                return Promise.resolve(null);
            });
            mockEditorContent = '<p>Hello</p>';
            const onClose = vi.fn();
            renderCompose({ onClose, initialAccountId: 'acc-2' });

            fireEvent.change(screen.getByPlaceholderText('compose.recipientPlaceholder'), { target: { value: 'user@test.com' } });
            fireEvent.change(screen.getByPlaceholderText('compose.subjectPlaceholder'), { target: { value: 'Test Subject' } });
            fireEvent.click(screen.getByText('compose.send'));

            await waitFor(() => {
                expect(mockIpcInvoke).toHaveBeenCalledWith('email:send', expect.objectContaining({
                    accountId: 'acc-2',
                }));
            });
        });

        it('falls back to first account when initialAccountId is not found', async () => {
            useEmailStore.setState({
                accounts: [
                    { id: 'acc-1', email: 'first@example.com', provider: 'gmail', display_name: 'First', imap_host: null, imap_port: null, smtp_host: null, smtp_port: null, signature_html: null },
                ],
            });
            mockIpcInvoke.mockImplementation((channel: string) => {
                if (channel === 'email:send') return Promise.resolve({ success: true });
                return Promise.resolve(null);
            });
            mockEditorContent = '<p>Hello</p>';
            const onClose = vi.fn();
            renderCompose({ onClose, initialAccountId: 'nonexistent' });

            fireEvent.change(screen.getByPlaceholderText('compose.recipientPlaceholder'), { target: { value: 'user@test.com' } });
            fireEvent.change(screen.getByPlaceholderText('compose.subjectPlaceholder'), { target: { value: 'Test Subject' } });
            fireEvent.click(screen.getByText('compose.send'));

            await waitFor(() => {
                expect(mockIpcInvoke).toHaveBeenCalledWith('email:send', expect.objectContaining({
                    accountId: 'acc-1',
                }));
            });
        });

        // -------------------------------------------------------------------
        // Edge cases — Phase 8
        // -------------------------------------------------------------------

        it('shows compose.noAccount error when accounts array is empty and send is clicked', async () => {
            // Explicitly test empty accounts array — sendingAccount becomes undefined
            useEmailStore.setState({ accounts: [] });
            renderCompose();

            fireEvent.change(screen.getByPlaceholderText('compose.recipientPlaceholder'), { target: { value: 'user@test.com' } });
            fireEvent.change(screen.getByPlaceholderText('compose.subjectPlaceholder'), { target: { value: 'Test Subject' } });
            fireEvent.click(screen.getByText('compose.send'));

            // sendingAccount is undefined → accountId undefined → error
            expect(screen.getByRole('alert')).toHaveTextContent('compose.noAccount');
        });

        it('does not call email:send IPC when accounts array is empty', async () => {
            useEmailStore.setState({ accounts: [] });
            renderCompose();

            fireEvent.change(screen.getByPlaceholderText('compose.recipientPlaceholder'), { target: { value: 'user@test.com' } });
            fireEvent.change(screen.getByPlaceholderText('compose.subjectPlaceholder'), { target: { value: 'Test Subject' } });
            fireEvent.click(screen.getByText('compose.send'));

            await new Promise(r => setTimeout(r, 50));
            expect(mockIpcInvoke).not.toHaveBeenCalledWith('email:send', expect.anything());
        });

        it('falls back to accounts[0] when initialAccountId is empty string', async () => {
            useEmailStore.setState({
                accounts: [
                    { id: 'acc-1', email: 'first@example.com', provider: 'gmail', display_name: 'First', imap_host: null, imap_port: null, smtp_host: null, smtp_port: null, signature_html: null },
                ],
            });
            mockIpcInvoke.mockImplementation((channel: string) => {
                if (channel === 'email:send') return Promise.resolve({ success: true });
                return Promise.resolve(null);
            });
            mockEditorContent = '<p>Hello</p>';
            const onClose = vi.fn();
            // initialAccountId is empty string — `if (initialAccountId)` is falsy → falls through to accounts[0]
            renderCompose({ onClose, initialAccountId: '' });

            fireEvent.change(screen.getByPlaceholderText('compose.recipientPlaceholder'), { target: { value: 'user@test.com' } });
            fireEvent.change(screen.getByPlaceholderText('compose.subjectPlaceholder'), { target: { value: 'Test Subject' } });
            fireEvent.click(screen.getByText('compose.send'));

            await waitFor(() => {
                expect(mockIpcInvoke).toHaveBeenCalledWith('email:send', expect.objectContaining({
                    accountId: 'acc-1',
                }));
            });
        });

        it('uses account signature from matched initialAccountId', () => {
            useEmailStore.setState({
                accounts: [
                    { id: 'acc-1', email: 'first@example.com', provider: 'gmail', display_name: 'First', imap_host: null, imap_port: null, smtp_host: null, smtp_port: null, signature_html: 'Regards, First' },
                    { id: 'acc-2', email: 'second@example.com', provider: 'outlook', display_name: 'Second', imap_host: null, imap_port: null, smtp_host: null, smtp_port: null, signature_html: 'Best, Second' },
                ],
            });
            // initialAccountId targets acc-2, so its signature "Best, Second" should appear
            renderCompose({ initialAccountId: 'acc-2' });
            expect(screen.getByText(/Best, Second/)).toBeInTheDocument();
            expect(screen.queryByText(/Regards, First/)).not.toBeInTheDocument();
        });
    });

    // -----------------------------------------------------------------------
    // Optimal send time
    // -----------------------------------------------------------------------
    describe('Optimal send time', () => {
        it('shows suggested send time hint when analytics:busiest-hours returns data', async () => {
            mockIpcInvoke.mockImplementation(async (channel: string) => {
                if (channel === 'analytics:busiest-hours') {
                    return [{ hour: 9, count: 42 }];
                }
                return null;
            });
            renderCompose();

            // The suggested time hint renders when busiestHours[0] exists.
            // t('compose.suggestedTime') returns the key itself; the span text is
            // "compose.suggestedTime: <locale time>" so we match with a regex.
            await waitFor(() => {
                expect(screen.getByText(/compose\.suggestedTime/)).toBeInTheDocument();
            });
        });

        it('does not show suggested send time hint when analytics:busiest-hours returns empty array', async () => {
            mockIpcInvoke.mockImplementation(async (channel: string) => {
                if (channel === 'analytics:busiest-hours') return [];
                return null;
            });
            renderCompose();

            // Give the effect time to settle
            await new Promise(r => setTimeout(r, 50));

            // busiestHours.length === 0 → hint must not render
            expect(screen.queryByText(/compose\.suggestedTime/)).not.toBeInTheDocument();
        });

        it('does not show suggested send time hint when analytics:busiest-hours returns null', async () => {
            mockIpcInvoke.mockImplementation(async (channel: string) => {
                if (channel === 'analytics:busiest-hours') return null;
                return null;
            });
            renderCompose();

            await new Promise(r => setTimeout(r, 50));

            // null is not an array → Array.isArray guard fires → busiestHours stays empty
            expect(screen.queryByText(/compose\.suggestedTime/)).not.toBeInTheDocument();
        });

        it('does not show suggested send time hint when analytics:busiest-hours returns a non-array value', async () => {
            // A non-array truthy return (e.g. an object) should not populate busiestHours
            // and must not cause a crash. This exercises the Array.isArray guard path.
            mockIpcInvoke.mockImplementation(async (channel: string) => {
                if (channel === 'analytics:busiest-hours') return { error: 'Service unavailable' };
                return null;
            });
            renderCompose();

            await new Promise(r => setTimeout(r, 50));

            // Non-array result → Array.isArray is false → setBusiestHours not called → hint absent
            expect(screen.queryByText(/compose\.suggestedTime/)).not.toBeInTheDocument();
        });

        it('does not fetch busiest hours when accounts array is empty (no sendingAccount)', async () => {
            useEmailStore.setState({ accounts: [] });
            renderCompose();

            await new Promise(r => setTimeout(r, 50));

            // The effect guard: `if (!accountId) return;` fires when sendingAccount is undefined
            expect(mockIpcInvoke).not.toHaveBeenCalledWith('analytics:busiest-hours', expect.anything());
        });

        it('refetches busiest hours when sendingAccount changes', async () => {
            // Start with acc-1
            useEmailStore.setState({
                accounts: [
                    { id: 'acc-1', email: 'first@example.com', provider: 'gmail', display_name: 'First', imap_host: null, imap_port: null, smtp_host: null, smtp_port: null, signature_html: null },
                ],
            });
            mockIpcInvoke.mockImplementation(async (channel: string) => {
                if (channel === 'analytics:busiest-hours') return [{ hour: 10, count: 5 }];
                return null;
            });
            renderCompose({ initialAccountId: 'acc-1' });

            await waitFor(() => {
                expect(mockIpcInvoke).toHaveBeenCalledWith('analytics:busiest-hours', 'acc-1');
            });
        });
    });

    // -----------------------------------------------------------------------
    // onSendPending path
    // -----------------------------------------------------------------------
    describe('onSendPending delegation', () => {
        it('calls onSendPending instead of email:send IPC when prop is provided', async () => {
            mockEditorContent = '<p>Hello</p>';
            const onSendPending = vi.fn();
            const onClose = vi.fn();
            mockIpcInvoke.mockResolvedValue(null);

            renderCompose({ onSendPending, onClose });

            fireEvent.change(screen.getByPlaceholderText('compose.recipientPlaceholder'), { target: { value: 'user@test.com' } });
            fireEvent.change(screen.getByPlaceholderText('compose.subjectPlaceholder'), { target: { value: 'Test Subject' } });
            fireEvent.click(screen.getByText('compose.send'));

            await waitFor(() => {
                expect(onSendPending).toHaveBeenCalledWith(expect.objectContaining({
                    accountId: 'acc-1',
                    to: ['user@test.com'],
                    subject: 'Test Subject',
                }));
                expect(onClose).toHaveBeenCalled();
            });

            // email:send IPC must NOT have been called
            expect(mockIpcInvoke).not.toHaveBeenCalledWith('email:send', expect.anything());
        });

        it('calls onSendPending with cc and bcc when they are filled', async () => {
            mockEditorContent = '<p>Hello</p>';
            const onSendPending = vi.fn();
            mockIpcInvoke.mockResolvedValue(null);

            renderCompose({ onSendPending });

            fireEvent.change(screen.getByPlaceholderText('compose.recipientPlaceholder'), { target: { value: 'to@test.com' } });
            fireEvent.change(screen.getByPlaceholderText('compose.subjectPlaceholder'), { target: { value: 'Subject' } });

            // Expand CC/BCC and fill them
            fireEvent.click(screen.getByLabelText('compose.toggleCcBcc'));
            fireEvent.change(screen.getByPlaceholderText('compose.ccPlaceholder'), { target: { value: 'cc@test.com' } });
            fireEvent.change(screen.getByPlaceholderText('compose.bccPlaceholder'), { target: { value: 'bcc@test.com' } });

            fireEvent.click(screen.getByText('compose.send'));

            await waitFor(() => {
                expect(onSendPending).toHaveBeenCalledWith(expect.objectContaining({
                    cc: ['cc@test.com'],
                    bcc: ['bcc@test.com'],
                }));
            });
        });
    });
});
