import { useState, useEffect, useRef, useCallback, type FC } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Send, Paperclip, Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, Link, ChevronDown, ChevronUp } from 'lucide-react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import LinkExtension from '@tiptap/extension-link';
import UnderlineExtension from '@tiptap/extension-underline';
import DOMPurify from 'dompurify';
import { useEmailStore } from '../stores/emailStore';
import { ipcInvoke } from '../lib/ipc';
import { ContactAutocomplete } from './ContactAutocomplete';
import { formatFileSize } from '../lib/formatFileSize';

interface ComposeAttachment {
    id: string;
    filename: string;
    content: string;
    contentType: string;
    size: number;
}

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
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [currentDraftId, setCurrentDraftId] = useState<string | null>(draftId ?? null);
    const [attachments, setAttachments] = useState<ComposeAttachment[]>([]);
    const draftTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
    const draftBodyRef = useRef(initialBody);
    const accounts = useEmailStore(s => s.accounts);

    // Determine initial HTML content for editor
    const initialHtml = initialBody.trimStart().startsWith('<') ? initialBody : (initialBody ? `<p>${initialBody.replace(/\n/g, '<br />')}</p>` : '');

    const editor = useEditor({
        extensions: [
            StarterKit,
            LinkExtension.configure({ openOnClick: false }),
            UnderlineExtension,
        ],
        content: initialHtml,
        onUpdate: ({ editor: ed }: { editor: { getHTML: () => string } }) => {
            draftBodyRef.current = ed.getHTML();
        },
    });

    const accountSignature = accounts[0]?.signature_html ?? null;

    const handleAttachFiles = async () => {
        const files = await ipcInvoke<ComposeAttachment[]>('dialog:open-file');
        if (!files) return;

        const newTotal = attachments.length + files.length;
        if (newTotal > 10) {
            setError(`Maximum 10 attachments allowed (currently ${attachments.length})`);
            return;
        }
        const MAX_TOTAL = 25 * 1024 * 1024;
        const existingSize = attachments.reduce((s, a) => s + a.size, 0);
        const newSize = files.reduce((s, f) => s + f.size, 0);
        if (existingSize + newSize > MAX_TOTAL) {
            setError('Total attachments exceed 25MB limit');
            return;
        }
        for (const file of files) {
            if (file.size > MAX_TOTAL) {
                setError(`${file.filename} exceeds the 25MB limit`);
                return;
            }
        }
        const withIds = files.map((f, i) => ({ ...f, id: `${Date.now()}-${i}` }));
        setAttachments(prev => [...prev, ...withIds]);
    };

    const handleRemoveAttachment = (id: string) => {
        setAttachments(prev => prev.filter(a => a.id !== id));
    };

    // Auto-save draft every 2 seconds when content changes
    useEffect(() => {
        const bodyHtml = draftBodyRef.current;
        if (!to.trim() && !subject.trim() && !bodyHtml.trim()) return;
        const accountId = accounts[0]?.id;
        if (!accountId) return;

        if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
        draftTimerRef.current = setTimeout(async () => {
            const result = await ipcInvoke<{ id: string }>('drafts:save', {
                id: currentDraftId ?? undefined,
                accountId,
                to: to.trim(),
                subject: subject.trim(),
                bodyHtml,
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
    }, [to, cc, bcc, subject, accounts, currentDraftId]);

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
            let html = editor?.getHTML() ?? '';
            // Append signature if present (sanitize for defense in depth)
            if (accountSignature) {
                html += `<hr /><div class="email-signature">${DOMPurify.sanitize(accountSignature)}</div>`;
            }
            const recipients = parseRecipients(to);
            if (recipients.length === 0) { setError('Recipient is required'); setSending(false); return; }
            const ccList = parseRecipients(cc);
            const bccList = parseRecipients(bcc);
            const result = await ipcInvoke<{ success: boolean }>('email:send', {
                accountId,
                to: recipients,
                subject,
                html,
                ...(ccList.length > 0 ? { cc: ccList } : {}),
                ...(bccList.length > 0 ? { bcc: bccList } : {}),
                ...(attachments.length > 0 ? {
                    attachments: attachments.map(att => ({
                        filename: att.filename,
                        content: att.content,
                        contentType: att.contentType,
                    }))
                } : {}),
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

    const handleInsertLink = useCallback(() => {
        if (!editor) return;
        const url = window.prompt('Enter URL:');
        if (url && /^https?:\/\//i.test(url)) {
            editor.chain().focus().setLink({ href: url }).run();
        }
    }, [editor]);

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
                        <button
                            type="button"
                            className={`toolbar-btn${editor?.isActive('bold') ? ' toolbar-btn-active' : ''}`}
                            title="Bold"
                            aria-label="Bold"
                            onClick={() => editor?.chain().focus().toggleBold().run()}
                        ><Bold size={16} /></button>
                        <button
                            type="button"
                            className={`toolbar-btn${editor?.isActive('italic') ? ' toolbar-btn-active' : ''}`}
                            title="Italic"
                            aria-label="Italic"
                            onClick={() => editor?.chain().focus().toggleItalic().run()}
                        ><Italic size={16} /></button>
                        <button
                            type="button"
                            className={`toolbar-btn${editor?.isActive('underline') ? ' toolbar-btn-active' : ''}`}
                            title="Underline"
                            aria-label="Underline"
                            onClick={() => editor?.chain().focus().toggleUnderline().run()}
                        ><UnderlineIcon size={16} /></button>
                        <button
                            type="button"
                            className={`toolbar-btn${editor?.isActive('bulletList') ? ' toolbar-btn-active' : ''}`}
                            title="Bullet List"
                            aria-label="Bullet List"
                            onClick={() => editor?.chain().focus().toggleBulletList().run()}
                        ><List size={16} /></button>
                        <button
                            type="button"
                            className={`toolbar-btn${editor?.isActive('orderedList') ? ' toolbar-btn-active' : ''}`}
                            title="Ordered List"
                            aria-label="Ordered List"
                            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
                        ><ListOrdered size={16} /></button>
                        <button
                            type="button"
                            className={`toolbar-btn${editor?.isActive('link') ? ' toolbar-btn-active' : ''}`}
                            title="Insert Link"
                            aria-label="Insert Link"
                            onClick={handleInsertLink}
                        ><Link size={16} /></button>
                        <button type="button" className="toolbar-btn" title="Attach Files" aria-label="Attach Files" onClick={handleAttachFiles}><Paperclip size={16} /></button>
                    </div>

                    {attachments.length > 0 && (
                        <div className="compose-attachments">
                            {attachments.map(att => (
                                <div key={att.id} className="compose-attachment-chip">
                                    <Paperclip size={12} />
                                    <span className="compose-att-name">{att.filename}</span>
                                    <span className="compose-att-size">{formatFileSize(att.size)}</span>
                                    <button
                                        className="compose-att-remove"
                                        onClick={() => handleRemoveAttachment(att.id)}
                                        aria-label={`Remove ${att.filename}`}
                                        title="Remove attachment"
                                    >
                                        <X size={12} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="editor-area">
                        <EditorContent editor={editor} className="tiptap-editor" data-testid="compose-editor" />
                    </div>

                    {accountSignature && (
                        <div className="signature-preview">
                            <hr className="signature-divider" />
                            <div
                                className="signature-content"
                                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(accountSignature) }}
                            />
                        </div>
                    )}

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

                .toolbar-btn-active {
                    background: rgba(var(--color-accent), 0.15);
                    color: var(--accent-color);
                }

                .editor-area {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    overflow-y: auto;
                }

                .tiptap-editor {
                    flex: 1;
                    padding: 16px;
                    font-size: 15px;
                    font-family: inherit;
                    line-height: 1.6;
                    min-height: 200px;
                    color: var(--text-primary);
                }

                .tiptap-editor .tiptap {
                    outline: none;
                    min-height: 180px;
                }

                .tiptap-editor .tiptap p {
                    margin: 0 0 0.5em;
                }

                .tiptap-editor .tiptap a {
                    color: var(--accent-color);
                    text-decoration: underline;
                }

                .tiptap-editor .tiptap ul,
                .tiptap-editor .tiptap ol {
                    padding-left: 1.5em;
                    margin: 0.5em 0;
                }

                .signature-preview {
                    padding: 0 16px 8px;
                    font-size: 13px;
                    color: var(--text-secondary);
                }

                .signature-divider {
                    border: none;
                    border-top: 1px solid var(--glass-border);
                    margin: 0 0 8px;
                }

                .signature-content {
                    line-height: 1.4;
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

                .compose-attachments {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 6px;
                    padding: 8px 16px;
                    border-bottom: 1px solid var(--glass-border);
                }

                .compose-attachment-chip {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    padding: 4px 8px;
                    border-radius: 6px;
                    background: var(--bg-secondary);
                    border: 1px solid var(--glass-border);
                    font-size: 12px;
                    color: var(--text-primary);
                    max-width: 240px;
                }

                .compose-att-name {
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    max-width: 140px;
                }

                .compose-att-size {
                    color: var(--text-secondary);
                    font-size: 11px;
                    white-space: nowrap;
                }

                .compose-att-remove {
                    padding: 2px;
                    border-radius: 4px;
                    color: var(--text-secondary);
                    display: flex;
                    align-items: center;
                }

                .compose-att-remove:hover {
                    background: var(--close-hover-bg);
                    color: rgb(var(--color-danger));
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
