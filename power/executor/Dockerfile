FROM alpine:3.19

# curl is the only runtime dep (for egress probe attempt)
RUN apk add --no-cache curl

# Non-root executor user
RUN addgroup -g 1001 executor \
 && adduser -D -u 1001 -G executor executor

# Output mount point — host mounts a fresh directory here
RUN mkdir -p /mnt/session/outputs \
 && chown executor:executor /mnt/session/outputs

# Fixed diagnostic program — not model-supplied
COPY run-isolation-probe.sh /usr/local/bin/run-isolation-probe.sh
RUN chmod 555 /usr/local/bin/run-isolation-probe.sh

USER executor

ENTRYPOINT ["/usr/local/bin/run-isolation-probe.sh"]
