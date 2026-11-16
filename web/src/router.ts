// A small hash router: the page is chosen by the part of the URL after "#".
//   #/            Overview
//   #/runs        Runs
//   #/runs/12     Run detail
//   #/rules       Rules
// Hash links work without any server configuration, which keeps the dashboard a plain
// set of static files behind the Vite dev server.

import { useEffect, useState } from 'react';

export type Route =
  | { page: 'overview' }
  | { page: 'runs' }
  | { page: 'run'; id: number }
  | { page: 'rules' }
  | { page: 'not-found'; path: string };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/';
  if (path === '/') return { page: 'overview' };
  if (path === '/runs') return { page: 'runs' };
  if (path === '/rules') return { page: 'rules' };
  const run = /^\/runs\/(\d+)$/.exec(path);
  if (run) return { page: 'run', id: Number(run[1]) };
  return { page: 'not-found', path };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(path: string) {
  window.location.hash = path;
}
