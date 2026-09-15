import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260915143000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "mercado_pago_attempt" (
        "id" text not null,
        "payment_session_id" text not null,
        "payment_collection_id" text not null,
        "provider_kind" text check ("provider_kind" in ('pix', 'card')) not null,
        "request_fingerprint" text not null,
        "idempotency_key" text not null,
        "amount" numeric not null,
        "raw_amount" jsonb not null,
        "currency_code" text not null,
        "state" text check ("state" in ('creating', 'bound', 'remote_found', 'compensated', 'resolved_terminal', 'manual_review')) not null,
        "reconcile_after" timestamptz not null,
        "remote_payment_id" text null,
        "remote_status" text null,
        "three_ds_info" jsonb null,
        "last_error_code" text null,
        "reconciliation_attempts" integer not null default 0,
        "last_reconciled_at" timestamptz null,
        "bound_at" timestamptz null,
        "compensated_at" timestamptz null,
        "manual_review_at" timestamptz null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "mercado_pago_attempt_pkey" primary key ("id")
      );
    `)
    this.addSql(
      'create index if not exists "IDX_mp_attempt_collection_state" on "mercado_pago_attempt" ("payment_collection_id", "state") where "deleted_at" is null;'
    )
    this.addSql(
      'create index if not exists "IDX_mp_attempt_reconcile_after" on "mercado_pago_attempt" ("reconcile_after") where "deleted_at" is null;'
    )
    this.addSql(
      'create index if not exists "IDX_mp_attempt_remote_payment" on "mercado_pago_attempt" ("remote_payment_id") where "deleted_at" is null;'
    )
    this.addSql(
      'create index if not exists "IDX_mp_attempt_deleted_at" on "mercado_pago_attempt" ("deleted_at") where "deleted_at" is not null;'
    )
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "mercado_pago_attempt" cascade;')
  }
}
