FROM node:24-alpine

WORKDIR /app

# Install dependencies first (layer caching)
COPY package*.json ./
RUN npm ci --only=production

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Create upload/output directories
RUN mkdir -p uploads outputs

EXPOSE 3000

CMD ["node", "dist/index.js"]