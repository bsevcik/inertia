import type { InfiniteScrollRequest, InfiniteScrollResolveUrl } from '@inertiajs/core'
import { InfiniteScroll, router } from '@inertiajs/react'
import UserCard, { User } from './UserCard'

const request: InfiniteScrollRequest = ({ reloadOptions }) => {
  router.visit('/infinite-scroll/custom-request/load', reloadOptions)
}

const resolveUrl: InfiniteScrollResolveUrl = ({ page, pageName }) => {
  const url = new URL(window.location.href)

  if (page === '1') {
    url.searchParams.delete(pageName)
  } else {
    url.searchParams.set(pageName, page)
  }

  return `${url.pathname}${url.search}${url.hash}`
}

export default ({ users }: { users: { data: User[] } }) => {
  return (
    <InfiniteScroll
      data="users"
      request={request}
      resolveUrl={resolveUrl}
      style={{ display: 'grid', gap: '20px' }}
      loading={() => <div style={{ textAlign: 'center', padding: '20px' }}>Loading...</div>}
    >
      {users.data.map((user) => (
        <UserCard key={user.id} user={user} />
      ))}
    </InfiniteScroll>
  )
}
