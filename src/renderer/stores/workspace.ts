import { create } from 'zustand'
import type { Activity, Approval, Message, Snapshot } from '../../shared/types'
interface State {
  initialized: boolean
  search: string
  before?: number
  hasMore: boolean
  snapshot?: Snapshot
  conversationId: string
  selectionEpoch: number
  reserveSelection(): number
  messages: Message[]
  pinnedIds: string[]
  activities: Activity[]
  approvals: Approval[]
  error: string
  set(patch: Partial<State>): void
  refresh(): Promise<void>
  load(id: string, search?: string, merge?: boolean, expectedEpoch?: number): Promise<void>
  older(): Promise<void>
}
let messageRequest = 0
export const useWorkspace = create<State>((set, get) => ({
  initialized: false,
  search: '',
  hasMore: false,
  conversationId: '',
  selectionEpoch: 0,
  reserveSelection() {
    const epoch = get().selectionEpoch + 1
    set({ selectionEpoch: epoch })
    return epoch
  },
  messages: [],
  pinnedIds: [],
  activities: [],
  approvals: [],
  error: '',
  set: (patch) => set(patch),
  async refresh() {
    const snapshot = await window.agenthub.invoke<Snapshot>({ op: 'snapshot' })
    const first = !get().initialized
    set({ snapshot, initialized: true })
    if (
      first &&
      snapshot.settings.startupBehavior === 'restore' &&
      get().selectionEpoch === 0 &&
      !get().conversationId &&
      snapshot.conversations.length
    )
      await get().load(snapshot.conversations.at(-1)!.id)
  },
  async load(id, search = '', merge = false, expectedEpoch) {
    if (expectedEpoch !== undefined && expectedEpoch !== get().selectionEpoch) return
    // A late refresh may update only the room that is still being viewed.
    if (merge && (get().conversationId !== id || get().search !== search)) return
    const same = get().conversationId === id && get().search === search
    if (!same && !merge && expectedEpoch === undefined) get().reserveSelection()
    const epoch = get().selectionEpoch,
      request = ++messageRequest
    set({
      conversationId: id,
      search,
      ...(!same ? { messages: [], before: undefined, hasMore: false } : {}),
    })
    const data = await window.agenthub.invoke<{
      messages: Message[]
      pinnedIds: string[]
      activities: Activity[]
      before?: number
      hasMore: boolean
    }>({
      op: 'messages',
      conversationId: id,
      search,
    })
    if (
      get().conversationId === id &&
      get().search === search &&
      get().selectionEpoch === epoch &&
      request === messageRequest
    ) {
      if (merge && same && get().messages.length > 80) {
        const newer = new Map(data.messages.map((m) => [m.id, m]))
        const messages = get().messages.map((m) => newer.get(m.id) || m)
        const known = new Set(messages.map((m) => m.id))
        set({
          messages: [...messages, ...data.messages.filter((m) => !known.has(m.id))],
          activities: data.activities,
          pinnedIds: data.pinnedIds,
        })
      } else set(data)
    }
  },
  async older() {
    const { conversationId, search, before, hasMore, selectionEpoch } = get()
    if (!hasMore || !before) return
    const data = await window.agenthub.invoke<{
      messages: Message[]
      before?: number
      hasMore: boolean
    }>({ op: 'messages', conversationId, search, before })
    if (
      get().conversationId === conversationId &&
      get().search === search &&
      get().selectionEpoch === selectionEpoch &&
      get().before === before
    ) {
      const known = new Set(get().messages.map((m) => m.id))
      set({
        messages: [...data.messages.filter((m) => !known.has(m.id)), ...get().messages],
        before: data.before,
        hasMore: data.hasMore,
      })
    }
  },
}))
export type WorkspaceState = State
