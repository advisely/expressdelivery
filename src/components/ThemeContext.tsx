import React, { createContext, useContext, useEffect } from 'react';
import { useThemeStore } from '../stores/themeStore';
import type { LayoutMode } from '../stores/themeStore';

export type Layout = LayoutMode;

interface LayoutContextType {
    layout: Layout;
    setLayout: (l: Layout) => void;
}

const LayoutContext = createContext<LayoutContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { themeName, layout, setLayout, densityMode } = useThemeStore();

    useEffect(() => {
        const root = window.document.documentElement;
        root.classList.remove('theme-cream', 'theme-midnight', 'theme-forest');

        if (themeName !== 'light') {
            root.classList.add(`theme-${themeName}`);
        }

        root.classList.remove('layout-vertical', 'layout-horizontal');
        root.classList.add(`layout-${layout}`);

        root.classList.remove('density-compact', 'density-comfortable', 'density-relaxed');
        root.classList.add(`density-${densityMode}`);

    }, [themeName, layout, densityMode]);

    return (
        <LayoutContext.Provider value={{ layout, setLayout }}>
            {children}
        </LayoutContext.Provider>
    );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useLayout = () => {
    const context = useContext(LayoutContext);
    if (!context) throw new Error('useLayout must be used within ThemeProvider');
    return context;
};
