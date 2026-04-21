FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive

# Slim images often lack a service manager; postinst scripts that call invoke-rc.d
# can otherwise make apt exit non-zero (e.g. exit 5) even when packages unpacked.
RUN printf '%s\n' '#!/bin/sh' 'exit 0' > /usr/sbin/policy-rc.d \
  && chmod +x /usr/sbin/policy-rc.d

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    libatomic1 \
    ffmpeg \
    python3 \
    python3-pip \
    fonts-noto \
    fonts-arabeyes \
  && rm -rf /var/lib/apt/lists/* \
  && PIP_BREAK_SYSTEM_PACKAGES=1 pip3 install --no-cache-dir yt-dlp \
  && yt-dlp --version

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

CMD ["node", "worker.js"]
