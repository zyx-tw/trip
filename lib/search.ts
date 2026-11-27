import { CATEGORY_LABEL, type Place } from "./types"

/** Folds width, case and kana so ｶﾌｪ, カフェ and かふぇ compare equal. */
export function fold(text: string) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u3041-\u3096]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) + 0x60)
    )
}

/** True when every letter of `needle` appears in `hay` in order. */
function inOrder(needle: string, hay: string) {
  let i = 0
  for (const c of hay) if (c === needle[i]) i++
  return i === needle.length
}

/**
 * Loose search: every word of the query must appear in the place's names,
 * address, note or category, or its letters in order in one of the names,
 * so a typo or a skipped letter still finds the place.
 */
export function matches(place: Place, query: string) {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const names = [fold(place.name), fold(place.nameZh)]
  const all = [
    ...names,
    fold(place.address),
    fold(place.note),
    CATEGORY_LABEL[place.category],
  ].join(" ")
  return words.every(
    (w) => all.includes(w) || (w.length > 1 && names.some((n) => inOrder(w, n)))
  )
}
