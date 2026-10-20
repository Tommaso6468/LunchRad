## What and why

<!-- One or two sentences. Link the milestone (M0–M8). -->

## Security checklist

- [ ] New endpoints/messages: auth check, role check, Zod schema, rate limit, size limit
- [ ] User text is rendered as text only (no raw HTML)
- [ ] No secrets, tokens or full IPs in code or logs
- [ ] Abuse cases tested (wrong role, wrong room, oversized payload, flood, expired room)
- [ ] Threat model updated if the attack surface changed

## How it was tested

<!-- Commands run, devices tried. -->
