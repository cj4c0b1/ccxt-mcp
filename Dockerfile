# Use Node.js LTS
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Create config directory
RUN mkdir -p /root/.config/ccxt

# Copy source code
COPY . .
# Copying the repo above already includes the config if present in the context,
# but we do NOT want to bake user credentials into the image. The runtime
# configuration should be provided via bind-mount (docker-compose or docker run).

# Create a symlink to the config file in the expected location
RUN mkdir -p /root/.config/Claude && \
    # Ensure /root/.config/ccxt is present; prefer the runtime-mounted XDG path
    mkdir -p /root/.config/ccxt && \
    # Point Claude's expected config to the XDG CCXT config location inside the container
    ln -sf /root/.config/ccxt/ccxt-accounts.json /root/.config/Claude/claude_desktop_config.json

# Expose the port the app runs on
EXPOSE 3000

# Set default environment variables
ENV NODE_ENV=production
ENV CCXT_DEFAULT_TYPE=spot

# Command to run the application
CMD ["npm", "run", "dev"]
