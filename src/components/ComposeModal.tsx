import React from 'react';
import { X, Send, Paperclip, Image, Type } from 'lucide-react';

interface ComposeModalProps {
    onClose: () => void;
}

export const ComposeModal: React.FC<ComposeModalProps> = ({ onClose }) => {
    return (
        <div className="modal-overlay animate-fade-in">
            <div className="compose-modal glass">
                <div className="modal-header">
                    <span className="modal-title">New Message</span>
                    <button className="icon-btn" onClick={onClose}><X size={18} /></button>
                </div>

                <div className="compose-fields">
                    <div className="field-row">
                        <span className="field-label">To:</span>
                        <input type="text" className="compose-input" placeholder="Recipient..." />
                    </div>
                    <div className="field-row">
                        <span className="field-label">Subject:</span>
                        <input type="text" className="compose-input" placeholder="Subject..." />
                    </div>
                </div>

                <div className="toolbar">
                    <button className="toolbar-btn" title="Formatting"><Type size={16} /></button>
                    <button className="toolbar-btn" title="Insert Link"><Image size={16} /></button>
                    <button className="toolbar-btn" title="Attach Files"><Paperclip size={16} /></button>
                </div>

                <div className="editor-area">
                    <textarea
                        className="rich-text-stub"
                        placeholder="Write your beautiful email here..."
                    ></textarea>
                </div>

                <div className="modal-footer">
                    <button className="send-btn">
                        <span>Send</span>
                        <Send size={14} className="send-icon" />
                    </button>
                </div>
            </div>

            <style>{`
        .modal-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          backdrop-filter: blur(4px);
        }

        .compose-modal {
          width: 600px;
          height: 500px;
          border-radius: 12px;
          display: flex;
          flex-direction: column;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
          border: 1px solid var(--glass-border);
          overflow: hidden;
        }

        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          background: rgba(0, 0, 0, 0.2);
          border-bottom: 1px solid var(--glass-border);
        }

        .modal-title {
          font-weight: 600;
          font-size: 14px;
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

        .toolbar {
          display: flex;
          gap: 4px;
          padding: 8px 16px;
          border-bottom: 1px solid var(--glass-border);
          background: rgba(0, 0, 0, 0.1);
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
          background: rgba(255, 255, 255, 0.1);
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

        .modal-footer {
          padding: 12px 16px;
          display: flex;
          justify-content: flex-end;
          border-top: 1px solid var(--glass-border);
          background: rgba(0, 0, 0, 0.2);
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
      `}</style>
        </div>
    );
};
