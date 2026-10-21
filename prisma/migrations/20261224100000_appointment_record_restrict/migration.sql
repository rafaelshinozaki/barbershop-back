-- Avaliação, nota, caixinha, taxa de falta e conversa não somem junto com o horário.
ALTER TABLE "NoShowFee" DROP CONSTRAINT "NoShowFee_appointmentId_fkey";
ALTER TABLE "NoShowFee" ADD CONSTRAINT "NoShowFee_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProfessionalReview" DROP CONSTRAINT "ProfessionalReview_appointmentId_fkey";
ALTER TABLE "ProfessionalReview" ADD CONSTRAINT "ProfessionalReview_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerRating" DROP CONSTRAINT "CustomerRating_appointmentId_fkey";
ALTER TABLE "CustomerRating" ADD CONSTRAINT "CustomerRating_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AppointmentTip" DROP CONSTRAINT "AppointmentTip_appointmentId_fkey";
ALTER TABLE "AppointmentTip" ADD CONSTRAINT "AppointmentTip_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ChatThread" DROP CONSTRAINT "ChatThread_appointmentId_fkey";
ALTER TABLE "ChatThread" ADD CONSTRAINT "ChatThread_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
