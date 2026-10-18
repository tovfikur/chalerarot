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
