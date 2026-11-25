ALTER TABLE "LabourCost" ADD COLUMN "attendanceAutoKey" TEXT;
CREATE UNIQUE INDEX "LabourCost_attendanceAutoKey_key" ON "LabourCost"("attendanceAutoKey");
