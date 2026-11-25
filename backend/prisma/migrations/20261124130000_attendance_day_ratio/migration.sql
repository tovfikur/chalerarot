ALTER TABLE "LabourAttendance" ADD COLUMN "value" DOUBLE PRECISION NOT NULL DEFAULT 1;
UPDATE "LabourAttendance" SET "value" = CASE WHEN "status" = 'absent' THEN 0 ELSE 1 END;
ALTER TABLE "LabourAttendance" DROP COLUMN "status";
