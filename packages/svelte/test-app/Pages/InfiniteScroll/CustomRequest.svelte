<script lang="ts">
  import type { InfiniteScrollRequest, InfiniteScrollResolveUrl } from '@inertiajs/core'
  import { InfiniteScroll, router } from '@inertiajs/svelte'
  import UserCard, { type User } from './UserCard.svelte'

  interface Props {
    users: { data: User[] }
  }

  let { users }: Props = $props()

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
</script>

<InfiniteScroll data="users" {request} {resolveUrl} style="display: grid; gap: 20px">
  {#snippet loading()}
    <div style="text-align: center; padding: 20px">Loading...</div>
  {/snippet}

  {#each users.data as user (user.id)}
    <UserCard {user} />
  {/each}
</InfiniteScroll>
