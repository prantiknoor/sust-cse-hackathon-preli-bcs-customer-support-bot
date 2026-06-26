# Stage 1: Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml tsconfig.json ./

# Install all dependencies (including devDependencies to run build)
RUN pnpm install --frozen-lockfile

# Copy src directory
COPY src/ ./src/

# Compile TypeScript
RUN pnpm build

# Stage 2: Production runtime stage
FROM node:22-alpine AS runner

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy production package files
COPY package.json pnpm-lock.yaml ./

# Install only production dependencies
RUN pnpm install --prod --frozen-lockfile

# Copy compiled JavaScript from builder
COPY --from=builder /app/dist ./dist

# Set defaults
ENV PORT=8000
ENV NODE_ENV=production

# Expose the port (this binds to the PORT env variable at runtime)
EXPOSE 8000

# Start server
CMD ["pnpm", "start"]
