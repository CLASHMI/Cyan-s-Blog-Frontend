<script setup>
import { onMounted, onUnmounted, ref } from 'vue'

const canvas = ref(null)
let cleanup = () => {}

onMounted(() => {
  const surface = canvas.value
  const context = surface.getContext('2d', { alpha: true })
  if (!context) return
  const motion = matchMedia('(prefers-reduced-motion: reduce)')
  const pointer = matchMedia('(any-hover: hover) and (any-pointer: fine)')
  // 小精灵预绘一次；逐帧不做 shadowBlur，不创建 DOM，也不更新 Vue 状态。
  const sprite = document.createElement('canvas')
  sprite.width = sprite.height = 20
  const brush = sprite.getContext('2d')
  if (!brush) return
  const glow = brush.createRadialGradient(10, 10, 0, 10, 10, 10)
  glow.addColorStop(0, '#00FFFF')
  glow.addColorStop(.18, 'rgba(0,255,255,.65)')
  glow.addColorStop(1, 'rgba(0,255,255,0)')
  brush.fillStyle = glow
  brush.fillRect(0, 0, 20, 20)
  let particles = []
  let frame = 0
  let lastSpawn = 0
  let previous = null
  const stop = () => {
    cancelAnimationFrame(frame)
    frame = 0
    particles = []
    previous = null
    context.clearRect(0, 0, surface.width, surface.height)
  }
  const resize = () => {
    stop()
    // 装饰层按 CSS 像素绘制，避免高 DPI 下全屏画布成倍膨胀。
    surface.width = window.innerWidth
    surface.height = window.innerHeight
  }
  const draw = (now) => {
    context.clearRect(0, 0, surface.width, surface.height)
    particles = particles.filter(p => now - p.born < p.life)
    for (const p of particles) {
      const age = (now - p.born) / p.life
      context.globalAlpha = (1 - age) ** 2 * .55
      const size = p.size * (1 - age * .4)
      context.drawImage(sprite, p.x + p.dx * age - size / 2, p.y + 14 * age - size / 2, size, size)
    }
    frame = particles.length ? requestAnimationFrame(draw) : 0
  }
  const move = (event) => {
    if (event.pointerType !== 'mouse' || event.buttons || motion.matches || !pointer.matches || document.hidden) return
    const now = performance.now()
    if (now - lastSpawn < 28) return
    if (previous && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 4) return
    lastSpawn = now
    previous = { x: event.clientX, y: event.clientY }
    if (particles.length >= 24) particles.shift()
    particles.push({ ...previous, born: now, life: 480 + Math.random() * 220, size: 8 + Math.random() * 7, dx: (Math.random() - .5) * 18 })
    if (!frame) frame = requestAnimationFrame(draw)
  }
  const leave = (event) => { if (!event.relatedTarget) stop() }
  resize()
  window.addEventListener('resize', resize, { passive: true })
  window.addEventListener('pointermove', move, { passive: true })
  window.addEventListener('blur', stop)
  document.addEventListener('pointerout', leave)
  document.addEventListener('visibilitychange', stop)
  motion.addEventListener('change', stop)
  pointer.addEventListener('change', stop)
  cleanup = () => {
    stop()
    window.removeEventListener('resize', resize)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('blur', stop)
    document.removeEventListener('pointerout', leave)
    document.removeEventListener('visibilitychange', stop)
    motion.removeEventListener('change', stop)
    pointer.removeEventListener('change', stop)
  }
})
onUnmounted(() => cleanup())
</script>

<template>
  <canvas ref="canvas" class="cursor-particles" aria-hidden="true"></canvas>
</template>

<style scoped>
.cursor-particles { position: fixed; inset: 0; width: 100%; height: 100%; z-index: 120; pointer-events: none; }
@media (prefers-reduced-motion: reduce), (hover: none) {
  .cursor-particles { display: none; }
}
</style>
