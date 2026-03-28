import { For, Show, batch, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import {
  PANE_IDS,
  STORAGE_KEY,
  type JsonStatus,
  type JsonTab,
  type PaneId,
  createBlankWorkspace,
  createTab,
  loadWorkspace,
  validateJson,
} from './lib/workspace'
import './App.css'

type SaveState = 'saved' | 'saving' | 'error'
type NoticeTone = 'info' | 'success' | 'error'

interface NoticeState {
  tone: NoticeTone
  message: string
}

interface PaneSearchState {
  open: boolean
  query: string
  index: number
}

const STATUS_LABEL: Record<JsonStatus, string> = {
  empty: 'Empty draft',
  valid: 'Valid',
  invalid: 'Invalid',
}

function clsx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

function Icon(props: { path: string; class?: string; viewBox?: string }) {
  return (
    <svg
      viewBox={props.viewBox ?? '0 0 24 24'}
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={clsx('h-4 w-4', props.class)}
    >
      <path d={props.path} />
    </svg>
  )
}

function countMatches(content: string, query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) {
    return 0
  }

  const haystack = content.toLowerCase()
  let count = 0
  let cursor = 0

  while (cursor < haystack.length) {
    const index = haystack.indexOf(needle, cursor)
    if (index === -1) {
      break
    }

    count += 1
    cursor = index + needle.length
  }

  return count
}

function occurrenceIndexAt(content: string, query: string, position: number) {
  const needle = query.trim().toLowerCase()
  if (!needle) {
    return 0
  }

  const haystack = content.toLowerCase()
  let cursor = 0
  let count = 0

  while (cursor <= position) {
    const index = haystack.indexOf(needle, cursor)
    if (index === -1 || index > position) {
      break
    }

    count += 1
    cursor = index + needle.length
  }

  return count
}

async function writeTextToClipboard(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }

    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', 'true')
    textarea.style.position = 'absolute'
    textarea.style.left = '-9999px'
    document.body.append(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    textarea.remove()
    return copied
  } catch {
    return false
  }
}

function App() {
  const loadedWorkspace = loadWorkspace()
  const [workspace, setWorkspace] = createStore(loadedWorkspace)
  const [saveState, setSaveState] = createSignal<SaveState>('saved')
  const [paneSearch, setPaneSearch] = createStore<Record<PaneId, PaneSearchState>>({
    primary: { open: false, query: '', index: 0 },
    secondary: { open: false, query: '', index: 0 },
  })
  const [notice, setNotice] = createSignal<NoticeState | null>(null)
  const [renamingTabId, setRenamingTabId] = createSignal<string | null>(null)
  const [renameDraft, setRenameDraft] = createSignal('')
  const [savedAtByTab, setSavedAtByTab] = createSignal<Record<string, number>>(
    Object.fromEntries(loadedWorkspace.tabs.map((tab) => [tab.id, tab.updatedAt])),
  )

  let persistTimer: number | undefined
  let noticeTimer: number | undefined
  const searchInputRefs: Partial<Record<PaneId, HTMLInputElement>> = {}
  const textareaRefs: Partial<Record<PaneId, HTMLTextAreaElement>> = {}
  const gutterRefs: Partial<Record<PaneId, HTMLDivElement>> = {}

  const serializedWorkspace = createMemo(() => JSON.stringify(workspace))
  let previousSerialized = serializedWorkspace()

  const visiblePaneIds = createMemo(() =>
    workspace.paneMode === 'split' ? PANE_IDS : [PANE_IDS[0]],
  )

  const showNotice = (tone: NoticeTone, message: string) => {
    window.clearTimeout(noticeTimer)
    setNotice({ tone, message })
    noticeTimer = window.setTimeout(() => setNotice(null), 2400)
  }

  const markWorkspacePersisted = () => {
    setSavedAtByTab(Object.fromEntries(workspace.tabs.map((tab) => [tab.id, tab.updatedAt])))
  }

  const isTabDirty = (tab: JsonTab) => tab.updatedAt > (savedAtByTab()[tab.id] ?? 0)
  const getTab = (tabId: string) => workspace.tabs.find((tab) => tab.id === tabId)
  const getPaneTab = (paneId: PaneId) =>
    getTab(workspace.panes[paneId].tabId) ?? workspace.tabs[0]
  const tabAssignments = (tabId: string) =>
    visiblePaneIds().filter((paneId) => workspace.panes[paneId].tabId === tabId)
  const searchMatchesForPane = (paneId: PaneId) =>
    countMatches(getPaneTab(paneId)?.content ?? '', paneSearch[paneId].query)

  const focusPaneEditor = (paneId: PaneId) => {
    requestAnimationFrame(() => textareaRefs[paneId]?.focus())
  }

  const setActivePane = (paneId: PaneId) => {
    setWorkspace('activePane', paneId)
  }

  const assignTabToPane = (paneId: PaneId, tabId: string) => {
    setWorkspace(
      produce((draft) => {
        draft.activePane = paneId
        draft.panes[paneId].tabId = tabId

        const tab = draft.tabs.find((item) => item.id === tabId)
        if (tab) {
          tab.lastOpenedAt = Date.now()
        }
      }),
    )
    focusPaneEditor(paneId)
  }

  const createUntitledTab = (paneId: PaneId, content = '') => {
    const title = `Untitled ${workspace.nextTabNumber}`
    const tab = createTab(title, content)

    setWorkspace(
      produce((draft) => {
        draft.tabs.push(tab)
        draft.nextTabNumber += 1
        draft.activePane = paneId
        draft.panes[paneId].tabId = tab.id
      }),
    )

    setPaneSearch(paneId, { open: false, query: '', index: 0 })
    focusPaneEditor(paneId)
  }

  const duplicatePaneTab = (paneId: PaneId) => {
    const sourceTab = getPaneTab(paneId)
    if (!sourceTab) {
      return
    }

    const duplicate = createTab(`${sourceTab.title} copy`, sourceTab.content)
    setWorkspace(
      produce((draft) => {
        draft.tabs.push(duplicate)
        draft.activePane = paneId
        draft.panes[paneId].tabId = duplicate.id
      }),
    )

    showNotice('success', `Duplicated ${sourceTab.title}`)
    focusPaneEditor(paneId)
  }

  const updateTabContent = (tabId: string, content: string) => {
    const validation = validateJson(content)

    setWorkspace(
      produce((draft) => {
        const tab = draft.tabs.find((item) => item.id === tabId)
        if (!tab) {
          return
        }

        tab.content = content
        tab.validation = validation
        tab.updatedAt = Date.now()
      }),
    )
  }

  const renameTab = (tabId: string, nextTitle: string) => {
    const trimmed = nextTitle.trim()
    if (!trimmed) {
      batch(() => {
        setRenamingTabId(null)
        setRenameDraft('')
      })
      return
    }

    setWorkspace(
      produce((draft) => {
        const tab = draft.tabs.find((item) => item.id === tabId)
        if (!tab) {
          return
        }

        tab.title = trimmed
        tab.updatedAt = Date.now()
      }),
    )

    batch(() => {
      setRenamingTabId(null)
      setRenameDraft('')
    })
  }

  const closeTab = (tabId: string) => {
    const currentIndex = workspace.tabs.findIndex((tab) => tab.id === tabId)
    if (currentIndex === -1) {
      return
    }

    if (workspace.tabs.length === 1) {
      const freshWorkspace = createBlankWorkspace()
      batch(() => {
        setWorkspace(freshWorkspace)
        setSavedAtByTab({})
        setPaneSearch('primary', { open: false, query: '', index: 0 })
        setPaneSearch('secondary', { open: false, query: '', index: 0 })
      })
      showNotice('info', 'Started a fresh workspace')
      focusPaneEditor('primary')
      return
    }

    const fallbackTabId =
      workspace.tabs[currentIndex - 1]?.id ??
      workspace.tabs[currentIndex + 1]?.id ??
      workspace.tabs[0].id

    setWorkspace(
      produce((draft) => {
        draft.tabs = draft.tabs.filter((tab) => tab.id !== tabId)

        if (draft.panes.primary.tabId === tabId) {
          draft.panes.primary.tabId = fallbackTabId
        }

        if (draft.panes.secondary.tabId === tabId) {
          draft.panes.secondary.tabId = fallbackTabId
        }
      }),
    )

    setSavedAtByTab((current) => {
      const next = { ...current }
      delete next[tabId]
      return next
    })
  }

  const transformPaneTab = (paneId: PaneId, mode: 'format' | 'minify') => {
    const tab = getPaneTab(paneId)
    if (!tab || !tab.content.trim()) {
      showNotice('info', 'Add JSON content before transforming it')
      return
    }

    try {
      const parsed = JSON.parse(tab.content)
      const content = mode === 'format' ? JSON.stringify(parsed, null, 2) : JSON.stringify(parsed)
      updateTabContent(tab.id, content)
      showNotice('success', mode === 'format' ? 'Formatted active tab' : 'Minified active tab')
    } catch {
      showNotice('error', 'Fix validation errors before formatting')
    }
  }

  const toggleSplitView = () => {
    setWorkspace(
      produce((draft) => {
        draft.paneMode = draft.paneMode === 'split' ? 'single' : 'split'
        if (!draft.panes.secondary.tabId) {
          draft.panes.secondary.tabId = draft.panes.primary.tabId
        }
      }),
    )
  }

  const clearWorkspace = () => {
    if (!window.confirm('Clear all local tabs and reset the workspace?')) {
      return
    }

    window.localStorage.removeItem(STORAGE_KEY)
    const freshWorkspace = createBlankWorkspace()

    batch(() => {
      setWorkspace(freshWorkspace)
      setSavedAtByTab({})
      setPaneSearch('primary', { open: false, query: '', index: 0 })
      setPaneSearch('secondary', { open: false, query: '', index: 0 })
      setSaveState('saved')
    })

    showNotice('info', 'Local workspace cleared')
    focusPaneEditor('primary')
  }

  const startRenaming = (tab: JsonTab) => {
    batch(() => {
      setRenamingTabId(tab.id)
      setRenameDraft(tab.title)
    })
  }

  const copyFromPaneTab = async (paneId: PaneId, mode: 'raw' | 'formatted') => {
    const tab = getPaneTab(paneId)
    if (!tab) {
      return
    }

    let content = tab.content

    if (mode === 'formatted') {
      try {
        content = JSON.stringify(JSON.parse(tab.content), null, 2)
      } catch {
        showNotice('error', 'Fix validation errors before copying formatted JSON')
        return
      }
    }

    const copied = await writeTextToClipboard(content)
    showNotice(copied ? 'success' : 'error', copied ? 'Copied to clipboard' : 'Clipboard access failed')
  }

  const setPaneSearchOpen = (paneId: PaneId, open: boolean) => {
    setPaneSearch(paneId, 'open', open)
    if (!open) {
      setPaneSearch(paneId, 'index', 0)
    } else {
      setActivePane(paneId)
      requestAnimationFrame(() => searchInputRefs[paneId]?.focus())
    }
  }

  const navigateSearch = (paneId: PaneId, direction: 1 | -1) => {
    const query = paneSearch[paneId].query.trim()
    const textarea = textareaRefs[paneId]
    const tab = getPaneTab(paneId)

    if (!query || !textarea || !tab) {
      return
    }

    const content = tab.content.toLowerCase()
    const needle = query.toLowerCase()
    const anchor =
      direction === 1
        ? Math.max(textarea.selectionEnd, 0)
        : Math.max(textarea.selectionStart - needle.length - 1, 0)

    let index =
      direction === 1 ? content.indexOf(needle, anchor) : content.lastIndexOf(needle, anchor)

    if (index === -1) {
      index = direction === 1 ? content.indexOf(needle) : content.lastIndexOf(needle)
    }

    if (index === -1) {
      setPaneSearch(paneId, 'index', 0)
      return
    }

    textarea.focus()
    textarea.setSelectionRange(index, index + needle.length)
    setPaneSearch(paneId, 'index', occurrenceIndexAt(tab.content, query, index))
  }

  createEffect(() => {
    const serialized = serializedWorkspace()

    if (serialized === previousSerialized) {
      return
    }

    setSaveState('saving')
    window.clearTimeout(persistTimer)
    persistTimer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, serialized)
        previousSerialized = serialized
        setSaveState('saved')
        markWorkspacePersisted()
      } catch {
        setSaveState('error')
        showNotice('error', 'Unable to persist workspace locally')
      }
    }, 260)
  })

  createEffect(() => {
    for (const paneId of PANE_IDS) {
      const query = paneSearch[paneId].query.trim()
      const matches = searchMatchesForPane(paneId)

      if (!query) {
        if (paneSearch[paneId].index !== 0) {
          setPaneSearch(paneId, 'index', 0)
        }
        continue
      }

      if (paneSearch[paneId].index > matches) {
        setPaneSearch(paneId, 'index', matches)
      }
    }
  })

  onMount(() => {
    markWorkspacePersisted()
    requestAnimationFrame(() => textareaRefs.primary?.focus())

    const handleKeydown = (event: KeyboardEvent) => {
      const isMod = event.metaKey || event.ctrlKey
      if (!isMod) {
        return
      }

      const key = event.key.toLowerCase()

      if (event.shiftKey && key === 'f') {
        event.preventDefault()
        transformPaneTab(workspace.activePane, 'format')
        return
      }

      if (event.shiftKey && key === 'm') {
        event.preventDefault()
        transformPaneTab(workspace.activePane, 'minify')
        return
      }

      if (key === 'f') {
        event.preventDefault()
        setPaneSearchOpen(workspace.activePane, true)
        return
      }

      if (key === '\\') {
        event.preventDefault()
        toggleSplitView()
      }
    }

    window.addEventListener('keydown', handleKeydown)
    onCleanup(() => window.removeEventListener('keydown', handleKeydown))
  })

  onCleanup(() => {
    window.clearTimeout(persistTimer)
    window.clearTimeout(noticeTimer)
  })

  return (
    <main class="app-shell text-stone-900">
      <header class="enter-rise border-b border-[color:var(--border)] px-5 py-3 sm:px-6 lg:px-8">
        <h1 class="text-base font-semibold tracking-[-0.03em] text-stone-950 sm:text-lg">
          JSON Editor
        </h1>
      </header>

      <section class="workspace-surface px-4 py-4 sm:px-5 sm:py-5 lg:px-8">
        <div
          class={clsx(
            'grid gap-4',
            workspace.paneMode === 'split' ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1',
          )}
        >
          <For each={visiblePaneIds()}>
            {(paneId, index) => {
              const paneTab = createMemo(() => getPaneTab(paneId))
              const lineNumbers = createMemo(() =>
                Array.from(
                  { length: Math.max(1, paneTab()?.content.split('\n').length ?? 1) },
                  (_, item) => item + 1,
                ),
              )
              const lineCount = createMemo(() => Math.max(1, paneTab()?.content.split('\n').length ?? 1))
              const characterCount = createMemo(() => paneTab()?.content.length ?? 0)

              return (
                <article
                  class={clsx('pane-shell', workspace.activePane === paneId && 'pane-shell--active')}
                  onClick={() => setActivePane(paneId)}
                >
                  <div class="flex flex-col gap-3 border-b border-[color:var(--border)] px-4 py-3 sm:px-4">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <p class="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-stone-500">
                        {index() === 0 ? 'Primary pane' : 'Secondary pane'}
                      </p>
                      <div class="flex flex-wrap items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.16em]">
                        <span
                          class={clsx(
                            'compact-chip',
                            paneTab()?.validation.status === 'valid' &&
                              'border-emerald-200 bg-emerald-50 text-emerald-700',
                            paneTab()?.validation.status === 'invalid' &&
                              'border-rose-200 bg-rose-50 text-rose-700',
                            paneTab()?.validation.status === 'empty' &&
                              'border-stone-200 bg-stone-50 text-stone-500',
                          )}
                        >
                          {STATUS_LABEL[paneTab()?.validation.status ?? 'empty']}
                        </span>
                        <span
                          class={clsx(
                            'compact-chip',
                            saveState() === 'saved' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
                            saveState() === 'saving' && 'border-amber-200 bg-amber-50 text-amber-700',
                            saveState() === 'error' && 'border-rose-200 bg-rose-50 text-rose-700',
                          )}
                        >
                          {saveState() === 'saved'
                            ? 'Saved'
                            : saveState() === 'saving'
                              ? 'Saving'
                              : 'Storage error'}
                        </span>
                      </div>
                    </div>

                    <div class="pane-controls-row">
                      <div class="pane-tabs-scroll">
                        <For each={workspace.tabs}>
                          {(tab) => (
                            <div
                              class={clsx(
                                'pane-tab',
                                paneTab()?.id === tab.id && 'pane-tab--active',
                                tabAssignments(tab.id).length > 0 && 'pane-tab--mapped',
                              )}
                            >
                              <Show
                                when={renamingTabId() === tab.id}
                                fallback={
                                  <button
                                    class="flex min-w-0 flex-1 items-center gap-2 text-left"
                                    onClick={() => assignTabToPane(paneId, tab.id)}
                                    onDblClick={() => startRenaming(tab)}
                                  >
                                    <span
                                      class={clsx(
                                        'h-2 w-2 shrink-0 rounded-sm',
                                        tab.validation.status === 'valid' && 'bg-emerald-500',
                                        tab.validation.status === 'invalid' && 'bg-rose-500',
                                        tab.validation.status === 'empty' && 'bg-stone-300',
                                      )}
                                    />
                                    <span class="truncate text-[0.8rem] font-medium">{tab.title}</span>
                                    <Show when={isTabDirty(tab)}>
                                      <span class="text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-amber-700">
                                        Draft
                                      </span>
                                    </Show>
                                  </button>
                                }
                              >
                                <input
                                  value={renameDraft()}
                                  onInput={(event) => setRenameDraft(event.currentTarget.value)}
                                  onBlur={() => renameTab(tab.id, renameDraft())}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                      renameTab(tab.id, renameDraft())
                                    }

                                    if (event.key === 'Escape') {
                                      batch(() => {
                                        setRenamingTabId(null)
                                        setRenameDraft('')
                                      })
                                    }
                                  }}
                                  class="min-w-24 flex-1 bg-transparent text-[0.8rem] font-medium text-stone-900 outline-none"
                                />
                              </Show>

                              <div class="flex items-center gap-1">
                                <For each={tabAssignments(tab.id)}>
                                  {(assignedPaneId) => (
                                    <span class="pane-tab-badge">
                                      {assignedPaneId === 'primary' ? 'P1' : 'P2'}
                                    </span>
                                  )}
                                </For>
                                <button
                                  class="pane-tab-close"
                                  onClick={() => closeTab(tab.id)}
                                  aria-label={`Close ${tab.title}`}
                                >
                                  ×
                                </button>
                              </div>
                            </div>
                          )}
                        </For>

                        <button
                          class="pane-tab pane-tab--create"
                          onClick={() => createUntitledTab(paneId, '')}
                          aria-label="Create tab"
                          title="New tab"
                        >
                          <Icon path="M12 5v14M5 12h14" />
                        </button>
                      </div>

                      <div class="pane-toolbar">
                        <button
                          class="toolbar-button"
                          onClick={() => duplicatePaneTab(paneId)}
                          aria-label="Duplicate tab"
                          title="Duplicate tab"
                        >
                          <Icon path="M9 9h10v10H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
                        </button>
                        <button
                          class="toolbar-button"
                          onClick={() => transformPaneTab(paneId, 'format')}
                          aria-label="Format JSON"
                          title="Format JSON"
                        >
                          <Icon path="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                        </button>
                        <button
                          class="toolbar-button"
                          onClick={() => transformPaneTab(paneId, 'minify')}
                          aria-label="Minify JSON"
                          title="Minify JSON"
                        >
                          <Icon path="M4 7h16M7 12h10M10 17h4" />
                        </button>
                        <button
                          class="toolbar-button"
                          onClick={() => setPaneSearchOpen(paneId, !paneSearch[paneId].open)}
                          aria-label={paneSearch[paneId].open ? 'Hide search' : 'Search'}
                          title={paneSearch[paneId].open ? 'Hide search' : 'Search'}
                        >
                          <Icon
                            path={
                              paneSearch[paneId].open
                                ? 'M6 6l12 12M18 6L6 18'
                                : 'M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z'
                            }
                          />
                        </button>
                        <button
                          class="toolbar-button"
                          onClick={() => copyFromPaneTab(paneId, 'raw')}
                          aria-label="Copy raw JSON"
                          title="Copy raw JSON"
                        >
                          <Icon path="M9 9h10v10H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
                        </button>
                        <button
                          class="toolbar-button"
                          onClick={() => copyFromPaneTab(paneId, 'formatted')}
                          aria-label="Copy formatted JSON"
                          title="Copy formatted JSON"
                        >
                          <Icon path="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                        </button>
                        <button
                          class="toolbar-button"
                          onClick={() => closeTab(paneTab()?.id ?? '')}
                          aria-label="Close tab"
                          title="Close tab"
                        >
                          <Icon path="M6 6l12 12M18 6L6 18" />
                        </button>
                        <button
                          class="toolbar-button"
                          onClick={() => toggleSplitView()}
                          aria-label={workspace.paneMode === 'split' ? 'Single pane' : 'Split view'}
                          title={workspace.paneMode === 'split' ? 'Single pane' : 'Split view'}
                        >
                          <Icon
                            path={
                              workspace.paneMode === 'split'
                                ? 'M5 5h14v14H5z'
                                : 'M4 5h16v14H4zM12 5v14'
                            }
                          />
                        </button>
                        <button
                          class="toolbar-button toolbar-button--danger"
                          onClick={() => clearWorkspace()}
                          aria-label="Reset workspace"
                          title="Reset workspace"
                        >
                          <Icon path="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />
                        </button>
                      </div>
                    </div>

                    <Show when={paneSearch[paneId].open}>
                      <div class="flex flex-col gap-2 lg:flex-row lg:items-center">
                        <input
                          ref={(element) => {
                            searchInputRefs[paneId] = element
                          }}
                          type="search"
                          value={paneSearch[paneId].query}
                          onInput={(event) => setPaneSearch(paneId, 'query', event.currentTarget.value)}
                          placeholder="Find in this pane"
                          class="min-w-0 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-100 lg:min-w-72"
                        />
                        <div class="flex flex-wrap items-center gap-2">
                          <button
                            class="toolbar-button"
                            onClick={() => navigateSearch(paneId, -1)}
                            aria-label="Previous match"
                            title="Previous match"
                          >
                            <Icon path="M15 18l-6-6 6-6" />
                          </button>
                          <button
                            class="toolbar-button"
                            onClick={() => navigateSearch(paneId, 1)}
                            aria-label="Next match"
                            title="Next match"
                          >
                            <Icon path="M9 6l6 6-6 6" />
                          </button>
                          <span class="compact-chip">
                            {searchMatchesForPane(paneId)
                              ? `${paneSearch[paneId].index || 1} / ${searchMatchesForPane(paneId)}`
                              : '0 matches'}
                          </span>
                        </div>
                      </div>
                    </Show>
                  </div>

                  <div class="relative flex min-h-[32rem] flex-1 flex-col">
                    <div class="flex min-h-0 flex-1 overflow-hidden">
                      <div
                        ref={(element) => {
                          gutterRefs[paneId] = element
                        }}
                        class="line-gutter hidden w-14 overflow-hidden border-r border-[color:var(--border)] bg-stone-950/[0.03] py-4 text-right text-xs font-medium text-stone-400 sm:block"
                      >
                        <For each={lineNumbers()}>
                          {(lineNumber) => <div class="px-4 leading-6">{lineNumber}</div>}
                        </For>
                      </div>

                      <textarea
                        ref={(element) => {
                          textareaRefs[paneId] = element
                        }}
                        value={paneTab()?.content}
                        spellcheck={false}
                        placeholder='{\n  "type": "your json here"\n}'
                        class="editor-textarea min-h-[32rem] w-full flex-1 bg-transparent px-4 py-4 font-mono text-[0.92rem] leading-6 text-stone-800 outline-none sm:px-5"
                        onFocus={() => setActivePane(paneId)}
                        onScroll={(event) => {
                          const gutter = gutterRefs[paneId]
                          if (gutter) {
                            gutter.scrollTop = event.currentTarget.scrollTop
                          }
                        }}
                        onInput={(event) => updateTabContent(paneTab()?.id ?? '', event.currentTarget.value)}
                      />
                    </div>

                    <div class="flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--border)] px-4 py-3 text-xs text-stone-500 sm:px-5">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="compact-metric">
                          {lineCount()} {lineCount() === 1 ? 'line' : 'lines'}
                        </span>
                        <span class="compact-metric">
                          {characterCount()} chars
                        </span>
                        <Show when={paneSearch[paneId].query.trim()}>
                          <span class="compact-metric">
                            {searchMatchesForPane(paneId)} matches
                          </span>
                        </Show>
                      </div>

                      <div class="flex flex-wrap items-center gap-2">
                        <Show when={!isTabDirty(paneTab()!) && saveState() === 'saved'}>
                          <span class="compact-chip border-emerald-200 bg-emerald-50 text-emerald-700">
                            Saved locally
                          </span>
                        </Show>
                        <Show when={isTabDirty(paneTab()!)}>
                          <span class="compact-chip border-amber-200 bg-amber-50 text-amber-700">
                            Pending local save
                          </span>
                        </Show>
                        <Show when={paneTab()?.validation.status === 'invalid'}>
                          <span class="compact-chip border-rose-200 bg-rose-50 text-rose-700">
                            {paneTab()?.validation.line
                              ? `Line ${paneTab()?.validation.line}, column ${paneTab()?.validation.column}`
                              : 'Fix syntax to format or copy pretty JSON'}
                          </span>
                        </Show>
                      </div>
                    </div>
                  </div>
                </article>
              )
            }}
          </For>
        </div>
      </section>

      <Show when={notice()}>
        {(currentNotice) => (
          <div
            class={clsx(
              'fixed bottom-4 right-4 z-50 rounded-2xl border px-4 py-3 text-sm shadow-[0_24px_80px_rgba(28,25,23,0.18)] backdrop-blur',
              currentNotice().tone === 'success' && 'border-emerald-200 bg-white/92 text-emerald-700',
              currentNotice().tone === 'error' && 'border-rose-200 bg-white/92 text-rose-700',
              currentNotice().tone === 'info' && 'border-stone-200 bg-white/92 text-stone-700',
            )}
          >
            {currentNotice().message}
          </div>
        )}
      </Show>
    </main>
  )
}

export default App
