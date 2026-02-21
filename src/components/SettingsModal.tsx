import React from 'react';
import { X, Layout, Monitor, Moon, Sun, MonitorPlay, Droplets } from 'lucide-react';
import { useLayout, Layout as LayoutType } from './ThemeContext';
import { useThemeStore, THEMES, ThemeName } from '../stores/themeStore';

interface SettingsModalProps {
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
  const { layout, setLayout } = useLayout();
  const { themeName, setTheme } = useThemeStore();

  const getIconForTheme = (name: ThemeName) => {
    switch (name) {
      case 'light': return Sun;
      case 'cream': return Sun;
      case 'midnight': return Moon;
      case 'forest': return Droplets;
      default: return MonitorPlay;
    }
  };

  const layouts: { id: LayoutType; label: string; icon: React.ElementType }[] = [
    { id: 'vertical', label: 'Vertical Split (3-Pane)', icon: Layout },
    { id: 'horizontal', label: 'Horizontal Split', icon: Monitor }
  ];

  return (
    <div className="modal-overlay">
      <div className="settings-modal glass animate-fade-in">
        <div className="modal-header">
          <h2>Appearance Settings</h2>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="settings-content">
          <div className="setting-group">
            <h3>Interface Theme</h3>
            <div className="options-grid">
              {THEMES.map(t => {
                const Icon = getIconForTheme(t.name);
                return (
                  <button
                    key={t.name}
                    className={`option-btn ${themeName === t.name ? 'active' : ''}`}
                    onClick={() => setTheme(t.name)}
                  >
                    <Icon size={18} />
                    <span>{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="setting-group">
            <h3>Pane Layout</h3>
            <div className="options-grid">
              {layouts.map(l => (
                <button
                  key={l.id}
                  className={`option-btn ${layout === l.id ? 'active' : ''}`}
                  onClick={() => setLayout(l.id)}
                >
                  <l.icon size={18} />
                  <span>{l.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          backdrop-filter: blur(4px);
        }

        .settings-modal {
          width: 500px;
          border-radius: 12px;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          border-bottom: 1px solid var(--glass-border);
        }

        .modal-header h2 {
          font-size: 18px;
          font-weight: 500;
        }

        .close-btn {
          color: var(--text-secondary);
          padding: 4px;
          border-radius: 4px;
        }

        .close-btn:hover {
          background: rgba(255, 255, 255, 0.1);
          color: var(--text-primary);
        }

        .settings-content {
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .setting-group h3 {
          font-size: 14px;
          font-weight: 500;
          color: var(--text-secondary);
          margin-bottom: 12px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .options-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 12px;
        }

        .option-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          padding: 16px;
          border-radius: 8px;
          border: 1px solid var(--glass-border);
          background: rgba(0, 0, 0, 0.2);
          color: var(--text-secondary);
        }

        .option-btn:hover {
          background: rgba(255, 255, 255, 0.05);
          color: var(--text-primary);
        }

        .option-btn.active {
          background: rgba(59, 130, 246, 0.15);
          border-color: var(--accent-color);
          color: var(--accent-color);
        }
      `}</style>
    </div>
  );
};
