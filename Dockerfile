FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx tsc

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
CMD ["sh", "-c", "if [ \"$MODE\" = \"small_live\" ]; then node dist/run-small-live.js; elif [ \"$MODE\" = \"shadow\" ]; then node dist/run-shadow.js; else node dist/run-paper.js; fi"]
