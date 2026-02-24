import { useEffect, useCallback } from 'react';

export interface ShortcutMap {
    [combo: string]: () => void;
}

/**
 * Global keyboard shortcut hook.
 *
 * Key format: 'mod+n', 'shift+r', 'delete', 'escape', 'j', 'k'
 * 'mod' = Ctrl on Win/Linux, Cmd on macOS
 *
 * Shortcuts are suppressed when focus is in input/textarea/contenteditable.
 * Escape is the sole exception — it fires even from focused input fields.
 *
 * When `enabled` is false, the listener is removed entirely — no shortcuts
 * fire at all, including Escape. Radix Dialog handles its own Escape natively.
 *
 * @param shortcuts Map of key combos to action callbacks
 * @param enabled Set false to disable all shortcuts (e.g. when a modal is open)
 */
export function useKeyboardShortcuts(shortcuts: ShortcutMap, enabled: boolean = true): void {
    const handler = useCallback((e: KeyboardEvent) => {
        const target = e.target as HTMLElement;
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) {
            // Only allow Escape to propagate from focused input fields
            if (e.key !== 'Escape') return;
        }

        const parts: string[] = [];
        if (e.ctrlKey || e.metaKey) parts.push('mod');
        if (e.shiftKey) parts.push('shift');
        if (e.altKey) parts.push('alt');
        parts.push(e.key.toLowerCase());
        const combo = parts.join('+');

        const action = shortcuts[combo];
        if (action) {
            e.preventDefault();
            e.stopPropagation();
            action();
        }
    }, [shortcuts]);

    useEffect(() => {
        if (!enabled) return;
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [handler, enabled]);
}
