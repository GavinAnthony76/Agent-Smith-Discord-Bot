import { type ReactNode, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { GuildPage, ServerSelector } from '@/pages/dashboard';
import { Docs, Landing, LoginPage, Premium, Privacy, Status, Terms } from '@/pages/public';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

function Router() {
  return (
    <RoutedErrorBoundary>
      <PageMetadata />
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/login" component={LoginPage} />
        <Route path="/premium" component={Premium} />
        <Route path="/docs" component={Docs} />
        <Route path="/status" component={Status} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/terms" component={Terms} />
        <Route path="/dashboard" component={ServerSelector} />
        <Route path="/dashboard/:guildId/:page">
          {(p) => <GuildPage guildId={p.guildId} page={p.page} />}
        </Route>
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function PageMetadata() {
  const [location] = useLocation();
  useEffect(() => {
    const segment = location.split('/').filter(Boolean).at(-1) ?? 'home';
    const label = segment === 'home' ? 'Private Testing Preview' :
      segment.replace(/-/g, ' ').replace(/\b\w/g, value => value.toUpperCase());
    const title = `${label} | Agent Smith`;
    const description = location.startsWith('/dashboard') ?
      'Permission-scoped Discord server administration. Sign-in required; unconnected modules are marked as drafts.' :
      `Agent Smith ${label.toLowerCase()}: a guarded Discord operations platform in private testing, with billing disabled.`;
    document.title = title;
    for (const [attribute, key, content] of [
      ['name', 'description', description], ['property', 'og:title', title],
      ['property', 'og:description', description], ['property', 'og:type', 'website'],
    ]) {
      let tag = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
      if (!tag) { tag = document.createElement('meta'); tag.setAttribute(attribute, key); document.head.appendChild(tag); }
      tag.content = content;
    }
    let robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!robots) { robots = document.createElement('meta'); robots.name = 'robots'; document.head.appendChild(robots); }
    // No public indexing until the required two-guild acceptance is complete.
    robots.content = 'noindex, nofollow';
  }, [location]);
  return null;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
