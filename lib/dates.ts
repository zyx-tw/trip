const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"]

/** Month/day and the weekday in Chinese, for example for 2027-01-04. Dates are calendar days, so read them as UTC. */
export function formatDay(day: string) {
  const d = new Date(`${day}T00:00:00Z`)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} (${WEEKDAY[d.getUTCDay()]})`
}

export function formatRange(start: string, end: string) {
  const s = new Date(`${start}T00:00:00Z`)
  const e = new Date(`${end}T00:00:00Z`)
  const year = s.getUTCFullYear()
  return `${year}/${s.getUTCMonth() + 1}/${s.getUTCDate()} 到 ${e.getUTCMonth() + 1}/${e.getUTCDate()}`
}

/** Every day from start to end, inclusive. */
export function daysOf(start: string, end: string) {
  const out: string[] = []
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}
