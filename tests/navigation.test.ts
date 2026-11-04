import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { useWorkspace } from '../src/renderer/stores/workspace'
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
const data = (id: string) => ({ messages: [{ id }], activities: [], pinnedIds: [] })
it('does not let startup restoration override a reserved notification click', async () => {
  const invoke = vi.fn(async () => ({
    settings: { startupBehavior: 'restore' },
    conversations: [{ id: 'last' }],
  }))
  vi.stubGlobal('window', { agenthub: { invoke } })
  useWorkspace.setState({ initialized: false })
  const state = useWorkspace.getState()
  state.reserveSelection()
  await state.refresh()
  expect(invoke).toHaveBeenCalledTimes(1)
  expect(useWorkspace.getState().conversationId).toBe('')
})
beforeEach(() => {
  useWorkspace.setState({
    conversationId: '',
    selectionEpoch: 0,
    search: '',
    messages: [],
    activities: [],
    initialized: true,
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
})
it('does not select a project or room whose asynchronous creation finishes after a newer navigation', async () => {
  const invoke = vi.fn(async () => data('new'))
  vi.stubGlobal('window', { agenthub: { invoke } })
  const old = useWorkspace.getState().reserveSelection()
  const current = useWorkspace.getState().reserveSelection()
  await useWorkspace.getState().load('new', '', false, current)
  await useWorkspace.getState().load('old', '', false, old)
  expect(invoke).toHaveBeenCalledTimes(1)
  expect(useWorkspace.getState().conversationId).toBe('new')
})
it('discards delayed room data after navigating away and back to the same room', async () => {
  const stale = deferred<ReturnType<typeof data>>()
  const invoke = vi
    .fn()
    .mockReturnValueOnce(stale.promise)
    .mockResolvedValueOnce(data('other'))
    .mockResolvedValueOnce(data('fresh'))
  vi.stubGlobal('window', { agenthub: { invoke } })
  const loading = useWorkspace.getState().load('a')
  await useWorkspace.getState().load('b')
  await useWorkspace.getState().load('a')
  stale.resolve(data('stale'))
  await loading
  expect(useWorkspace.getState().messages[0].id).toBe('fresh')
})
it('ignores a delayed background refresh for a room that is no longer selected', async () => {
  const invoke = vi.fn(async () => data('b'))
  vi.stubGlobal('window', { agenthub: { invoke } })
  await useWorkspace.getState().load('b')
  await useWorkspace.getState().load('a', '', true)
  expect(invoke).toHaveBeenCalledTimes(1)
  expect(useWorkspace.getState().conversationId).toBe('b')
})
it('keeps the newest response when two loads for the same room finish out of order', async () => {
  const slow = deferred<ReturnType<typeof data>>()
  const invoke = vi.fn().mockReturnValueOnce(slow.promise).mockResolvedValueOnce(data('newer'))
  vi.stubGlobal('window', { agenthub: { invoke } })
  const first = useWorkspace.getState().load('a')
  await useWorkspace.getState().load('a', '', true)
  slow.resolve(data('older'))
  await first
  expect(useWorkspace.getState().messages[0].id).toBe('newer')
})
