# Chaler Arot (চালের আড়ত)

Inventory, Purchase, Sale and Expense Management System for Rice Wholesale Business (চালের আড়ত ম্যানেজমেন্ট সফটওয়্যার).

## Features
- **স্টক ও মজুদ হিসাব (Inventory Management)**: চালের বিভিন্ন প্রকার ও বস্তা অনুযায়ী স্টক ট্র্যাকিং।
- **বিক্রয় ও চালান (Sales & Billing)**: কাস্টমারদের চাল বিক্রয় এবং চালান তৈরি।
- **ক্রয় ও মহাজন হিসাব (Purchase Management)**: মিল ও সরবরাহকারীদের থেকে চাল ক্রয় হিসাব।
- **দৈনন্দিন খরচ (Expense Management)**: আড়তের খরচ ও দৈনিক হিসাব সংরক্ষণ।
- **বাংলা ইন্টারফেস (Bengali UI)**: সহজে ব্যবহারের জন্য বাংলা ভাষাভিত্তিক ড্যাশবোর্ড।

## Tech Stack
- **Frontend**: React Native, Expo, React Native Web, TypeScript
- **Backend**: Node.js, Express, TypeScript, Prisma ORM, PostgreSQL
- **Containerization**: Docker, Docker Compose, Nginx

## Getting Started

### Login and users

No default login is seeded. Create the first administrator through the
`POST /api/auth/setup` endpoint (name, phone, email and a password of at least
10 characters); it closes permanently once an account exists. Users then log in
with their email address and password. Settings contains My Profile,
password changes, logout, and an administrator-only Users section to create,
edit or deactivate users and reset their passwords. Staff can use operational
features but cannot manage users or change business settings.

Passwords are salted and hashed with scrypt. HttpOnly sessions expire after
12 hours; password changes, user edits and deactivation revoke prior sessions.
Use HTTPS for production (production cookies are Secure), and set `APP_ORIGINS`
to the frontend origin. The production web app and API should share one origin.

Authentication verification: `node scripts/verify-auth.cjs`. Set
`VERIFY_AUTH_DATABASE_URL`, `VERIFY_AUTH_API_URL` (ending in `/api`) and
`VERIFY_AUTH_WEB_URL` to an isolated, running test environment with no users.
The check creates temporary users and removes them afterward.

### Prerequisites
- Node.js (v18+)
- Docker & Docker Compose (optional for containerized setup)

### Local Development

1. **Frontend Setup**:
   ```bash
   npm install
   npx expo start
   ```

2. **Backend Setup**:
   ```bash
   cd backend
   npm install
   npx prisma migrate dev
   npm run dev
   ```

3. **Docker Deployment**:
   ```bash
   docker compose up -d --build
   ```
   - **Frontend**: http://localhost:3001 (configurable via `FRONTEND_PORT`)
   - **Backend API**: http://localhost:4000/api
   - **PostgreSQL**: localhost:5432

