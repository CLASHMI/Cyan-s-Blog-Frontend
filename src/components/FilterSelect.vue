<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  id: String,
  modelValue: String,
  options: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:modelValue', 'change'])

const open = ref(false)
const wrapperEl = ref(null)

const selectedLabel = computed(() => {
  const hit = props.options.find((option) => option.value === props.modelValue)
  return hit ? hit.label : ''
})

function pick(value) {
  if (value !== props.modelValue) {
    emit('update:modelValue', value)
    emit('change', value)
  }
  open.value = false
}

function onDocumentClick(event) {
  if (!open.value) return
  if (wrapperEl.value && wrapperEl.value.contains(event.target)) return
  open.value = false
}

onMounted(() => document.addEventListener('click', onDocumentClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick))
</script>

<template>
    <select :id="id" class="hidden" :value="modelValue" @change="pick($event.target.value)">
        <option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option>
    </select>
    <div ref="wrapperEl" class="custom-select-wrapper relative flex-1 min-w-[120px] sm:w-auto">
        <div class="custom-select-trigger cursor-pointer py-2.5" @click="open = !open">
            <span class="truncate">{{ selectedLabel }}</span>
            <i class="ph-bold ph-caret-down" :class="open ? 'rotate-180' : ''"></i>
        </div>
        <div class="custom-select-options" :class="open ? '' : 'opacity-0 scale-95 pointer-events-none -translate-y-2'">
            <div class="custom-select-scroll">
                <div v-for="(option, index) in options" :key="option.value" class="custom-select-option"
                    :data-index="index" :class="option.value === modelValue ? 'is-selected' : ''"
                    @click="pick(option.value)">
                    <span class="truncate">{{ option.label }}</span>
                    <i v-if="option.value === modelValue" class="ph-bold ph-check"></i>
                </div>
            </div>
        </div>
    </div>
</template>
