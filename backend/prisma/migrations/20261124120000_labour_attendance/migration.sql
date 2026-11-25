CREATE TABLE "LabourAttendance" (
    "id" TEXT NOT NULL,
    "labourerId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LabourAttendance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LabourAttendance_labourerId_date_key" ON "LabourAttendance"("labourerId", "date");
CREATE INDEX "LabourAttendance_date_idx" ON "LabourAttendance"("date");
ALTER TABLE "LabourAttendance" ADD CONSTRAINT "LabourAttendance_labourerId_fkey" FOREIGN KEY ("labourerId") REFERENCES "Labourer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
