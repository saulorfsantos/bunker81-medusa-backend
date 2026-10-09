import type {
  SubscriberArgs,
  SubscriberConfig,
} from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { readResendConfig } from "../modules/resend/config"

interface PasswordResetEvent {
  entity_id: string
  token: string
  actor_type: string
}

export function buildCustomerResetUrl(
  storefrontUrl: string,
  token: string,
  email: string
): string {
  const url = new URL("/reset-password", storefrontUrl)
  url.searchParams.set("token", token)
  url.searchParams.set("email", email)
  return url.toString()
}

export default async function passwordResetHandler({
  event: { data },
  container,
}: SubscriberArgs<PasswordResetEvent>) {
  if (data.actor_type !== "customer") return

  const resendConfig = readResendConfig(process.env)
  if (!resendConfig) {
    throw new Error(
      "Customer password reset email requires RESEND_API_KEY, RESEND_FROM, and STOREFRONT_URL"
    )
  }

  const notificationModuleService = container.resolve(Modules.NOTIFICATION)
  await notificationModuleService.createNotifications({
    to: data.entity_id,
    channel: "email",
    template: "customer-password-reset",
    data: {
      email: data.entity_id,
      reset_url: buildCustomerResetUrl(
        resendConfig.storefront_url,
        data.token,
        data.entity_id
      ),
    },
  })
}

export const config: SubscriberConfig = {
  event: "auth.password_reset",
  context: {
    subscriberId: "bunker-customer-password-reset-email",
  },
}
