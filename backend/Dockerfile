FROM node:20-alpine

WORKDIR /app/backend

# Install OpenSSL and libc6-compat for Prisma engine on Alpine
RUN apk add --no-cache openssl libc6-compat

# Copy package files
COPY backend/package*.json ./

# Install dependencies
RUN npm ci

# Copy Prisma schema and migrations
COPY backend/prisma ./prisma

# Generate Prisma Client
RUN npx prisma generate

# Copy source code and config
COPY backend/tsconfig.json ./
COPY backend/src ./src
COPY backend/scripts ./scripts


# Compile TypeScript
RUN npm run build

EXPOSE 4000

ENV NODE_ENV=production
ENV API_PORT=4000

# Wait for DB, run pending migrations, and start the API
CMD ["sh", "-c", "npx tsx scripts/wait-for-db.ts && npx prisma migrate deploy && node dist/index.js"]
