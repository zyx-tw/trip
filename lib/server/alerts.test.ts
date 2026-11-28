import { describe, expect, test } from "bun:test"
import { parseAlerts } from "./alerts"

/** A length-delimited protobuf field. */
const field = (n: number, body: Uint8Array | string) => {
  const b = typeof body === "string" ? new TextEncoder().encode(body) : body
  const length: number[] = []
  for (let v = b.length; ; v >>= 7) {
    length.push(v > 0x7f ? (v & 0x7f) | 0x80 : v)
    if (v <= 0x7f) break
  }
  return new Uint8Array([(n << 3) | 2, ...length, ...b])
}
const join = (...parts: Uint8Array[]) => new Uint8Array(parts.flatMap((p) => [...p]))
const text = (ja: string, en: string) =>
  join(field(1, join(field(1, en), field(2, "en"))), field(1, join(field(1, ja), field(2, "ja"))))

describe("parseAlerts", () => {
  test("maps each informed route to the Japanese header and text", () => {
    const alert = join(
      field(5, field(2, "TokyoMetro.Hanzomon")),
      field(5, field(2, "TokyoMetro.Ginza")),
      // A varint field (cause) in between must be skipped.
      new Uint8Array([6 << 3, 1]),
      field(10, text("一部列車遅延", "Some trains delayed")),
      field(11, text("遅れが出ています。", "Delays."))
    )
    const feed = join(field(1, field(1, "2.0")), field(2, join(field(1, "a1"), field(5, alert))))
    const out = parseAlerts(feed)
    expect(out.get("TokyoMetro.Hanzomon")).toEqual({ title: "一部列車遅延", text: "遅れが出ています。" })
    expect(out.get("TokyoMetro.Ginza")?.title).toBe("一部列車遅延")
    expect(out.size).toBe(2)
  })
  test("throws on a cut-off message", () => {
    expect(() => parseAlerts(new Uint8Array([2 << 3 | 2, 10, 1]))).toThrow()
  })
})
