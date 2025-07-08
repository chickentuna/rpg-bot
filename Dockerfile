FROM node:22

# Packages
WORKDIR /home/bot
COPY package.json .
COPY package-lock.json .

# NPM dependencies
RUN npm i

# Builds
COPY src ./src
COPY tsconfig.json .

# Run bot
ENTRYPOINT [ "npm", "run", "prod" ]