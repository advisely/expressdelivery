import { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { ThreadList } from './components/ThreadList';
import { ReadingPane } from './components/ReadingPane';
import { ComposeModal } from './components/ComposeModal';
import './index.css';

import { SettingsModal } from './components/SettingsModal';

function App() {
  const [isComposing, setIsComposing] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  return (
    <div className="app-container">
      <Sidebar
        onCompose={() => setIsComposing(true)}
        onSettings={() => setIsSettingsOpen(true)}
      />
      <div className="main-content">
        <ThreadList />
        <ReadingPane />
      </div>

      {isComposing && (
        <ComposeModal onClose={() => setIsComposing(false)} />
      )}

      {isSettingsOpen && (
        <SettingsModal onClose={() => setIsSettingsOpen(false)} />
      )}
    </div>
  );
}

export default App;
