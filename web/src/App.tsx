import { useRoute } from './router';
import { Overview } from './pages/Overview';
import { Runs } from './pages/Runs';
import { RunDetailPage } from './pages/RunDetail';
import { Rules } from './pages/Rules';
import { EmptyState } from './components';

export function App() {
  const route = useRoute();
  const current = (page: string) => (route.page === page || (page === 'runs' && route.page === 'run') ? 'current' : '');

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <a href="#/" className="brand">
            Configuration Consistency
          </a>
          <nav>
            <a href="#/" className={current('overview')}>Overview</a>
            <a href="#/runs" className={current('runs')}>Runs</a>
            <a href="#/rules" className={current('rules')}>Rules</a>
          </nav>
        </div>
      </header>
      <main className="page">
        {route.page === 'overview' && <Overview />}
        {route.page === 'runs' && <Runs />}
        {route.page === 'run' && <RunDetailPage id={route.id} />}
        {route.page === 'rules' && <Rules />}
        {route.page === 'not-found' && (
          <EmptyState title={`There is no page at ${route.path}`}>
            <a href="#/">Back to the overview</a>
          </EmptyState>
        )}
      </main>
    </>
  );
}
