// 官网只做两件事：复制校验和、给 404 一个返回入口。没有统计、没有第三方脚本。
for (const button of document.querySelectorAll('.copy')) {
  button.addEventListener('click', async () => {
    const value = button.dataset.copy ?? ''
    if (!value) {
      button.textContent = '构建后生成'
      return
    }
    try {
      await navigator.clipboard.writeText(value)
      const original = button.textContent
      button.textContent = '已复制'
      setTimeout(() => {
        button.textContent = original
      }, 1600)
    } catch {
      // 剪贴板被浏览器拒绝时，至少把校验和选中，用户按 Ctrl+C 即可
      const code = button.closest('.checksum')?.querySelector('code')
      if (!code) {
        button.textContent = '复制失败，请手动选中'
        return
      }
      const range = document.createRange()
      range.selectNodeContents(code)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      button.textContent = '已选中，按 Ctrl+C'
    }
  })
}
