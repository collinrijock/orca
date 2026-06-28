import '../assets/main.css'

import { Suspense, useMemo, useState } from 'react'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import ReactDOM from 'react-dom/client'
import { useTranslation } from 'react-i18next'
import WebConnect from './WebConnect'
import { RecoverableRenderErrorBoundary } from '../components/error-boundaries/RecoverableRenderErrorBoundary'
import {
  clearPairingInputFromAddressBar,
  parseWebPairingInput,
  readPairingInputFromLocation
} from './web-pairing'
import { readStoredWebRuntimeEnvironment } from './web-runtime-environment'
import { installWebPreloadApi } from './web-preload-api'
import { I18nProvider } from '../i18n/I18nProvider'
import { translate } from '../i18n/i18n'

const App = lazy(() => import('../App'))

function WebRoot(): React.JSX.Element {
  const initialPairingInput = useMemo(() => readPairingInputFromLocation(window.location), [])
  // Why: a freshly-parsed offer must be probed by WebConnect (status.get) before
  // entering the app — auto-saving here would let a mobile-scope token through
  // and silently render empty workspaces. Clear the secret-bearing URL now; the
  // offer is handed to WebConnect via initialPairingInput. Stored environments
  // were already scope-checked at connect time, so they keep the fast path.
  const freshPairingInput = useMemo(() => {
    const offer = initialPairingInput ? parseWebPairingInput(initialPairingInput) : null
    if (!offer) {
      return null
    }
    clearPairingInputFromAddressBar()
    return initialPairingInput
  }, [initialPairingInput])
  const [hasEnvironment, setHasEnvironment] = useState(
    () => freshPairingInput === null && readStoredWebRuntimeEnvironment() !== null
  )

  if (!hasEnvironment) {
    return (
      <WebConnect
        initialPairingInput={freshPairingInput}
        onConnected={() => setHasEnvironment(true)}
      />
    )
  }

  installWebPreloadApi()
  return (
    <Suspense fallback={<div className="min-h-dvh bg-background" />}>
      <App />
    </Suspense>
  )
}

function WebRootBoundary(): React.JSX.Element {
  useTranslation()
  return (
    <RecoverableRenderErrorBoundary
      boundaryId="web.root"
      surface="web-root"
      title={translate('app.recoverableError.webTitle', 'Orca web hit a renderer error.')}
      description={translate(
        'app.recoverableError.webDescription',
        'Retry the web client or reconnect to the paired runtime.'
      )}
    >
      <WebRoot />
    </RecoverableRenderErrorBoundary>
  )
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <I18nProvider>
    <WebRootBoundary />
  </I18nProvider>
)
