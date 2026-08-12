export async function compressImageDataUrl(dataUrl, maxDim = 640, quality = 0.72) {
  try {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) return dataUrl
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('img'))
      el.src = dataUrl
    })
    if ((img.naturalWidth <= maxDim && img.naturalHeight <= maxDim) && dataUrl.length < 200000) return dataUrl
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    return canvas.toDataURL('image/jpeg', quality)
  } catch {
    return dataUrl
  }
}

export function capPhotoSize(str, maxLen = 120000) {
  if (typeof str !== 'string') return str
  return str.length > maxLen ? '' : str
}