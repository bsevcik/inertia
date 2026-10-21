import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HttpRequestConfig, InfiniteScrollRequest, InfiniteScrollResolveUrl, Page } from '../src/types'

const initialPage = (): Page => ({
  component: 'Users/Index',
  props: { errors: {}, users: { data: [1] } },
  url: '/users?timestamps=true#task-1',
  version: '1',
  rescuedProps: [],
  flash: {},
  scrollProps: {
    users: {
      pageName: 'page',
      previousPage: null,
      nextPage: 2,
      currentPage: 1,
      reset: false,
    },
  },
})

// Keep routing, component resolution, page merging, and the history queues real.
// Only provide the browser boundary that those systems use.
const installBrowser = () => {
  const location = new URL('http://localhost/users?timestamps=true#task-1')
  const history = {
    state: { page: initialPage() },
    replaceState(state: { page: Page }, _title: string, url?: string) {
      this.state = state
      if (url !== undefined) {
        location.href = new URL(url, location).href
      }
    },
    pushState(state: { page: Page }, title: string, url: string) {
      this.replaceState(state, title, url)
    },
  }
  const browser = Object.assign(new EventTarget(), {
    location,
    history,
    navigator: { userAgent: 'Inertia test browser' },
    innerHeight: 800,
    innerWidth: 800,
    scrollX: 0,
    scrollY: 480,
    scrollTo(left: number, top: number) {
      this.scrollX = left
      this.scrollY = top
    },
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
  })

  vi.stubGlobal('window', browser)
  vi.stubGlobal(
    'document',
    Object.assign(new EventTarget(), {
      querySelectorAll: () => [],
      getElementById: () => null,
    }),
  )

  return browser
}

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => (resolve = done))
  return { promise, resolve }
}

let router: typeof import('../src/index').router
let http: typeof import('../src/index').http
let page: typeof import('../src/page').page
let useInfiniteScrollData: typeof import('../src/infiniteScroll/data').useInfiniteScrollData
let useInfiniteScrollQueryString: typeof import('../src/infiniteScroll/queryString').useInfiniteScrollQueryString
let browser: ReturnType<typeof installBrowser>
let cleanup: VoidFunction[]
let resolveComponent: ReturnType<typeof vi.fn<() => Promise<unknown>>>
let swapComponent: ReturnType<typeof vi.fn>
let network: ReturnType<typeof vi.fn<(config: HttpRequestConfig) => Promise<never>>>

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  browser = installBrowser()
  cleanup = []

  // History determines browser availability at module evaluation. Import after
  // installing the browser rather than replacing router.replace in these tests.
  ;({ router, http } = await import('../src/index'))
  ;({ page } = await import('../src/page'))
  ;({ useInfiniteScrollData } = await import('../src/infiniteScroll/data'))
  ;({ useInfiniteScrollQueryString } = await import('../src/infiniteScroll/queryString'))

  resolveComponent = vi.fn(async () => null)
  swapComponent = vi.fn(async () => {})
  page.init({ initialPage: initialPage(), resolveComponent, swapComponent })
  const { history } = await import('../src/history')
  history.setCurrent(page.get())

  const originalClient = http.getClient()
  cleanup.push(() => http.setClient(originalClient))
  network = vi.fn(async () => {
    throw new Error('URL synchronization must not request another page')
  })
  http.setClient({ request: network })
})

afterEach(async () => {
  cleanup.reverse().forEach((dispose) => dispose())
  router.cancelAll()
  await vi.runAllTimersAsync()
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const createDataManager = (
  request?: InfiniteScrollRequest,
  callbacks: Partial<Parameters<typeof useInfiniteScrollData>[0]> = {},
) => {
  const manager = useInfiniteScrollData({
    getPropName: () => 'users',
    onBeforeUpdate: () => {},
    onBeforePreviousRequest: () => {},
    onBeforeNextRequest: () => {},
    onCompletePreviousRequest: () => {},
    onCompleteNextRequest: () => {},
    getRequest: () => request,
    ...callbacks,
  })
  cleanup.push(manager.flush)
  return manager
}

describe('infinite scroll page visits', () => {
  it.each(['default', 'custom'])(
    'loads consecutive pages through the %s visit and preserves state and scroll',
    async (mode) => {
      const requests: URL[] = []
      const cacheControls: unknown[] = []
      http.setClient({
        async request(config) {
          const url = new URL(config.url)
          requests.push(url)
          cacheControls.push(config.headers?.['Cache-Control'])
          const next = Number(url.searchParams.get('page'))

          return {
            status: 200,
            headers: { 'x-inertia': 'true' },
            data: JSON.stringify({
              ...initialPage(),
              props: { errors: {}, users: { data: [next] } },
              url: `/users?page=${next}`,
              mergeProps: ['users.data'],
              scrollProps: {
                users: {
                  ...initialPage().scrollProps!.users,
                  currentPage: next,
                  nextPage: next === 3 ? null : next + 1,
                },
              },
            }),
          }
        },
      })

      let loading = false
      const beforeUpdates: unknown[] = []
      const completedPages: unknown[] = []
      const successes: unknown[] = []
      const request: InfiniteScrollRequest = ({ reloadOptions }) => router.visit('/users/load', reloadOptions)
      const manager = createDataManager(mode === 'custom' ? request : undefined, {
        onBeforeNextRequest: () => (loading = true),
        onBeforeUpdate: () => beforeUpdates.push(page.get().props.users.data),
        onCompleteNextRequest: (_, details) => {
          loading = false
          completedPages.push(details.page)
        },
      })

      for (const next of [2, 3]) {
        manager.fetchNext({ onSuccess: (response) => successes.push(response.props.users.data) })
        expect(loading).toBe(true)
        await vi.runAllTimersAsync()

        expect(loading).toBe(false)
        expect(page.get().props.users.data).toEqual(Array.from({ length: next }, (_, index) => index + 1))
        expect(browser.location.href).toBe('http://localhost/users?timestamps=true#task-1')
        expect(browser.scrollY).toBe(480)
      }

      expect(requests.map((url) => Number(url.searchParams.get('page')))).toEqual([2, 3])
      expect(requests.map((url) => url.pathname)).toEqual(
        mode === 'custom' ? ['/users/load', '/users/load'] : ['/users', '/users'],
      )
      expect(cacheControls).toEqual(['no-cache', 'no-cache'])
      expect(beforeUpdates).toEqual([[1], [1, 2]])
      expect(successes).toEqual([
        [1, 2],
        [1, 2, 3],
      ])
      expect(completedPages).toEqual([2, 3])
      expect(manager.getRequestCount()).toBe(2)
      expect(manager.hasNext()).toBe(false)
      expect(swapComponent.mock.calls.every(([visit]) => visit.preserveState)).toBe(true)
    },
  )

  it('cancels a custom visit when its component is disposed', async () => {
    const { HttpCancelledError } = await import('../src/httpErrors')
    let signal: AbortSignal | undefined
    http.setClient({
      request(config) {
        signal = config.signal
        return new Promise((_, reject) => {
          signal!.addEventListener('abort', () => reject(new HttpCancelledError()))
        })
      },
    })
    const completed = vi.fn()
    const finished = vi.fn()
    const manager = createDataManager(({ reloadOptions }) => router.visit('/users/load', reloadOptions), {
      onCompleteNextRequest: completed,
    })

    manager.fetchNext({ onFinish: finished })
    await vi.runAllTimersAsync()
    expect(signal?.aborted).toBe(false)

    manager.flush()
    await vi.runAllTimersAsync()

    expect(signal?.aborted).toBe(true)
    expect(finished).toHaveBeenCalledOnce()
    expect(finished.mock.calls[0][0].cancelled).toBe(true)
    expect(completed).not.toHaveBeenCalled()
    expect(page.get().props.users.data).toEqual([1])
  })
})

const locationUrl: InfiniteScrollResolveUrl = ({ page: visiblePage, pageName }) => {
  const url = new URL(window.location.href)
  visiblePage === '1' ? url.searchParams.delete(pageName) : url.searchParams.set(pageName, visiblePage)
  return `${url.pathname}${url.search}${url.hash}`
}

const createWriter = (pageName: string, resolveUrl?: InfiniteScrollResolveUrl) => {
  let visiblePage = '1'
  const rows = ['1', '2'].map(
    (number) =>
      ({
        offsetParent: {},
        dataset: { infiniteScrollPage: number },
        getBoundingClientRect: () => ({
          top: number === visiblePage ? 0 : 900,
          bottom: number === visiblePage ? 10 : 910,
          left: 0,
          right: 10,
        }),
      }) as unknown as HTMLElement,
  )
  const manager = useInfiniteScrollQueryString({
    getPageName: () => pageName,
    getItemsElement: () => ({ children: rows }) as unknown as HTMLElement,
    shouldPreserveUrl: () => false,
    getResolveUrl: () => resolveUrl,
  })
  cleanup.push(manager.cancel)

  return {
    cancel: manager.cancel,
    show(number: '1' | '2') {
      visiblePage = number
      manager.onItemIntersected(rows[Number(number) - 1])
    },
  }
}

describe('infinite scroll URL synchronization', () => {
  it.each(['both default', 'default first', 'custom first'])(
    'preserves both sibling page parameters with %s writers',
    async (order) => {
      const users = createWriter('users_page')
      const posts = createWriter('posts_page', order === 'both default' ? undefined : locationUrl)
      const writers = order === 'custom first' ? [posts, users] : [users, posts]

      writers.forEach((writer) => writer.show('2'))
      await vi.runAllTimersAsync()

      expect(browser.location.searchParams.get('users_page')).toBe('2')
      expect(browser.location.searchParams.get('posts_page')).toBe('2')
      expect(browser.history.state.page.url).toBe(page.get().url)
      expect(network).not.toHaveBeenCalled()
    },
  )

  it('waits for an earlier component resolution before resolving a sibling URL from the address bar', async () => {
    const component = deferred()
    resolveComponent.mockImplementationOnce(() => component.promise)
    const users = createWriter('users_page', locationUrl)
    const posts = createWriter('posts_page', locationUrl)

    users.show('2')
    posts.show('2')
    await vi.runAllTimersAsync()
    expect(browser.location.searchParams.has('users_page')).toBe(false)

    component.resolve()
    await vi.runAllTimersAsync()

    expect(browser.location.searchParams.get('users_page')).toBe('2')
    expect(browser.location.searchParams.get('posts_page')).toBe('2')
    expect(browser.location.searchParams.get('timestamps')).toBe('true')
    expect(browser.location.hash).toBe('#task-1')
    expect(browser.history.state.page.url).toBe(page.get().url)
  })

  it('preserves browser-only query and hash values while scrolling back through already loaded pages', async () => {
    page.merge({ url: '/users' })
    const writer = createWriter('page', locationUrl)

    writer.show('2')
    await vi.runAllTimersAsync()
    expect(browser.location.href).toBe('http://localhost/users?timestamps=true&page=2#task-1')

    writer.show('1')
    await vi.runAllTimersAsync()
    expect(browser.location.href).toBe('http://localhost/users?timestamps=true#task-1')
    expect(browser.location.href).toBe(new URL(page.get().url, 'http://localhost').href)
    expect(browser.scrollY).toBe(480)
    expect(network).not.toHaveBeenCalled()
  })

  it('does not apply a queued URL update after that sibling is disposed', async () => {
    const component = deferred()
    resolveComponent.mockImplementationOnce(() => component.promise)
    const users = createWriter('users_page', locationUrl)
    const posts = createWriter('posts_page', locationUrl)

    users.show('2')
    posts.show('2')
    await vi.runAllTimersAsync()
    posts.cancel()
    component.resolve()
    await vi.runAllTimersAsync()

    expect(browser.location.searchParams.get('users_page')).toBe('2')
    expect(browser.location.searchParams.has('posts_page')).toBe(false)
  })
})
