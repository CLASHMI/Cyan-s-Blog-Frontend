import { defineStore } from 'pinia'

import { request } from '@/utils/request'

/* 分类是全局共享数据：控制台表单、随笔筛选与详情兜底共用同一份 */
export const useCategoryStore = defineStore('category', {
  state: () => ({
    list: [],
  }),

  getters: {
    options: (state) => state.list.map((c) => ({ value: String(c.id), label: c.name })),
  },

  actions: {
    async loadCategories() {
      try {
        const res = await request('/category/list?pageNum=1&pageSize=500')
        this.list = res.records || res || []
      } catch (e) {}
    },

    nameOf(id) {
      if (id === null || id === undefined || id === '') return ''
      const hit = this.list.find((item) => String(item.id) === String(id))
      return hit ? hit.name : ''
    },
  },
})