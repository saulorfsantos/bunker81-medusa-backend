import {
  ContainerRegistrationKeys,
  Modules,
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"

const workflowRun = jest.fn()

jest.mock("@medusajs/medusa/core-flows", () => ({
  processPaymentWorkflow: () => ({ run: workflowRun }),
}))

import reconcilePendingMercadoPagoPix from "../mercado-pago-pix-reconciliation"

const baseSession = {
  id: "payses_pix_1",
  amount: 100,
  currency_code: "brl",
  data: { id: "mp_1" },
  status: PaymentSessionStatus.PENDING_AUTHORIZATION,
  provider_id: "pp_mercadopago-pix_mercadopago",
  payment_collection_id: "paycol_1",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
}

describe("Mercado Pago Pix reconciliation job", () => {
  beforeEach(() => {
    workflowRun.mockReset()
  })

  test("polls pending Pix and sends a captured result through Medusa", async () => {
    const paymentModule = {
      listPaymentSessions: jest.fn().mockResolvedValue([baseSession]),
      updatePaymentSession: jest.fn().mockResolvedValue({
        ...baseSession,
        status: PaymentSessionStatus.CAPTURED,
      }),
    }
    const logger = { info: jest.fn(), error: jest.fn() }
    const container = {
      resolve: jest.fn((key: string) => {
        if (key === Modules.PAYMENT) return paymentModule
        if (key === ContainerRegistrationKeys.LOGGER) return logger
        if (key === ContainerRegistrationKeys.QUERY) return { graph: jest.fn() }
        throw new Error(`Unexpected dependency: ${key}`)
      }),
    }

    await reconcilePendingMercadoPagoPix(container as never)

    expect(paymentModule.updatePaymentSession).toHaveBeenCalledWith({
      id: baseSession.id,
      amount: baseSession.amount,
      currency_code: baseSession.currency_code,
      data: baseSession.data,
    })
    expect(workflowRun).toHaveBeenCalledWith({
      input: {
        action: PaymentActions.SUCCESSFUL,
        data: { session_id: baseSession.id, amount: baseSession.amount },
      },
    })
  })

  test("refunds an old captured Pix when no order was created", async () => {
    const paidSession = {
      ...baseSession,
      status: PaymentSessionStatus.AUTHORIZED,
      updated_at: "2020-01-01T00:00:00.000Z",
    }
    const paymentModule = {
      listPaymentSessions: jest.fn().mockResolvedValue([paidSession]),
      retrievePaymentSession: jest.fn().mockResolvedValue({
        ...paidSession,
        payment: {
          id: "pay_1",
          amount: 100,
          refunded_amount: 0,
        },
      }),
      refundPayment: jest.fn().mockResolvedValue({}),
    }
    const query = {
      graph: jest
        .fn()
        .mockResolvedValueOnce({ data: [{ cart_id: "cart_1" }] })
        .mockResolvedValueOnce({ data: [] }),
    }
    const logger = { info: jest.fn(), error: jest.fn() }
    const container = {
      resolve: jest.fn((key: string) => {
        if (key === Modules.PAYMENT) return paymentModule
        if (key === ContainerRegistrationKeys.LOGGER) return logger
        if (key === ContainerRegistrationKeys.QUERY) return query
        throw new Error(`Unexpected dependency: ${key}`)
      }),
    }

    await reconcilePendingMercadoPagoPix(container as never)

    expect(paymentModule.refundPayment).toHaveBeenCalledWith({
      payment_id: "pay_1",
      amount: 100,
      note: "Automatic compensation: captured Pix without an order",
      metadata: { source: "mercado-pago-pix-reconciliation" },
    })
    expect(logger.error).not.toHaveBeenCalled()
  })
})
