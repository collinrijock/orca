import type { TuiAgent } from '../../../shared/types'
import grokUrl from '../../../../resources/agent-icons/grok.png?url'
import mimoCodeUrl from '../../../../resources/agent-icons/mimo-code.png?url'
import anteUrl from '../../../../resources/agent-icons/ante.png?url'
import geminiUrl from '../../../../resources/agent-icons/gemini.png?url'
import antigravityUrl from '../../../../resources/agent-icons/antigravity.png?url'
import gooseUrl from '../../../../resources/agent-icons/goose.png?url'
import ampUrl from '../../../../resources/agent-icons/amp.png?url'
import kiroUrl from '../../../../resources/agent-icons/kiro.png?url'
import crushUrl from '../../../../resources/agent-icons/crush.png?url'
import augUrl from '../../../../resources/agent-icons/aug.png?url'
import autohandUrl from '../../../../resources/agent-icons/autohand.png?url'
import clineUrl from '../../../../resources/agent-icons/cline.png?url'
import codebuffUrl from '../../../../resources/agent-icons/codebuff.png?url'
import commandCodeUrl from '../../../../resources/agent-icons/command-code.png?url'
import continueUrl from '../../../../resources/agent-icons/continue.png?url'
import cursorUrl from '../../../../resources/agent-icons/cursor.png?url'
import kimiUrl from '../../../../resources/agent-icons/kimi.png?url'
import mistralVibeUrl from '../../../../resources/agent-icons/mistral-vibe.png?url'
import qwenCodeUrl from '../../../../resources/agent-icons/qwen-code.png?url'
import rovoUrl from '../../../../resources/agent-icons/rovo.png?url'
import hermesUrl from '../../../../resources/agent-icons/hermes.png?url'
import devinUrl from '../../../../resources/agent-icons/devin.png?url'
import openclawUrl from '../../../../resources/agent-icons/openclaw.png?url'

// Why: these agents have no hand-authored SVG glyph, so previously their icons
// loaded live from Google's favicon service. That service is unreachable in some
// regions (e.g. mainland China) and offline, leaving broken images across the
// agent settings page, tab title bar, and status bar (#8451). Bundle the favicon
// PNGs at build time so the icons render without any network dependency.
export const AGENT_FAVICON_ASSETS: Partial<Record<TuiAgent, string>> = {
  grok: grokUrl,
  'mimo-code': mimoCodeUrl,
  ante: anteUrl,
  gemini: geminiUrl,
  antigravity: antigravityUrl,
  goose: gooseUrl,
  amp: ampUrl,
  kiro: kiroUrl,
  crush: crushUrl,
  aug: augUrl,
  autohand: autohandUrl,
  cline: clineUrl,
  codebuff: codebuffUrl,
  'command-code': commandCodeUrl,
  continue: continueUrl,
  cursor: cursorUrl,
  kimi: kimiUrl,
  'mistral-vibe': mistralVibeUrl,
  'qwen-code': qwenCodeUrl,
  rovo: rovoUrl,
  hermes: hermesUrl,
  devin: devinUrl,
  openclaw: openclawUrl
}
