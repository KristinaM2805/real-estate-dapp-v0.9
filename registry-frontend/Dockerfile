FROM node:22-alpine AS build
WORKDIR /app
ARG VITE_REGISTRY_API_URL
ENV VITE_REGISTRY_API_URL=$VITE_REGISTRY_API_URL
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
