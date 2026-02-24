import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardShortcuts, type ShortcutMap } from './useKeyboardShortcuts';

function dispatchKey(key: string, options: Partial<KeyboardEventInit> = {}, target?: HTMLElement) {
    const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...options,
    });
    (target ?? window).dispatchEvent(event);
    return event;
}

describe('useKeyboardShortcuts', () => {
    let handler: (() => void) & ReturnType<typeof vi.fn>;

    beforeEach(() => {
        handler = vi.fn() as (() => void) & ReturnType<typeof vi.fn>;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('fires handler when matching key is pressed', () => {
        renderHook(() => useKeyboardShortcuts({ 'j': handler }));
        dispatchKey('j');
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('fires handler for mod+key combo (ctrlKey)', () => {
        renderHook(() => useKeyboardShortcuts({ 'mod+n': handler }));
        dispatchKey('n', { ctrlKey: true });
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('fires handler for mod+key combo (metaKey)', () => {
        renderHook(() => useKeyboardShortcuts({ 'mod+n': handler }));
        dispatchKey('n', { metaKey: true });
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('does not fire handler when typing in input element', () => {
        renderHook(() => useKeyboardShortcuts({ 'j': handler }));
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();
        dispatchKey('j', {}, input);
        expect(handler).not.toHaveBeenCalled();
        document.body.removeChild(input);
    });

    it('does not fire handler when typing in textarea element', () => {
        renderHook(() => useKeyboardShortcuts({ 'j': handler }));
        const textarea = document.createElement('textarea');
        document.body.appendChild(textarea);
        textarea.focus();
        dispatchKey('j', {}, textarea);
        expect(handler).not.toHaveBeenCalled();
        document.body.removeChild(textarea);
    });

    it('allows Escape even when focus is in input', () => {
        renderHook(() => useKeyboardShortcuts({ 'escape': handler }));
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();
        dispatchKey('Escape', {}, input);
        expect(handler).toHaveBeenCalledTimes(1);
        document.body.removeChild(input);
    });

    it('does not fire handler when disabled', () => {
        renderHook(() => useKeyboardShortcuts({ 'j': handler }, false));
        dispatchKey('j');
        expect(handler).not.toHaveBeenCalled();
    });

    it('does not fire handler for non-matching key', () => {
        renderHook(() => useKeyboardShortcuts({ 'j': handler }));
        dispatchKey('k');
        expect(handler).not.toHaveBeenCalled();
    });

    it('cleans up listener on unmount', () => {
        const { unmount } = renderHook(() => useKeyboardShortcuts({ 'j': handler }));
        unmount();
        dispatchKey('j');
        expect(handler).not.toHaveBeenCalled();
    });

    it('fires handler for shift+key combo', () => {
        renderHook(() => useKeyboardShortcuts({ 'shift+r': handler }));
        dispatchKey('r', { shiftKey: true });
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('does not fire shift+key when shift is not pressed', () => {
        renderHook(() => useKeyboardShortcuts({ 'shift+r': handler }));
        dispatchKey('r');
        expect(handler).not.toHaveBeenCalled();
    });

    it('does not fire plain key when ctrl modifier is held', () => {
        renderHook(() => useKeyboardShortcuts({ 'j': handler }));
        dispatchKey('j', { ctrlKey: true });
        expect(handler).not.toHaveBeenCalled();
    });

    it('matches keys case-insensitively (uppercase key event)', () => {
        renderHook(() => useKeyboardShortcuts({ 'j': handler }));
        // Key values from the event are lowercased by the hook
        dispatchKey('J');
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('dispatches only the matched handler among multiple shortcuts', () => {
        const handlerK = vi.fn();
        renderHook(() => useKeyboardShortcuts({ 'j': handler, 'k': handlerK }));
        dispatchKey('j');
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handlerK).not.toHaveBeenCalled();
    });

    it('allows Escape even when focus is in contenteditable element', () => {
        renderHook(() => useKeyboardShortcuts({ 'escape': handler }));
        const div = document.createElement('div');
        // jsdom does not implement isContentEditable, so stub it explicitly.
        Object.defineProperty(div, 'isContentEditable', { get: () => true, configurable: true });
        document.body.appendChild(div);
        div.focus();
        dispatchKey('Escape', {}, div);
        expect(handler).toHaveBeenCalledTimes(1);
        document.body.removeChild(div);
    });

    it('does not fire non-Escape shortcut when focus is in contenteditable element', () => {
        renderHook(() => useKeyboardShortcuts({ 'j': handler }));
        const div = document.createElement('div');
        // jsdom does not implement isContentEditable, so stub it explicitly
        // to simulate the real browser behaviour tested by the hook.
        Object.defineProperty(div, 'isContentEditable', { get: () => true, configurable: true });
        document.body.appendChild(div);
        div.focus();
        dispatchKey('j', {}, div);
        expect(handler).not.toHaveBeenCalled();
        document.body.removeChild(div);
    });

    it('re-registers listener when shortcuts map reference changes', () => {
        const handlerV2 = vi.fn() as (() => void) & ReturnType<typeof vi.fn>;
        const { rerender } = renderHook(
            ({ map }: { map: ShortcutMap }) => useKeyboardShortcuts(map),
            { initialProps: { map: { 'j': handler } as ShortcutMap } }
        );
        dispatchKey('j');
        expect(handler).toHaveBeenCalledTimes(1);

        rerender({ map: { 'k': handlerV2 } as ShortcutMap });
        dispatchKey('k');
        expect(handlerV2).toHaveBeenCalledTimes(1);

        // The original 'j' binding must no longer be active
        dispatchKey('j');
        expect(handler).toHaveBeenCalledTimes(1); // still just once
    });

    it('registers listener again when enabled transitions from false to true', () => {
        const { rerender } = renderHook(
            ({ enabled }: { enabled: boolean }) => useKeyboardShortcuts({ 'j': handler } as ShortcutMap, enabled),
            { initialProps: { enabled: false } }
        );
        dispatchKey('j');
        expect(handler).not.toHaveBeenCalled();

        rerender({ enabled: true });
        dispatchKey('j');
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('handles Delete key shortcut', () => {
        renderHook(() => useKeyboardShortcuts({ 'delete': handler }));
        dispatchKey('Delete');
        expect(handler).toHaveBeenCalledTimes(1);
    });
});
