import React, { createContext, useContext, useState, useEffect } from 'react';

export type Theme = 'system' | 'dark' | 'light' | 'midnight' | 'ocean';
export type Layout = 'vertical' | 'horizontal';

interface ThemeContextType {
    theme: Theme;
    layout: Layout;
    setTheme: (t: Theme) => void;
    setLayout: (l: Layout) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [theme, setTheme] = useState<Theme>('dark');
    const [layout, setLayout] = useState<Layout>('vertical');

    useEffect(() => {
        const root = window.document.documentElement;
        root.classList.remove('theme-dark', 'theme-light', 'theme-midnight', 'theme-ocean');

        if (theme === 'system') {
            const systemTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'theme-light' : 'theme-dark';
            root.classList.add(systemTheme);
        } else {
            root.classList.add(`theme-${theme}`);
        }

        // Apply layout class
        root.classList.remove('layout-vertical', 'layout-horizontal');
        root.classList.add(`layout-${layout}`);

    }, [theme, layout]);

    return (
        <ThemeContext.Provider value={{ theme, layout, setTheme, setLayout }}>
            {children}
        </ThemeContext.Provider>
    );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useTheme = () => {
    const context = useContext(ThemeContext);
    if (!context) throw new Error('useTheme must be used within ThemeProvider');
    return context;
};
