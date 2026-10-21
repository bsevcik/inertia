import { beforeEach, describe, expect, it, vi } from 'vitest'
import { router } from '../src/index'
import { useInfiniteScrollData } from '../src/infiniteScroll/data'
import { useInfiniteScrollQueryString } from '../src/infiniteScroll/queryString'
import { page } from '../src/page'
import type { InfiniteScrollRequest, Page as InertiaPage } from '../src/types'

const scrollPage = {
  component: 'Users/Index',
  props: { errors: {}, users: { data: [] } },
  url: '/users',
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
} as InertiaPage

const installWindow = () => {
  const listeners = new Map<string, EventListener[]>()

  globalThis.document = {
    addEventListener(type: string, listener: EventListener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener])
    },
    removeEventListener(type: string, listener: EventListener) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((registered) => registered !== listener),
      )
    },
  } as unknown as Document

  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    innerHeight: 800,
    innerWidth: 800,
    location: new URL('http://localhost/users?timestamps=true#task-1'),
  } as unknown as Window & typeof globalThis
}

const visibleRow = (pageNumber: string) =>
  ({
    offsetParent: {},
    dataset: { infiniteScrollPage: pageNumber },
    getBoundingClientRect: () => ({ top: 0, bottom: 10, left: 0, right: 10 }),
  }) as unknown as HTMLElement

const createDataManager = (getRequest?: () => InfiniteScrollRequest | undefined) => {
  return useInfiniteScrollData({
    getPropName: () => 'users',
    onBeforeUpdate: () => {},
    onBeforePreviousRequest: () => {},
    onBeforeNextRequest: () => {},
    onCompletePreviousRequest: () => {},
    onCompleteNextRequest: () => {},
    getRequest,
  })
}

describe('infinite scroll request callback', () => {
  beforeEach(() => {
    installWindow()
    page.init({
      initialPage: scrollPage,
      swapComponent: () => Promise.resolve(),
      resolveComponent: () => Promise.resolve(null),
    })
  })

  it('loads the next page through router.reload when no request callback is set', () => {
    const reload = vi.spyOn(router, 'reload').mockImplementation(() => {})
    const dataManager = createDataManager()

    dataManager.fetchNext()

    expect(reload).toHaveBeenCalledOnce()
    expect(reload.mock.calls[0][0]).toMatchObject({
      preserveUrl: true,
      only: ['users'],
      data: { page: 2 },
      headers: { 'X-Inertia-Infinite-Scroll-Merge-Intent': 'append' },
    })

    dataManager.flush()
    reload.mockRestore()
  })

  it('gives the request callback the page visit instead of calling router.reload', () => {
    const reload = vi.spyOn(router, 'reload').mockImplementation(() => {})
    const request = vi.fn()
    const dataManager = createDataManager(() => request)

    dataManager.fetchNext()

    expect(reload).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledOnce()
    expect(request.mock.calls[0][0]).toMatchObject({
      side: 'next',
      page: 2,
      pageName: 'page',
      propName: 'users',
      reloadOptions: {
        preserveUrl: true,
        only: ['users'],
        data: { page: 2 },
        headers: { 'X-Inertia-Infinite-Scroll-Merge-Intent': 'append' },
      },
    })

    dataManager.flush()
    reload.mockRestore()
  })
})

const waitForUrlUpdate = () => new Promise((resolve) => setTimeout(resolve, 300))

describe('infinite scroll URL callback', () => {
  beforeEach(() => {
    installWindow()
    page.init({
      initialPage: scrollPage,
      swapComponent: () => Promise.resolve(),
      resolveComponent: () => Promise.resolve(null),
    })
  })

  it('rewrites the visible page from page.url when no URL callback is set', async () => {
    const replace = vi.spyOn(router, 'replace').mockImplementation(() => {})
    const itemsElement = { children: [visibleRow('2')] } as unknown as HTMLElement
    const queryString = useInfiniteScrollQueryString({
      getPageName: () => 'page',
      getItemsElement: () => itemsElement,
      shouldPreserveUrl: () => false,
    })

    queryString.onItemIntersected(itemsElement.children[0] as HTMLElement)
    await waitForUrlUpdate()

    expect(replace).toHaveBeenCalledWith({
      url: '/users?page=2',
      preserveScroll: true,
      preserveState: true,
    })

    queryString.cancel()
    replace.mockRestore()
  })

  it('writes the URL returned for the visible page', async () => {
    const replace = vi.spyOn(router, 'replace').mockImplementation(() => {})
    const resolveUrl = vi.fn(() => '/users?timestamps=true&page=2#task-1')
    const row = visibleRow('2')
    const queryString = useInfiniteScrollQueryString({
      getPageName: () => 'page',
      getItemsElement: () => ({ children: [row] }) as unknown as HTMLElement,
      shouldPreserveUrl: () => false,
      getResolveUrl: () => resolveUrl,
    })

    queryString.onItemIntersected(row)
    await waitForUrlUpdate()

    expect(resolveUrl).toHaveBeenCalledWith({ page: '2', pageName: 'page' })
    expect(replace).toHaveBeenCalledWith({
      url: '/users?timestamps=true&page=2#task-1',
      preserveScroll: true,
      preserveState: true,
    })

    queryString.cancel()
    replace.mockRestore()
  })
})
