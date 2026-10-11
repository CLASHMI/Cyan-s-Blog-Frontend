<script setup>
import { useUiStore } from '@/stores/useUiStore'

const uiStore = useUiStore()
</script>

<template>
  <Transition enter-from-class="opacity-0" leave-to-class="opacity-0">
    <div v-show="uiStore.dialogs.confirm" id="confirmDialog"
        class="art-scrim fixed inset-0 z-[300] transition-opacity duration-300"
        @click="uiStore.closeConfirm()">
        <div class="art-modal art-modal-sm art-modal-pad transition-transform duration-300"
            :class="uiStore.dialogs.confirm ? 'scale-100' : 'scale-95'" @click.stop>
            <div class="art-confirm">
                <div class="art-confirm-icon"><i class="ph-fill ph-warning-circle"></i></div>
                <h3 class="art-modal-title">确认操作</h3>
                <p id="confirmMsg" class="art-confirm-msg">{{ uiStore.confirmMessage }}</p>
                <div class="art-modal-foot">
                    <button @click="uiStore.closeConfirm()" class="art-btn art-btn-ghost">取消</button>
                    <button id="confirmBtn" @click="uiStore.runConfirm()" class="art-btn art-btn-danger">确认删除</button>
                </div>
            </div>
        </div>
    </div>
  </Transition>
</template>
