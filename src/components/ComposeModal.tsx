import { useState, useEffect, useRef, useCallback, type FC } from 'react';
import styles from './ComposeModal.module.css';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Send, Paperclip, Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, Link, ChevronDown, ChevronUp, CalendarClock, FileText } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import LinkExtension from '@tiptap/extension-link';
import UnderlineExtension from '@tiptap/extension-underline';
import DOMPurify from 'dompurify';
import { useTranslation } from 'react-i18next';
import { useEmailStore } from '../stores/emailStore';
import { ipcInvoke } from '../lib/ipc';
import { ContactAutocomplete } from './ContactAutocomplete';
import { formatFileSize } from '../lib/formatFileSize';
import DateTimePicker from './DateTimePicker';

interface ComposeAttachment {
    id: string;
    filename: string;
    content: string;
    contentType: string;
    size: number;
}

export interface SendPayload {
    to: string[];
    subject: string;
    body: string;
    cc?: string[];
    bcc?: string[];
    accountId: string;
    attachments?: Array<{ filename: string; content: string; contentType: string }>;
}

interface ComposeModalProps {
    onClose: () => void;
    onSendPending?: (payload: SendPayload) => void;
    initialTo?: string;
    initialSubject?: string;
    initialBody?: string;
    draftId?: string;
}

export const ComposeModal: FC<ComposeModalProps> = ({ onClose, onSendPending, initialTo = '', initialSubject = '', initialBody = '', draftId }) => {
    const { t } = useTranslation();
    const [to, setTo] = useState(initialTo);
    const [cc, setCc] = useState('');
    const [bcc, setBcc] = useState('');
    const [showCcBcc, setShowCcBcc] = useState(false);
    const [subject, setSubject] = useState(initialSubject);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [currentDraftId, setCurrentDraftId] = useState<string | null>(draftId ?? null);
    const [attachments, setAttachments] = useState<ComposeAttachment[]>([]);
    const [showSchedulePicker, setShowSchedulePicker] = useState(false);
    const [templates, setTemplates] = useState<Array<{ id: string; name: string; body_html: string }>>([]);
    const [showTemplatePicker, setShowTemplatePicker] = useState(false);
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
            setError(t('compose.maxAttachments', { count: attachments.length }));
            return;
        }
        const MAX_TOTAL = 25 * 1024 * 1024;
        const existingSize = attachments.reduce((s, a) => s + a.size, 0);
        const newSize = files.reduce((s, f) => s + f.size, 0);
        if (existingSize + newSize > MAX_TOTAL) {
            setError(t('compose.exceedsTotalSize'));
            return;
        }
        for (const file of files) {
            if (file.size > MAX_TOTAL) {
                setError(t('compose.fileExceedsSize', { filename: file.filename }));
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

    // Load reply templates on mount
    useEffect(() => {
        ipcInvoke<Array<{ id: string; name: string; body_html: string }>>('templates:list')
            .then(result => { if (result) setTemplates(result); });
    }, []);

    const parseRecipients = (value: string) =>
        value.split(',').map(s => s.trim()).filter(s => s.length > 0);

    const handleSend = async () => {
        if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
        if (!to.trim()) { setError(t('compose.recipientRequired')); return; }
        if (!subject.trim()) { setError(t('compose.subjectRequired')); return; }

        const accountId = accounts[0]?.id;
        if (!accountId) { setError(t('compose.noAccount')); return; }

        setSending(true);
        setError(null);
        try {
            let html = editor?.getHTML() ?? '';
            // Append signature if present (sanitize for defense in depth)
            if (accountSignature) {
                html += `<hr /><div class="email-signature">${DOMPurify.sanitize(accountSignature)}</div>`;
            }
            const recipients = parseRecipients(to);
            if (recipients.length === 0) { setError(t('compose.recipientRequired')); setSending(false); return; }
            const ccList = parseRecipients(cc);
            const bccList = parseRecipients(bcc);
            const payload: SendPayload = {
                accountId,
                to: recipients,
                subject,
                body: html,
                ...(ccList.length > 0 ? { cc: ccList } : {}),
                ...(bccList.length > 0 ? { bcc: bccList } : {}),
                ...(attachments.length > 0 ? {
                    attachments: attachments.map(att => ({
                        filename: att.filename,
                        content: att.content,
                        contentType: att.contentType,
                    }))
                } : {}),
            };

            if (onSendPending) {
                // Delegate to parent for undo-send timer logic
                if (currentDraftId && accountId) {
                    await ipcInvoke('drafts:delete', { draftId: currentDraftId, accountId });
                }
                onSendPending(payload);
                onClose();
            } else {
                const result = await ipcInvoke<{ success: boolean }>('email:send', {
                    accountId: payload.accountId,
                    to: payload.to,
                    subject: payload.subject,
                    html: payload.body,
                    ...(payload.cc ? { cc: payload.cc } : {}),
                    ...(payload.bcc ? { bcc: payload.bcc } : {}),
                    ...(payload.attachments ? { attachments: payload.attachments } : {}),
                });
                if (result?.success) {
                    if (currentDraftId && accountId) {
                        await ipcInvoke('drafts:delete', { draftId: currentDraftId, accountId });
                    }
                    onClose();
                } else {
                    setError(t('compose.sendFailed'));
                }
            }
        } catch {
            setError(t('compose.sendError'));
        } finally {
            setSending(false);
        }
    };

    const handleInsertLink = useCallback(() => {
        if (!editor) return;
        const url = window.prompt(t('compose.enterUrl'));
        if (url && /^https?:\/\//i.test(url)) {
            editor.chain().focus().setLink({ href: url }).run();
        }
    }, [editor, t]);

    const handleScheduleSend = async (sendAt: string) => {
        if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
        if (!to.trim()) { setError(t('compose.recipientRequired')); return; }
        if (!subject.trim()) { setError(t('compose.subjectRequired')); return; }

        const accountId = accounts[0]?.id;
        if (!accountId) { setError(t('compose.noAccount')); return; }

        setSending(true);
        setError(null);
        try {
            let html = editor?.getHTML() ?? '';
            if (accountSignature) {
                html += `<hr /><div class="email-signature">${DOMPurify.sanitize(accountSignature)}</div>`;
            }
            const recipients = parseRecipients(to);
            if (recipients.length === 0) { setError(t('compose.recipientRequired')); setSending(false); return; }
            const ccList = parseRecipients(cc);
            const bccList = parseRecipients(bcc);
            const result = await ipcInvoke<{ success: boolean; scheduledId: string }>('scheduled:create', {
                accountId,
                to: recipients.join(', '),
                subject,
                bodyHtml: html,
                sendAt,
                ...(ccList.length > 0 ? { cc: ccList.join(', ') } : {}),
                ...(bccList.length > 0 ? { bcc: bccList.join(', ') } : {}),
                ...(attachments.length > 0 ? {
                    attachments: attachments.map(att => ({
                        filename: att.filename,
                        content: att.content,
                        contentType: att.contentType,
                    }))
                } : {}),
            });
            if (result?.scheduledId) {
                if (currentDraftId && accountId) {
                    await ipcInvoke('drafts:delete', { draftId: currentDraftId, accountId });
                }
                onClose();
            } else {
                setError(t('compose.scheduleFailed'));
            }
        } catch {
            setError(t('compose.scheduleError'));
        } finally {
            setSending(false);
            setShowSchedulePicker(false);
        }
    };

    return (
        <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
            <Dialog.Portal>
                <Dialog.Overlay className="compose-overlay" />
                <Dialog.Content className="compose-modal" aria-describedby={undefined}>
                    <div className={styles['compose-modal__header']}>
                        <Dialog.Title className={styles['compose-modal__title']}>{t('compose.newMessage')}</Dialog.Title>
                        <Dialog.Close asChild>
                            <button className={styles['compose-close-btn']} aria-label={t('compose.close')}>
                                <X size={18} />
                            </button>
                        </Dialog.Close>
                    </div>

                    <div className={styles['compose-fields']}>
                        <div className={styles['field-row']}>
                            <label htmlFor="compose-to" className={styles['field-label']}>{t('compose.to')}:</label>
                            <ContactAutocomplete
                                id="compose-to"
                                className={styles['compose-input']}
                                placeholder={t('compose.recipientPlaceholder')}
                                value={to}
                                onChange={setTo}
                            />
                            <button
                                type="button"
                                className={styles['ccbcc-toggle']}
                                onClick={() => setShowCcBcc(!showCcBcc)}
                                aria-expanded={showCcBcc}
                                aria-label={t('compose.toggleCcBcc')}
                            >
                                {showCcBcc ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                <span>{t('compose.ccBcc')}</span>
                            </button>
                        </div>
                        {showCcBcc && (
                            <>
                                <div className={styles['field-row']}>
                                    <label htmlFor="compose-cc" className={styles['field-label']}>{t('compose.cc')}:</label>
                                    <ContactAutocomplete
                                        id="compose-cc"
                                        className={styles['compose-input']}
                                        placeholder={t('compose.ccPlaceholder')}
                                        value={cc}
                                        onChange={setCc}
                                    />
                                </div>
                                <div className={styles['field-row']}>
                                    <label htmlFor="compose-bcc" className={styles['field-label']}>{t('compose.bcc')}:</label>
                                    <ContactAutocomplete
                                        id="compose-bcc"
                                        className={styles['compose-input']}
                                        placeholder={t('compose.bccPlaceholder')}
                                        value={bcc}
                                        onChange={setBcc}
                                    />
                                </div>
                            </>
                        )}
                        <div className={styles['field-row']}>
                            <label htmlFor="compose-subject" className={styles['field-label']}>{t('compose.subject')}:</label>
                            <input id="compose-subject" type="text" className={styles['compose-input']} placeholder={t('compose.subjectPlaceholder')}
                                value={subject} onChange={e => setSubject(e.target.value)} />
                        </div>
                    </div>

                    {error && (
                        <div className={styles['compose-error']} role="alert">{error}</div>
                    )}

                    <div className={styles['toolbar']}>
                        <button
                            type="button"
                            className={`${styles['toolbar-btn']}${editor?.isActive('bold') ? ` ${styles['toolbar-btn-active']}` : ''}`}
                            title={t('compose.bold')}
                            aria-label={t('compose.bold')}
                            onClick={() => editor?.chain().focus().toggleBold().run()}
                        ><Bold size={16} /></button>
                        <button
                            type="button"
                            className={`${styles['toolbar-btn']}${editor?.isActive('italic') ? ` ${styles['toolbar-btn-active']}` : ''}`}
                            title={t('compose.italic')}
                            aria-label={t('compose.italic')}
                            onClick={() => editor?.chain().focus().toggleItalic().run()}
                        ><Italic size={16} /></button>
                        <button
                            type="button"
                            className={`${styles['toolbar-btn']}${editor?.isActive('underline') ? ` ${styles['toolbar-btn-active']}` : ''}`}
                            title={t('compose.underline')}
                            aria-label={t('compose.underline')}
                            onClick={() => editor?.chain().focus().toggleUnderline().run()}
                        ><UnderlineIcon size={16} /></button>
                        <button
                            type="button"
                            className={`${styles['toolbar-btn']}${editor?.isActive('bulletList') ? ` ${styles['toolbar-btn-active']}` : ''}`}
                            title={t('compose.bulletList')}
                            aria-label={t('compose.bulletList')}
                            onClick={() => editor?.chain().focus().toggleBulletList().run()}
                        ><List size={16} /></button>
                        <button
                            type="button"
                            className={`${styles['toolbar-btn']}${editor?.isActive('orderedList') ? ` ${styles['toolbar-btn-active']}` : ''}`}
                            title={t('compose.orderedList')}
                            aria-label={t('compose.orderedList')}
                            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
                        ><ListOrdered size={16} /></button>
                        <button
                            type="button"
                            className={`${styles['toolbar-btn']}${editor?.isActive('link') ? ` ${styles['toolbar-btn-active']}` : ''}`}
                            title={t('compose.insertLink')}
                            aria-label={t('compose.insertLink')}
                            onClick={handleInsertLink}
                        ><Link size={16} /></button>
                        <button type="button" className={styles['toolbar-btn']} title={t('compose.attachFiles')} aria-label={t('compose.attachFiles')} onClick={handleAttachFiles}><Paperclip size={16} /></button>
                        <div style={{ position: 'relative' }}>
                            <button
                                type="button"
                                onClick={() => setShowTemplatePicker(!showTemplatePicker)}
                                aria-label={t('compose.insertTemplate')}
                                title={t('compose.insertTemplate')}
                                disabled={templates.length === 0}
                                className={styles['toolbar-btn']}
                            >
                                <FileText size={16} />
                            </button>
                            {showTemplatePicker && templates.length > 0 && (
                                <div className={styles['template-picker']}>
                                    {templates.map(tpl => (
                                        <button
                                            key={tpl.id}
                                            className={styles['template-option']}
                                            onClick={() => {
                                                editor?.chain().focus().insertContent(tpl.body_html).run();
                                                setShowTemplatePicker(false);
                                            }}
                                        >
                                            {tpl.name}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {attachments.length > 0 && (
                        <div className={styles['compose-attachments']}>
                            {attachments.map(att => (
                                <div key={att.id} className={styles['compose-attachment-chip']}>
                                    <Paperclip size={12} />
                                    <span className={styles['compose-att-name']}>{att.filename}</span>
                                    <span className={styles['compose-att-size']}>{formatFileSize(att.size)}</span>
                                    <button
                                        className={styles['compose-att-remove']}
                                        onClick={() => handleRemoveAttachment(att.id)}
                                        aria-label={t('compose.removeAttachment', { filename: att.filename })}
                                        title={t('compose.removeAttachment', { filename: att.filename })}
                                    >
                                        <X size={12} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className={styles['editor-area']}>
                        <EditorContent editor={editor} className={styles['tiptap-editor']} data-testid="compose-editor" />
                    </div>

                    {accountSignature && (
                        <div className={styles['signature-preview']}>
                            <hr className={styles['signature-divider']} />
                            <div
                                className={styles['signature-content']}
                                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(accountSignature) }}
                            />
                        </div>
                    )}

                    <div className={styles['compose-modal__footer']}>
                        {showSchedulePicker ? (
                            <div className={styles['schedule-picker-inline']}>
                                <DateTimePicker
                                    label={t('compose.scheduleLabel')}
                                    onSelect={handleScheduleSend}
                                    onCancel={() => setShowSchedulePicker(false)}
                                />
                            </div>
                        ) : (
                            <div className={styles['send-btn-group']}>
                                <button className={`${styles['send-btn']} ${styles['send-btn-main']}`} onClick={handleSend} disabled={sending}>
                                    <span>{sending ? t('compose.sending') : t('compose.send')}</span>
                                    <Send size={14} />
                                </button>
                                <DropdownMenu.Root>
                                    <DropdownMenu.Trigger asChild>
                                        <button className={`${styles['send-btn']} ${styles['send-btn-dropdown']}`} disabled={sending} aria-label={t('compose.sendOptions')}>
                                            <ChevronDown size={14} />
                                        </button>
                                    </DropdownMenu.Trigger>
                                    <DropdownMenu.Portal>
                                        <DropdownMenu.Content className="send-dropdown-content" side="top" align="end" sideOffset={4}>
                                            <DropdownMenu.Item className="send-dropdown-item" onSelect={handleSend}>
                                                <Send size={14} />
                                                <span>{t('compose.sendNow')}</span>
                                            </DropdownMenu.Item>
                                            <DropdownMenu.Item className="send-dropdown-item" onSelect={() => setShowSchedulePicker(true)}>
                                                <CalendarClock size={14} />
                                                <span>{t('compose.scheduleSend')}</span>
                                            </DropdownMenu.Item>
                                        </DropdownMenu.Content>
                                    </DropdownMenu.Portal>
                                </DropdownMenu.Root>
                            </div>
                        )}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>

        </Dialog.Root>
    );
};
