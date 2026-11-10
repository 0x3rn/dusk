// lib/engine/engine.ts
// Assembles the dead-man's-switch services over PostgreSQL and the real notification providers.
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import { getServerEnv } from "../env";
import { createNotificationProviders } from "../providers/notification-providers";
import { CheckInScheduleService } from "../services/checkin-schedule-service";
import { EscalationService, type NotificationSenderPort } from "../services/escalation-service";
import {
  NotificationAndAuditService,
  type ExternalNotificationProviderPort,
} from "../services/notification-audit-service";
import { PrismaEngineStore } from "../services/prisma-engine-store";
import { PrismaNotificationStore } from "../services/prisma-notification-store";
import { ReleaseDeliveryService } from "../services/release-delivery-service";
import { ReleaseVerificationService } from "../services/release-verification-service";
import { renderEmail, renderSms } from "../notifications/templates";

export interface Engine {
  db: PrismaClient;
  store: PrismaEngineStore;
  providers: ExternalNotificationProviderPort;
  checkIn: CheckInScheduleService;
  verification: ReleaseVerificationService;
  delivery: ReleaseDeliveryService;
  notifier: NotificationAndAuditService;
  escalation(sender?: NotificationSenderPort): EscalationService;
  appUrl: string;
}

export function createEngine(overrides: {
  db?: PrismaClient;
  providers?: ExternalNotificationProviderPort;
  appUrl?: string;
} = {}): Engine {
  const db = overrides.db ?? prisma;
  const env = overrides.providers ? null : getServerEnv();
  const appUrl = overrides.appUrl ?? env?.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const providers =
    overrides.providers ??
    createNotificationProviders({
      resendApiKey: env?.RESEND_API_KEY,
      resendFromEmail: env?.RESEND_FROM_EMAIL,
      twilioAccountSid: env?.TWILIO_ACCOUNT_SID,
      twilioAuthToken: env?.TWILIO_AUTH_TOKEN,
      twilioPhoneNumber: env?.TWILIO_PHONE_NUMBER,
      appUrl,
    });

  const store = new PrismaEngineStore(db);
  return {
    db,
    store,
    providers,
    checkIn: new CheckInScheduleService(store),
    verification: new ReleaseVerificationService(store),
    delivery: new ReleaseDeliveryService(store),
    notifier: new NotificationAndAuditService(new PrismaNotificationStore(db), providers),
    escalation: (sender) => new EscalationService(store, sender),
    appUrl,
  };
}

/**
 * Adapts the providers to the escalation service's sender port, attaching the one-click
 * check-in link to the email. SMS stays link-free by design.
 */
export function reminderSender(
  providers: ExternalNotificationProviderPort,
  params: { actionUrl: string; recipientName: string | null; appUrl: string; escalated: boolean }
): NotificationSenderPort {
  const templateKey = params.escalated ? "MISSED_CHECKIN_ESCALATION" : "CHECKIN_REMINDER";
  return {
    async sendEmail({ to }) {
      const res = await providers.sendEmail({
        to,
        subject: renderEmail(templateKey, {}).subject,
        templateKey,
        safeVariables: { actionUrl: params.actionUrl, recipientName: params.recipientName },
      });
      return { delivered: res.ok, error: res.error };
    },
    async sendSms({ to }) {
      const res = await providers.sendSms({
        to,
        body: renderSms(templateKey, params.appUrl),
        templateKey,
      });
      return { delivered: res.ok, error: res.error };
    },
  };
}
