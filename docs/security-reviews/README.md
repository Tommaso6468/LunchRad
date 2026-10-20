# Security reviews

One file per milestone (`M0.md`, `M1.md`, …), written at the end of the
milestone. A milestone is not done until its review is merged.

## Gate checklist

Copy this into each review and fill it in.

- [ ] Threat model updated for features added in this milestone
- [ ] Every new endpoint/message: auth check, role check, Zod schema, rate limit, size limit
- [ ] Abuse tests written: wrong role, wrong room, oversized payload, flood, replayed token, expired room
- [ ] CI clean: no high/critical SAST or dependency findings open
- [ ] Security headers verified on staging (Mozilla Observatory)
- [ ] OWASP ZAP baseline scan against staging, findings triaged
- [ ] Logs reviewed: no tokens, keys or full IPs
- [ ] Findings fixed or documented as accepted risk with a reason
- [ ] Short written assessment: what changed, what was tested, residual risk
