import { useState, useEffect, useRef, type FC } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Send, Paperclip, Image, Type, ChevronDown, ChevronUp } from 'lucide-react';
import { useEmailStore } from '../stores/emailStore';
import { ipcInvoke } from '../lib/ipc';
import { ContactAutocomplete } from './ContactAutocomplete';

interface ComposeModalProps {
    onClose: () => void;
    initialTo?: string;
    initialSubject?: string;
    initialBody?: string;
    draftId?: string;
}

export const ComposeModal: FC<ComposeModalProps> = ({ onClose, initialTo = '', initialSubject = '', initialBody = '', draftId }) => {
    const [to, setTo] = useState(initialTo);
    const [cc, setCc] = useState('');
    const [bcc, setBcc] = useState('');
    const [showCcBcc, setShowCcBcc] = useState(false);
    const [subject, setSubject] = useState(initialSubject);
    const [body, setBody] = useState(initialBody);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [currentDraftId, setCurrentDraftId] = useState<string | null>(draftId ?? null);
    const draftTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
    const accounts = useEmailStore(s => s.accounts);

    // Auto-save draft every 2 seconds when content changes
    useEffect(() => {
        if (!to.trim() && !subject.trim() && !body.trim()) return;
        const accountId = accounts[0]?.id;
        if (!accountId) return;

        if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
        draftTimerRef.current = setTimeout(async () => {
            const result = await ipcInvoke<{ id: string }>('drafts:save', {
                id: currentDraftId ?? undefined,
                accountId,
                to: to.trim(),
                subject: subject.trim(),
                bodyHtml: body,
                cc: cc.trim() || undefined,
                bcc: bcc.trim() || undefined,
            });
            if (result?.id && !currentDraftId) {
                setCurrentDraftId(result.id);
            }
        }, 2000);

        return () => {
            if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
        };
    }, [to, cc, bcc, subject, body, accounts, currentDraftId]);

    const parseRecipients = (value: string) =>
        value.split(',').map(s => s.trim()).filter(s => s.length > 0);

    const handleSend = async () => {
        if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
        if (!to.trim()) { setError('Recipient is required'); return; }
        if (!subject.trim()) { setError('Subject is required'); return; }

        const accountId = accounts[0]?.id;
        if (!accountId) { setError('No account configured'); return; }

        setSending(true);
        setError(null);
        try {
            const escaped = body
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;')
                .replace(/\n/g, '<br />');
            const recipients = parseRecipients(to);
            if (recipients.length === 0) { setError('Recipient is required'); setSending(false); return; }
            const ccList = parseRecipients(cc);
            const bccList = parseRecipients(bcc);
            const result = await ipcInvoke<{ success: boolean }>('email:send', {
                accountId,
                to: recipients,
                subject,
                html: `<p>${escaped}</p>`,
                ...(ccList.length > 0 ? { cc: ccList } : {}),
                ...(bccList.length > 0 ? { bcc: bccList } : {}),
            });
            if (result?.success) {
                if (currentDraftId && accountId) {
                    await ipcInvoke('drafts:delete', { draftId: currentDraftId, accountId });
                }
                onClose();
            } else {
                setError('Failed to send email');
            }
        } catch {
            setError('An error occurred while sending');
        } finally {
            setSending(false);
        }
    };

    return (
        <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
            <Dialog.Portal>
                <Dialog.Overlay className="compose-overlay" />
                <Dialog.Content className="compose-modal" aria-describedby={undefined}>
                    <div className="compose-modal__header">
                        <Dialog.Title className="compose-modal__title">New Message</Dialog.Title>
                        <Dialog.Close asChild>
                            <button className="compose-close-btn" aria-label="Close compose">
                                <X size={18} />
                            </button>
                        </Dialog.Close>
                    </div>

                    <div className="compose-fields">
                        <div className="field-row">
                            <label htmlFor="compose-to" className="field-label">To:</label>
                            <ContactAutocomplete
                                id="compose-to"
                                className="compose-input"
                                placeholder="Recipient..."
                                value={to}
                                onChange={setTo}
                            />
                            <button
                                type="button"
                                className="ccbcc-toggle"
                                onClick={() => setShowCcBcc(!showCcBcc)}
                                aria-expanded={showCcBcc}
                                aria-label="Toggle CC and BCC fields"
                            >
                                {showCcBcc ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                <span>CC/BCC</span>
                            </button>
                        </div>
                        {showCcBcc && (
                            <>
                                <div className="field-row">
                                    <label htmlFor="compose-cc" className="field-label">CC:</label>
                                    <ContactAutocomplete
                                        id="compose-cc"
                                        className="compose-input"
                                        placeholder="CC recipients..."
                                        value={cc}
                                        onChange={setCc}
                                    />
                                </div>
                                <div className="field-row">
                                    <label htmlFor="compose-bcc" className="field-label">BCC:</label>
                                    <ContactAutocomplete
                                        id="compose-bcc"
                                        className="compose-input"
                                        placeholder="BCC recipients..."
                                        value={bcc}
                                        onChange={setBcc}
                                    />
                                </div>
                            </>
                        )}
                        <div className="field-row">
                            <label htmlFor="compose-subject" className="field-label">Subject:</label>
                            <input id="compose-subject" type="text" className="compose-input" placeholder="Subject..."
                                value={subject} onChange={e => setSubject(e.target.value)} />
                        </div>
                    </div>

                    {error && (
                        <div className="compose-error" role="alert">{error}</div>
                    )}

                    <div className="toolbar">
                        <button className="toolbar-btn" title="Formatting"><Type size={16} /></button>
                        <button className="toolbar-btn" title="Insert Link"><Image size={16} /></button>
                        <button className="toolbar-btn" title="Attach Files"><Paperclip size={16} /></button>
                    </div>

                    <div className="editor-area">
                        <textarea
                            className="rich-text-stub"
                            placeholder="Write your beautiful email here..."
                            value={body}
                            onChange={e => setBody(e.target.value)}
                        />
                    </div>

                    <div className="compose-modal__footer">
                        <button className="send-btn" onClick={handleSend} disabled={sending}>
                            <span>{sending ? 'Sending...' : 'Send'}</span>
                            <Send size={14} />
                        </button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>

            <style>{`
                .compose-overlay {
                    position: fixed;
                    inset: 0;
                    background: rgba(0, 0, 0, 0.55);
                    backdrop-filter: blur(8px);
                    -webkit-backdrop-filter: blur(8px);
                    z-index: 1000;
                    animation: overlayFadeIn 0.15s ease-out;
                }

                .compose-modal {
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    animation: composeFadeIn 0.2s ease-out;
                    width: 640px;
                    max-height: 80vh;
                    border-radius: 12px;
                    display: flex;
                    flex-direction: column;
                    background: rgb(var(--color-bg-elevated));
                    color: var(--text-primary);
                    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
                    overflow: hidden;
                    z-index: 1001;
                }

                .compose-modal__header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 12px 16px;
                    border-bottom: 1px solid var(--glass-border);
                }

                .compose-modal__title {
                    font-weight: 600;
                    font-size: 14px;
                    margin: 0;
                }

                .compose-close-btn {
                    color: var(--text-secondary);
                    padding: 6px;
                    border-radius: 6px;
                }

                .compose-close-btn:hover {
                    background: var(--close-hover-bg);
                    color: var(--text-primary);
                }

                .compose-fields {
                    display: flex;
                    flex-direction: column;
                }

                .field-row {
                    display: flex;
                    align-items: center;
                    padding: 0 16px;
                    border-bottom: 1px solid var(--glass-border);
                }

                .field-label {
                    color: var(--text-secondary);
                    font-size: 14px;
                    width: 60px;
                }

                .compose-input {
                    flex: 1;
                    background: transparent;
                    border: none;
                    color: var(--text-primary);
                    padding: 12px 0;
                    font-size: 14px;
                    font-family: inherit;
                    outline: none;
                }

                .ccbcc-toggle {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    padding: 4px 8px;
                    border-radius: 4px;
                    color: var(--text-secondary);
                    font-size: 12px;
                    font-weight: 500;
                    white-space: nowrap;
                }

                .ccbcc-toggle:hover {
                    background: var(--hover-bg);
                    color: var(--text-primary);
                }

                .compose-error {
                    padding: 8px 16px;
                    color: rgb(var(--color-danger));
                    font-size: 13px;
                }

                .toolbar {
                    display: flex;
                    gap: 4px;
                    padding: 8px 16px;
                    border-bottom: 1px solid var(--glass-border);
                }

                .toolbar-btn {
                    width: 30px;
                    height: 30px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 4px;
                    color: var(--text-secondary);
                }

                .toolbar-btn:hover {
                    background: var(--close-hover-bg);
                    color: var(--text-primary);
                }

                .editor-area {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                }

                .rich-text-stub {
                    flex: 1;
                    background: transparent;
                    border: none;
                    color: var(--text-primary);
                    padding: 16px;
                    font-size: 15px;
                    font-family: inherit;
                    resize: none;
                    outline: none;
                    line-height: 1.6;
                }

                .compose-modal__footer {
                    padding: 12px 16px;
                    display: flex;
                    justify-content: flex-end;
                    border-top: 1px solid var(--glass-border);
                }

                .send-btn {
                    background: var(--accent-color);
                    color: white;
                    border-radius: 6px;
                    padding: 8px 20px;
                    font-weight: 600;
                    font-size: 14px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .send-btn:hover {
                    background: var(--accent-hover);
                }

                .send-btn:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                }

                @keyframes overlayFadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }

                @keyframes composeFadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }

                @media (prefers-reduced-motion: reduce) {
                    .compose-overlay,
                    .compose-modal {
                        animation: none !important;
                    }
                }
            `}</style>
        </Dialog.Root>
    );
};
