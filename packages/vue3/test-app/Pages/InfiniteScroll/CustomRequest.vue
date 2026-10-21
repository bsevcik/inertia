<script setup lang="ts">
import type { InfiniteScrollRequest, InfiniteScrollResolveUrl } from '@inertiajs/core'
import { InfiniteScroll, router } from '@inertiajs/vue3'
import { User, default as UserCard } from './UserCard.vue'

defineProps<{
  users: { data: User[] }
}>()

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

<template>
  <InfiniteScroll data="users" :request="request" :resolve-url="resolveUrl" style="display: grid; gap: 20px">
    <UserCard v-for="user in users.data" :key="user.id" :user="user" />

    <template #loading>
      <div style="text-align: center; padding: 20px">Loading...</div>
    </template>
  </InfiniteScroll>
</template>
