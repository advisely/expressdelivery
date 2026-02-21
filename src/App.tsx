import { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { ThreadList } from './components/ThreadList';
import { ReadingPane } from './components/ReadingPane';
import { ComposeModal } from './components/ComposeModal';
import './index.css';

function App() {
  const [isComposing, setIsComposing] = useState(false);

  return (
    <>
      <Sidebar onCompose={() => setIsComposing(true)} />
      <ThreadList />
      <ReadingPane />

      {isComposing && (
        <ComposeModal onClose={() => setIsComposing(false)} />
      )}
    </>
  );
}

export default App;
