import { createHmac, timingSafeEqual } from "node:crypto"

type HeaderValue = string | string[] | undefined

type ValidateSignatureInput = {
  signature: HeaderValue
  requestId: HeaderValue
  dataId: string | number | undefined
  secret: string
  toleranceSeconds: number
  now?: () => number
}

const normalize = (value: HeaderValue): string | undefined => {
  const first = Array.isArray(value) ? value[0] : value
  const trimmed = first?.trim()

  return trimmed || undefined
}

const parseSignature = (signature: string) => {
  const parts = signature.split(",").reduce<Record<string, string>>(
    (result, entry) => {
      const separator = entry.indexOf("=")

      if (separator === -1) {
        return result
      }

      const key = entry.slice(0, separator).trim().toLowerCase()
      const value = entry.slice(separator + 1).trim()

      if (key && value) {
        result[key] = value
      }

      return result
    },
    {}
  )

  return {
    timestamp: parts.ts,
    hash: parts.v1,
  }
}

export const validateMercadoPagoSignature = ({
  signature,
  requestId,
  dataId,
  secret,
  toleranceSeconds,
  now = Date.now,
}: ValidateSignatureInput): void => {
  const normalizedSignature = normalize(signature)
  const normalizedRequestId = normalize(requestId)
  const normalizedDataId =
    dataId === undefined || dataId === null
      ? undefined
      : String(dataId).trim().toLowerCase()

  if (!normalizedSignature || !normalizedRequestId || !normalizedDataId) {
    throw new Error("Invalid Mercado Pago webhook signature metadata")
  }

  const { timestamp, hash } = parseSignature(normalizedSignature)

  if (!timestamp || !hash || !/^\d+$/.test(timestamp)) {
    throw new Error("Malformed Mercado Pago webhook signature")
  }

  const numericTimestamp = Number(timestamp)
  const timestampMilliseconds =
    numericTimestamp >= 1_000_000_000_000
      ? numericTimestamp
      : numericTimestamp * 1000
  const driftSeconds = Math.abs(now() - timestampMilliseconds) / 1000

  if (!Number.isFinite(driftSeconds) || driftSeconds > toleranceSeconds) {
    throw new Error("Expired Mercado Pago webhook signature")
  }

  const manifest =
    `id:${normalizedDataId};` +
    `request-id:${normalizedRequestId};` +
    `ts:${timestamp};`
  const expected = createHmac("sha256", secret).update(manifest).digest("hex")
  const expectedBuffer = Buffer.from(expected, "utf8")
  const receivedBuffer = Buffer.from(hash, "utf8")

  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    throw new Error("Invalid Mercado Pago webhook signature")
  }
}
