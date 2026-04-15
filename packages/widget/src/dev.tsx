import { createRoot } from 'react-dom/client';
import { KoeWidget } from './components/KoeWidget';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

createRoot(container).render(
  <KoeWidget
    projectKey="dev-project"
    apiUrl="http://localhost:8787"
    user={{ id: 'dev-user', name: 'Dev User', email: 'dev@example.com' }}
    theme={{ accentColor: '#4f46e5', mode: 'auto' }}
    defaultOpen
  />,
);
