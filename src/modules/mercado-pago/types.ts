export type MercadoPagoProviderKind = "pix" | "card"

export type MercadoPagoOptions = {
  accessToken: string
  webhookSecret: string
  webhookBaseUrl: string
  apiUrl?: string
  requestTimeoutMs?: number
  webhookToleranceSeconds?: number
  liveMode: boolean
  maxRetries?: number
  retryDelayMs?: number
}

export type MercadoPagoPayerIdentification = {
  type: string
  number: string
}

export type MercadoPagoSessionInput = {
  session_id?: string
  payment_collection_id?: string
  token?: string
  payment_method_id?: string
  installments?: number
  issuer_id?: number | string
  payer_email?: string
  payer_identification?: MercadoPagoPayerIdentification
  description?: string
}

export type MercadoPagoCreatePayment = {
  transaction_amount: number
  description?: string
  payment_method_id: string
  token?: string
  installments?: number
  issuer_id?: number
  capture: boolean
  external_reference: string
  notification_url: string
  payer: {
    email: string
    identification?: MercadoPagoPayerIdentification
  }
  metadata: {
    payment_session_id: string
    payment_collection_id: string
    provider_kind: MercadoPagoProviderKind
    request_fingerprint: string
  }
}

export type MercadoPagoPayment = {
  id: number | string
  status: string
  status_detail?: string | null
  transaction_amount: number
  currency_id: string
  external_reference?: string | null
  payment_method_id?: string | null
  payment_type_id?: string | null
  live_mode?: boolean
  captured?: boolean
  transaction_amount_refunded?: number
  date_of_expiration?: string | null
  point_of_interaction?: {
    transaction_data?: {
      qr_code?: string | null
      qr_code_base64?: string | null
      ticket_url?: string | null
    } | null
  } | null
  metadata?: Record<string, unknown> | null
}

export type MercadoPagoSessionData = {
  id: string
  session_id: string
  payment_collection_id: string
  provider_kind: MercadoPagoProviderKind
  status: string
  status_detail?: string
  transaction_amount: number
  currency_id: string
  payment_method_id?: string
  payment_type_id?: string
  live_mode: boolean
  date_of_expiration?: string
  request_fingerprint: string
  token?: null
  payer_email?: null
  payer_identification?: null
  point_of_interaction?: {
    transaction_data?: {
      qr_code?: string
      qr_code_base64?: string
      ticket_url?: string
    }
  }
}

export type MercadoPagoPaymentSearchResult = {
  results?: MercadoPagoPayment[]
  paging?: {
    total?: number
  }
}

export type MercadoPagoRefund = {
  id?: number | string
  payment_id?: number | string
  amount?: number
  status?: string
}

export type MercadoPagoAccount = {
  nickname?: string
  tags?: string[]
}

export type MercadoPagoWebhookBody = {
  type?: string
  topic?: string
  action?: string
  data?: {
    id?: string | number
  }
  data_id?: string | number
}
