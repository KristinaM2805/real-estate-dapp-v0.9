FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY server.mjs ./
EXPOSE 3002
CMD ["node", "server.mjs"]
