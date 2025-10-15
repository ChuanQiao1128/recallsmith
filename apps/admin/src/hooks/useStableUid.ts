function slugify(s: string) {
  return s.trim().toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
}

function fnv1a(str: string) {
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function useStableUid() {
  return (deckSlug: string, keyPoint: string, frontMd: string) => {
    const head = slugify(keyPoint || frontMd.split('\n')[0] || 'item')
    const h = fnv1a(`${keyPoint}\n${frontMd}`).slice(0,8)
    return `${slugify(deckSlug)}.${head}.${h}`
  }
}
