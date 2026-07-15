export const BROWSER_CLICKED_LINK_ROUTING_WORLD_ID = 1208

type BrowserClickedLinkRoutingState = {
  foregroundFrameName: string
  backgroundFrameName: string
  isMac: boolean
  listener: (event: MouseEvent) => void
}

type BrowserClickedLinkRoutingGlobal = typeof globalThis & {
  __orcaBrowserClickedLinkRouting?: BrowserClickedLinkRoutingState
}

/**
 * Re-expresses browser-native new-tab clicks with a private frame name so the
 * main process can distinguish them from opener-dependent window.open calls.
 */
export function installBrowserClickedLinkRouting(
  foregroundFrameName: string,
  backgroundFrameName: string,
  isMac: boolean
): void {
  const routingGlobal = globalThis as BrowserClickedLinkRoutingGlobal
  const existing = routingGlobal.__orcaBrowserClickedLinkRouting
  if (existing) {
    existing.foregroundFrameName = foregroundFrameName
    existing.backgroundFrameName = backgroundFrameName
    existing.isMac = isMac
    return
  }

  const state: BrowserClickedLinkRoutingState = {
    foregroundFrameName,
    backgroundFrameName,
    isMac,
    listener: () => {}
  }
  state.listener = (event) => {
    const primaryClick = event.type === 'click' && event.button === 0
    const middleClick = event.type === 'auxclick' && event.button === 1
    if (
      !(event instanceof MouseEvent) ||
      (!primaryClick && !middleClick) ||
      event.defaultPrevented ||
      event.altKey
    ) {
      return
    }

    const link = event
      .composedPath()
      .find(
        (target): target is Element =>
          target instanceof Element &&
          ((target.namespaceURI === 'http://www.w3.org/1999/xhtml' &&
            (target.localName === 'a' || target.localName === 'area')) ||
            (target.namespaceURI === 'http://www.w3.org/2000/svg' && target.localName === 'a'))
      )
    if (!link || link.hasAttribute('download')) {
      return
    }

    const modifierClick = state.isMac ? event.metaKey : event.ctrlKey
    // Shift alone is browser-native new-window intent; keep OAuth and other
    // opener-dependent window flows in Orca's guarded popup window.
    if (event.shiftKey && !modifierClick) {
      return
    }

    const baseTarget = document.querySelector('base[target]')?.getAttribute('target') ?? ''
    const ownTarget = link.getAttribute('target')
    const effectiveTarget = (ownTarget === null ? baseTarget : ownTarget).trim().toLowerCase()
    if (!middleClick && !modifierClick && effectiveTarget !== '_blank') {
      return
    }

    const rawHref =
      link.getAttribute('href') ?? link.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
    if (rawHref === null) {
      return
    }

    let targetUrl: URL
    try {
      targetUrl = new URL(rawHref, document.baseURI)
    } catch {
      return
    }
    if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
      return
    }

    // Why: Electron reports direct link clicks and featureless window.open()
    // with the same disposition. The private frame name preserves that one
    // distinction without weakening OAuth popups that need window.opener.
    event.preventDefault()
    const openInBackground = middleClick || (modifierClick && !event.shiftKey)
    window.open(
      targetUrl.toString(),
      openInBackground ? state.backgroundFrameName : state.foregroundFrameName
    )
  }
  routingGlobal.__orcaBrowserClickedLinkRouting = state

  // Why: page click handlers must get the first chance to cancel or rewrite a
  // link; capture-phase interception breaks SPA routing and analytics handlers.
  window.addEventListener('click', state.listener, false)
  window.addEventListener('auxclick', state.listener, false)
}

export function buildBrowserClickedLinkRoutingScript(
  foregroundFrameName: string,
  backgroundFrameName: string,
  isMac: boolean
): string {
  return `(${installBrowserClickedLinkRouting.toString()})(${JSON.stringify(foregroundFrameName)},${JSON.stringify(backgroundFrameName)},${JSON.stringify(isMac)});`
}
