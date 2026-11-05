import { useEffect } from 'react'
import type { Settings } from '../../shared/types'
import { useWorkspace } from '../stores/workspace'
export function useWorkspaceEvents(
  conversationId: string,
  preferredTheme: Settings['theme'] | undefined,
  onNavigate: () => void,
  onActivity: () => void,
): void {
  const refresh = useWorkspace((state) => state.refresh)
  const set = useWorkspace((state) => state.set)
  useEffect(() => {
    void refresh().catch((e) => set({ error: String(e) }))
    let timer: ReturnType<typeof setTimeout> | undefined
    const deltas = new Map<string, string>()
    const deltaTimer = setInterval(() => {
      if (!deltas.size) return
      const state = useWorkspace.getState()
      state.set({
        messages: state.messages.map((m) =>
          deltas.has(m.id) ? { ...m, content: m.content + deltas.get(m.id)! } : m,
        ),
      })
      deltas.clear()
    }, 40)
    const unsubscribe = window.agenthub.subscribe((event) => {
      const state = useWorkspace.getState()
      if (event.type === 'changed') {
        clearTimeout(timer)
        timer = setTimeout(() => {
          deltas.clear()
          void state
            .refresh()
            .then(() => {
              const id = useWorkspace.getState().conversationId
              if (id) return state.load(id, useWorkspace.getState().search, true)
            })
            .catch((e) => state.set({ error: String(e) }))
        }, 70)
      }
      if (event.type === 'delta' && event.conversationId === state.conversationId)
        deltas.set(event.messageId, (deltas.get(event.messageId) || '') + event.delta)
      if (event.type === 'activity' && event.activity.conversationId === state.conversationId)
        state.set({ activities: [...state.activities, event.activity].slice(-200) })
      if (event.type === 'approvals') {
        state.set({ approvals: event.approvals })
        if (event.approvals.length) onActivity()
      }
      if (event.type === 'notification-error') state.set({ error: event.message })
      if (event.type === 'navigate') {
        const epoch = state.reserveSelection()
        deltas.clear()
        onNavigate()
        void state
          .refresh()
          .then(() => state.load(event.conversationId, '', false, epoch))
          .catch((e) => state.set({ error: String(e) }))
      }
    })
    void window.agenthub
      .invoke({ op: 'notifications.ready' })
      .catch((e) => set({ error: String(e) }))
    const rejected = (event: PromiseRejectionEvent) => {
      event.preventDefault()
      set({ error: event.reason instanceof Error ? event.reason.message : String(event.reason) })
    }
    window.addEventListener('unhandledrejection', rejected)
    return () => {
      unsubscribe()
      clearInterval(deltaTimer)
      clearTimeout(timer)
      window.removeEventListener('unhandledrejection', rejected)
    }
  }, [refresh, set, onNavigate, onActivity])
  useEffect(() => {
    const read = () => {
      if (conversationId && document.hasFocus())
        void window.agenthub
          .invoke({ op: 'notifications.read', conversationId })
          .catch((e) => set({ error: String(e) }))
    }
    read()
    window.addEventListener('focus', read)
    return () => window.removeEventListener('focus', read)
  }, [conversationId, set])
  useEffect(() => {
    const theme = preferredTheme || 'system'
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === 'system' ? (media.matches ? 'dark' : 'light') : theme
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [preferredTheme])
}
