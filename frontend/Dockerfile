FROM node:22-alpine AS build

WORKDIR /app

ARG VITE_MARKET_ADDRESS
ARG VITE_ORACLE_ADDRESS

ENV VITE_MARKET_ADDRESS=$VITE_MARKET_ADDRESS
ENV VITE_ORACLE_ADDRESS=$VITE_ORACLE_ADDRESS

COPY package*.json ./
RUN npm install

COPY . .

RUN npm run build

FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]