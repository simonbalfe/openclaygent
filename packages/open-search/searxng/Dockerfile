FROM searxng/searxng:latest
COPY settings.yml /usr/local/share/openclaygent/searxng-settings.yml
COPY --chmod=755 entrypoint.sh /searxng-wrapper.sh
COPY proxy-check.py /searxng-proxy-check.py
ENTRYPOINT ["/bin/sh", "/searxng-wrapper.sh"]
