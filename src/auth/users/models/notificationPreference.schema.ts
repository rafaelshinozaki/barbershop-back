// src\auth\users\models\notificationPreference.schema.ts
export class NotificationPreferenceSchema {
  newsEmail: boolean;
  newsInApp: boolean;
  promotionsEmail: boolean;
  promotionsInApp: boolean;
  securityEmail: boolean;
  securityInApp: boolean;
  instabilityEmail: boolean;
  instabilityInApp: boolean;
  appointmentsEmail: boolean;
  appointmentsInApp: boolean;
  salesEmail: boolean;
  salesInApp: boolean;
  inventoryEmail: boolean;
  inventoryInApp: boolean;
  teamEmail: boolean;
  teamInApp: boolean;
  reviewsEmail: boolean;
  reviewsInApp: boolean;
}
