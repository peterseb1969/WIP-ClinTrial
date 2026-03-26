import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { WipProvider } from '@wip/react'
import { wipClient } from '@/lib/wip'
import { config } from '@/lib/config'
import { Layout } from '@/components/Layout'
import { DashboardPage } from '@/pages/DashboardPage'
import { TrialsPage } from '@/pages/TrialsPage'
import { TrialDetailPage } from '@/pages/TrialDetailPage'
import { MoleculesPage } from '@/pages/MoleculesPage'
import { SitesPage } from '@/pages/SitesPage'
import { BookmarksPage } from '@/pages/BookmarksPage'
import { TherapeuticAreasPage } from '@/pages/TherapeuticAreasPage'
import { SyncPage } from '@/pages/SyncPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WipProvider client={wipClient}>
        <BrowserRouter basename={config.basePath}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<DashboardPage />} />
              <Route path="trials" element={<TrialsPage />} />
              <Route path="trials/:nctId" element={<TrialDetailPage />} />
              <Route path="molecules" element={<MoleculesPage />} />
              <Route path="therapeutic-areas" element={<TherapeuticAreasPage />} />
              <Route path="sites" element={<SitesPage />} />
              <Route path="bookmarks" element={<BookmarksPage />} />
              <Route path="sync" element={<SyncPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </WipProvider>
    </QueryClientProvider>
  )
}
