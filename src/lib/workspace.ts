export type PaneId = 'primary' | 'secondary'
export type PaneMode = 'single' | 'split'
export type JsonStatus = 'empty' | 'valid' | 'invalid'

export interface JsonValidation {
  status: JsonStatus
  message: string | null
  line: number | null
  column: number | null
}

export interface JsonTab {
  id: string
  title: string
  content: string
  validation: JsonValidation
  updatedAt: number
  lastOpenedAt: number
}

export interface WorkspacePane {
  tabId: string
}

export interface WorkspaceState {
  version: number
  nextTabNumber: number
  paneMode: PaneMode
  activePane: PaneId
  panes: Record<PaneId, WorkspacePane>
  tabs: JsonTab[]
}

export const WORKSPACE_VERSION = 1
export const STORAGE_KEY = `json-editor.workspace.v${WORKSPACE_VERSION}`
export const PANE_IDS: PaneId[] = ['primary', 'secondary']

const STARTER_DOCUMENT = `{
  "project": "json-editor",
  "owner": "workspace",
  "features": ["tabs", "split view", "local storage"]
}`

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `tab-${Math.random().toString(36).slice(2, 10)}`
}

function toNumber(value: unknown, fallback = Date.now()) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeTitle(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function lineColumnFromPosition(content: string, position: number) {
  const safePosition = Math.max(0, Math.min(position, content.length))
  const preceding = content.slice(0, safePosition)
  const lines = preceding.split('\n')

  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  }
}

export function validateJson(content: string): JsonValidation {
  if (!content.trim()) {
    return {
      status: 'empty',
      message: 'Start typing an object or array.',
      line: null,
      column: null,
    }
  }

  try {
    JSON.parse(content)

    return {
      status: 'valid',
      message: 'Valid JSON',
      line: null,
      column: null,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON'
    const lineColumnMatch = message.match(/line (\d+) column (\d+)/i)

    if (lineColumnMatch) {
      return {
        status: 'invalid',
        message,
        line: Number(lineColumnMatch[1]),
        column: Number(lineColumnMatch[2]),
      }
    }

    const positionMatch = message.match(/position (\d+)/i)
    if (positionMatch) {
      const location = lineColumnFromPosition(content, Number(positionMatch[1]))

      return {
        status: 'invalid',
        message,
        line: location.line,
        column: location.column,
      }
    }

    return {
      status: 'invalid',
      message,
      line: null,
      column: null,
    }
  }
}

export function createTab(title: string, content = ''): JsonTab {
  const now = Date.now()

  return {
    id: createId(),
    title: title.trim() || 'Untitled',
    content,
    validation: validateJson(content),
    updatedAt: now,
    lastOpenedAt: now,
  }
}

export function createInitialWorkspace(): WorkspaceState {
  const tab = createTab('Untitled 1', STARTER_DOCUMENT)

  return {
    version: WORKSPACE_VERSION,
    nextTabNumber: 2,
    paneMode: 'single',
    activePane: 'primary',
    panes: {
      primary: { tabId: tab.id },
      secondary: { tabId: tab.id },
    },
    tabs: [tab],
  }
}

export function createBlankWorkspace(): WorkspaceState {
  const tab = createTab('Untitled 1', '')

  return {
    version: WORKSPACE_VERSION,
    nextTabNumber: 2,
    paneMode: 'single',
    activePane: 'primary',
    panes: {
      primary: { tabId: tab.id },
      secondary: { tabId: tab.id },
    },
    tabs: [tab],
  }
}

function sanitizeTab(input: unknown, index: number): JsonTab | null {
  if (!input || typeof input !== 'object') {
    return null
  }

  const candidate = input as Partial<JsonTab>
  const title = normalizeTitle(candidate.title, `Untitled ${index + 1}`)
  const content = typeof candidate.content === 'string' ? candidate.content : ''

  return {
    id: typeof candidate.id === 'string' && candidate.id ? candidate.id : createId(),
    title,
    content,
    validation: validateJson(content),
    updatedAt: toNumber(candidate.updatedAt),
    lastOpenedAt: toNumber(candidate.lastOpenedAt),
  }
}

export function loadWorkspace(): WorkspaceState {
  if (typeof window === 'undefined') {
    return createInitialWorkspace()
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return createInitialWorkspace()
    }

    const parsed = JSON.parse(raw) as Partial<WorkspaceState>
    if (parsed.version !== WORKSPACE_VERSION) {
      return createInitialWorkspace()
    }

    const tabs = Array.isArray(parsed.tabs)
      ? parsed.tabs
          .map((tab, index) => sanitizeTab(tab, index))
          .filter((tab): tab is JsonTab => Boolean(tab))
      : []

    if (!tabs.length) {
      return createInitialWorkspace()
    }

    const availableIds = new Set(tabs.map((tab) => tab.id))
    const primaryTabId =
      parsed.panes?.primary?.tabId && availableIds.has(parsed.panes.primary.tabId)
        ? parsed.panes.primary.tabId
        : tabs[0].id
    const secondaryTabId =
      parsed.panes?.secondary?.tabId && availableIds.has(parsed.panes.secondary.tabId)
        ? parsed.panes.secondary.tabId
        : primaryTabId

    return {
      version: WORKSPACE_VERSION,
      nextTabNumber:
        typeof parsed.nextTabNumber === 'number' && parsed.nextTabNumber > 1
          ? Math.floor(parsed.nextTabNumber)
          : tabs.length + 1,
      paneMode: parsed.paneMode === 'split' ? 'split' : 'single',
      activePane: parsed.activePane === 'secondary' ? 'secondary' : 'primary',
      panes: {
        primary: { tabId: primaryTabId },
        secondary: { tabId: secondaryTabId },
      },
      tabs,
    }
  } catch {
    return createInitialWorkspace()
  }
}
