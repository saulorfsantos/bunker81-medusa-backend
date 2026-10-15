// A dated opt-in prevents a deployment from charging historical test orders.
export function autoCaptureFrom(env = process.env): string | null {
  const value = env.MERCADO_PAGO_AUTO_CAPTURE_FROM
  if (!value) return null
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ||
      !Number.isFinite(Date.parse(value))) {
    throw new Error("MERCADO_PAGO_AUTO_CAPTURE_FROM must be an ISO UTC timestamp")
  }
  return new Date(value).toISOString()
}
