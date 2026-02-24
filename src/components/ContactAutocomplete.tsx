import { useState, useEffect, useRef, useCallback, type FC } from 'react';
import { ipcInvoke } from '../lib/ipc';

interface Contact {
    id: string;
    email: string;
    name: string | null;
}

interface ContactAutocompleteProps {
    id: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
}

export const ContactAutocomplete: FC<ContactAutocompleteProps> = ({
    id,
    value,
    onChange,
    placeholder,
    className,
}) => {
    const [suggestions, setSuggestions] = useState<Contact[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [highlightIndex, setHighlightIndex] = useState(-1);
    const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const listboxId = `${id}-listbox`;

    // Get the text after the last comma for search query
    const getSearchTerm = useCallback(() => {
        const parts = value.split(',');
        return (parts[parts.length - 1] ?? '').trim();
    }, [value]);

    // Debounced search
    useEffect(() => {
        const term = getSearchTerm();

        if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

        searchTimerRef.current = setTimeout(async () => {
            if (term.length < 2) {
                setSuggestions([]);
                setShowSuggestions(false);
                return;
            }
            const results = await ipcInvoke<Contact[]>('contacts:search', term);
            if (results && results.length > 0) {
                setSuggestions(results);
                setShowSuggestions(true);
                setHighlightIndex(-1);
            } else {
                setSuggestions([]);
                setShowSuggestions(false);
            }
        }, 200);

        return () => {
            if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
        };
    }, [value, getSearchTerm]);

    // Close on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setShowSuggestions(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const selectSuggestion = useCallback((contact: Contact) => {
        const parts = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
        // Replace the last (incomplete) part with the selected contact
        if (parts.length > 0) {
            parts[parts.length - 1] = contact.name
                ? `${contact.name} <${contact.email}>`
                : contact.email;
        } else {
            parts.push(contact.name
                ? `${contact.name} <${contact.email}>`
                : contact.email);
        }
        onChange(parts.join(', ') + ', ');
        setShowSuggestions(false);
        setSuggestions([]);
        setHighlightIndex(-1);
    }, [value, onChange]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!showSuggestions || suggestions.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlightIndex(prev => Math.min(prev + 1, suggestions.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlightIndex(prev => Math.max(prev - 1, 0));
        } else if (e.key === 'Enter' && highlightIndex >= 0) {
            e.preventDefault();
            selectSuggestion(suggestions[highlightIndex]);
        } else if (e.key === 'Escape') {
            setShowSuggestions(false);
        }
    };

    return (
        <div ref={wrapperRef} className="contact-autocomplete-wrapper" style={{ position: 'relative', flex: 1 }}>
            <input
                id={id}
                type="text"
                className={className}
                placeholder={placeholder}
                value={value}
                onChange={e => onChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => {
                    if (suggestions.length > 0) setShowSuggestions(true);
                }}
                role="combobox"
                aria-expanded={showSuggestions}
                aria-controls={listboxId}
                aria-activedescendant={highlightIndex >= 0 ? `${id}-option-${highlightIndex}` : undefined}
                aria-autocomplete="list"
                aria-haspopup="listbox"
                autoComplete="off"
            />
            {showSuggestions && suggestions.length > 0 && (
                <ul
                    id={listboxId}
                    role="listbox"
                    className="contact-suggestions"
                    aria-label="Contact suggestions"
                >
                    {suggestions.map((contact, index) => (
                        <li
                            key={contact.id}
                            id={`${id}-option-${index}`}
                            role="option"
                            aria-selected={highlightIndex === index}
                            className={`contact-suggestion-item${highlightIndex === index ? ' highlighted' : ''}`}
                            onMouseDown={(e) => {
                                e.preventDefault(); // Prevent blur
                                selectSuggestion(contact);
                            }}
                            onMouseEnter={() => setHighlightIndex(index)}
                        >
                            <span className="contact-suggestion-name">
                                {contact.name ?? contact.email}
                            </span>
                            {contact.name && (
                                <span className="contact-suggestion-email">
                                    {contact.email}
                                </span>
                            )}
                        </li>
                    ))}
                </ul>
            )}
            <style>{`
                .contact-suggestions {
                    position: absolute;
                    top: 100%;
                    left: 0;
                    right: 0;
                    z-index: 50;
                    background: rgb(var(--color-bg-elevated));
                    border: 1px solid var(--glass-border);
                    border-radius: 8px;
                    padding: 4px;
                    margin-top: 2px;
                    box-shadow: 0 10px 25px rgba(0,0,0,0.15);
                    list-style: none;
                    max-height: 200px;
                    overflow-y: auto;
                }

                .contact-suggestion-item {
                    display: flex;
                    flex-direction: column;
                    gap: 1px;
                    padding: 8px 10px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 13px;
                }

                .contact-suggestion-item:hover,
                .contact-suggestion-item.highlighted {
                    background: var(--hover-bg);
                }

                .contact-suggestion-name {
                    color: var(--text-primary);
                    font-weight: 500;
                }

                .contact-suggestion-email {
                    color: var(--text-secondary);
                    font-size: 12px;
                }
            `}</style>
        </div>
    );
};
