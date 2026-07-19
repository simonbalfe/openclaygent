FROM searxng/searxng:latest
COPY settings.yml /etc/searxng/settings.template.yml
COPY --chmod=755 entrypoint.sh /searxng-wrapper.sh
ENTRYPOINT ["/bin/sh", "/searxng-wrapper.sh"]
