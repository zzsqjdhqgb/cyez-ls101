FROM node:24.19.0-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03

ARG DEBIAN_SNAPSHOT=20260801T000000Z

ENV LANG=en_US.UTF-8 \
    LC_ALL=en_US.UTF-8 \
    TZ=Etc/UTC \
    DISPLAY=:99 \
    XDG_RUNTIME_DIR=/tmp/ls101-product-docs-runtime \
    GDK_BACKEND=x11 \
    GDK_SCALE=1 \
    GDK_DPI_SCALE=1 \
    QT_QPA_PLATFORM=xcb \
    QT_SCALE_FACTOR=1 \
    LIBGL_ALWAYS_SOFTWARE=1 \
    MESA_LOADER_DRIVER_OVERRIDE=llvmpipe \
    NO_AT_BRIDGE=1 \
    CI=1 \
    LS101_SETUP_MODE=product-docs \
    YARN_ENABLE_GLOBAL_CACHE=true \
    YARN_GLOBAL_FOLDER=/yarn/cache

RUN set -eux; \
    rm -f /etc/apt/sources.list /etc/apt/sources.list.d/*; \
    printf '%s\n' \
      "deb http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}/ bookworm main" \
      "deb http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}/ bookworm-updates main" \
      "deb http://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT}/ bookworm-security main" \
      > /etc/apt/sources.list; \
    printf '%s\n' \
      'Acquire::Check-Valid-Until "false";' \
      'Acquire::Retries "3";' \
      > /etc/apt/apt.conf.d/99snapshot; \
    apt-get update; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates \
      fontconfig \
      fonts-inter \
      fonts-liberation \
      fonts-noto-cjk \
      fonts-noto-core \
      git \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libatspi2.0-0 \
      libcairo2 \
      libcups2 \
      libdbus-1-3 \
      libdrm2 \
      libgbm1 \
      libgl1-mesa-dri \
      libglib2.0-0 \
      libgtk-3-0 \
      libnspr4 \
      libnss3 \
      libpango-1.0-0 \
      libx11-6 \
      libx11-xcb1 \
      libxcb1 \
      libxcomposite1 \
      libxdamage1 \
      libxext6 \
      libxfixes3 \
      libxkbcommon0 \
      libxrandr2 \
      libxss1 \
      locales \
      tzdata \
      x11-utils \
      xauth \
      xvfb; \
    sed -i 's/^# *en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen; \
    locale-gen; \
    ln -snf /usr/share/zoneinfo/Etc/UTC /etc/localtime; \
    printf '%s\n' 'Etc/UTC' > /etc/timezone; \
    rm -rf /var/lib/apt/lists/*

COPY docker/product-docs/fonts.conf /etc/fonts/local.conf
COPY docker/product-docs/renderer-version /etc/ls101-product-docs-renderer-version

RUN set -eux; \
    chmod 0444 /etc/ls101-product-docs-renderer-version /etc/fonts/local.conf; \
    mkdir -p "$XDG_RUNTIME_DIR" /yarn/cache; \
    chmod 0700 "$XDG_RUNTIME_DIR"; \
    fc-cache -f; \
    corepack enable; \
    corepack prepare yarn@4.15.0 --activate

WORKDIR /workspace
ENTRYPOINT ["node", "scripts/product-docs/container-runner.mjs"]
