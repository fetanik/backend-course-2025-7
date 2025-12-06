FROM node:22

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN mkdir -p cache

EXPOSE 3000

CMD ["node", "main.js"]
