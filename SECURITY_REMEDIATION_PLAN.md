# RxConnect Voice Agent — Security Incident: Root Cause Analysis & Remediation Plan

**Date:** March 9, 2026
**AWS Account:** 396185571030
**Region:** us-east-2
**Instance:** i-0520223e45dc5dcd2 (ec2-13-59-97-24.us-east-2.compute.amazonaws.com)
**AWS Case:** 10267299015-1
**Status:** Instance shut down; pending deletion

---

## 1. Root Cause

The EC2 instance was running the RxConnect Voice Agent demo application with **Next.js 15.0.0**, which is vulnerable to **CVE-2025-55182** (CVSS 10.0) — a critical pre-authentication Remote Code Execution vulnerability in the React Server Components (RSC) "Flight" protocol, commonly referred to as **React2Shell**.

> **Note:** CVE-2025-66478 (the Next.js-specific advisory) has been rejected as a duplicate — CVE-2025-55182 is the canonical identifier covering both the React root cause and its manifestation in Next.js.

### What is CVE-2025-55182 (React2Shell)?

This is a **pre-authentication RCE** in the React Server Components (RSC) Flight Protocol, disclosed December 2025. It affects all Next.js 15.x applications using the App Router — even those that don't explicitly define Server Actions. According to [Wiz Research](https://www.wiz.io/blog/critical-vulnerability-in-react-cve-2025-55182), a standard `create-next-app` build is exploitable with **no code changes by the developer**, and exploitation has **near-100% reliability**.

**This is a widespread issue, not isolated to our environment.** Wiz data shows **39% of cloud environments** contained vulnerable instances. Active exploitation in the wild has been observed by Wiz Research, Amazon Threat Intelligence, GreyNoise, and Datadog since December 5, 2025, including credential harvesting, cryptocurrency mining, and Sliver malware deployment.

The attack works by:

1. Sending a crafted `multipart/form-data` POST request with a `next-action` header
2. Exploiting **prototype pollution** in the RSC deserialization layer (`Object.prototype.then`)
3. Gaining access to the JavaScript `Function` constructor
4. Executing arbitrary code on the server via `child_process.execSync`

**No authentication is required.** Any internet-facing Next.js 15.0.0 instance is exploitable. Default configurations are vulnerable out of the box.

### What happened to our instance

| Date | Event |
|------|-------|
| **Mar 4, 2026** | Application deployed with Next.js **15.0.0** (vulnerable) |
| **Mar 4, 2026** | Source code updated to Next.js 15.5.12 (patched), but running instance was **not redeployed** |
| **Mar 4–8** | Attacker exploited CVE-2025-55182, gained full shell access on the instance |
| **Mar 8, 2026 08:50 UTC** | AWS detected the compromised instance sending **outbound CVE-2025-55182 exploit payloads** (TCP 80/443) to 3.26.47.94 — the instance was weaponized as an attack launchpad |
| **Mar 8, 2026** | AWS blocked outgoing ports 80/443 to the target IP |
| **Mar 9, 2026** | Instance shut down by security team |

### Decoded attack payload from the AWS report

The base64 payload in the report decodes to a Next.js Server Actions exploit:

```
POST / HTTP/1.1
next-action: x
Content-Type: multipart/form-data

{"_response":{
  "_formData":{"get":"$1:constructor:constructor"},
  "_prefix":"var res = process.mainModule.require('child_process')
    .execSync('echo VULN_962516', ...)
    .toString(); throw Object.assign(new Error('NEXT_REDIRECT'), {digest:`${res}`});"
}}
```

This was sent **from** our instance (13.59.97.24) **to** external hosts — confirming the instance had already been compromised and was being used to attack others.

### Scope of compromise

Since the attacker had **arbitrary code execution** on the instance, assume:

- All environment variables were exfiltrated (API keys, AWS credentials) — Wiz Research confirmed attackers "harvest credentials from environment variables, filesystems, and cloud instance metadata" as standard post-exploitation for this CVE
- The instance was fully controlled — known post-exploitation payloads for this CVE include cryptominers (XMRig), persistent backdoors (Sliver malware framework), and scanners/worms that attack other hosts (which matches the outbound traffic AWS detected)
- Any data accessible from the instance's IAM role or network position may have been accessed
- AWS and Wiz have attributed some exploitation campaigns to China-nexus threat groups

---

## 2. Contributing Factors

Beyond the primary CVE, the following configuration weaknesses contributed to the severity:

| # | Issue | Risk | Current State |
|---|-------|------|---------------|
| 1 | **Next.js 15.0.0 deployed (unpatched)** | Critical | Patch for CVE-2025-55182 was available since Dec 2025; not applied to running instance |
| 2 | **No security group restrictions** | High | Instance ports were open to `0.0.0.0/0`, allowing direct exploitation from the internet |
| 3 | **No WAF or edge protection** | High | No AWS WAF, CloudFront, or similar filtering in front of the application |
| 4 | **CORS allows all origins** | Medium | Backend sets `allow_origins=["*"]` with `allow_credentials=True` |
| 5 | **No authentication on WebSocket endpoint** | Medium | `/ws/voice` accepts connections without any auth |
| 6 | **No security headers** | Medium | No CSP, HSTS, X-Frame-Options, or X-Content-Type-Options in Next.js or Nginx |
| 7 | **Self-signed SSL certificate** | Low | No trusted TLS; acceptable for internal demo only |
| 8 | **No CI/CD or automated dependency checks** | Medium | Manual deployment with no automated vulnerability scanning |

---

## 3. Remediation Plan

### Phase 1 — Immediate (before any redeployment)

| # | Action | Owner | Status |
|---|--------|-------|--------|
| 1.1 | **Terminate and delete the compromised EC2 instance** (i-0520223e45dc5dcd2), including EBS volumes, snapshots, and any AMIs created from it | Infra/Ehab | Instance shut down; pending deletion |
| 1.2 | **Rotate all secrets** that were on the instance: `OPENAI_API_KEY`, `DEEPGRAM_API_KEY`, any AWS IAM access keys or instance profile credentials | Dev/Security | **AWS IAM key rotated (Mar 9)**; Deepgram and OpenAI keys pending |
| 1.3 | **Audit AWS CloudTrail** in account 396185571030 / us-east-2 for unauthorized API calls originating from the instance role between Mar 4–9 (look for: new IAM entities, S3 access, SageMaker modifications, EC2 launches) | Security | Pending |
| 1.4 | **Revoke IAM instance profile** and recreate with least-privilege permissions | Security | **Old IAM key deactivated and deleted (Mar 9)**; new key created with least-privilege scope |

### Phase 2 — Application Fixes (code changes before redeployment)

| # | Action | Detail | Status |
|---|--------|--------|--------|
| 2.1 | **Pin Next.js to patched version** | Changed `"next": "^15.5.12"` → `"next": "15.5.12"` (exact pin, no caret). Confirmed patched against all 4 known CVEs. | **Done** |
| 2.2 | **Lock `eslint-config-next`** | Updated from `"15.0.0"` to `"15.5.12"` to match | **Done** |
| 2.3 | **Restrict CORS origins** | Removed wildcard `"*"` from `allow_origins`; now configurable via `ALLOWED_ORIGINS` env var, defaults to localhost only | **Done** |
| 2.4 | **Add security headers** | Added CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy via `next.config.js`; disabled `X-Powered-By` header | **Done** |
| 2.5 | **Add WebSocket authentication** | Added HMAC-signed short-lived token auth: client fetches token from `POST /api/token`, passes it as query param on WebSocket connect; server validates signature and 60s expiry before accepting | **Done** |
| 2.6 | **Use `npm ci` in deployment** | Ensure the lockfile is respected and exact patched versions are installed | Pending (for new deployment) |

### Phase 3 — Infrastructure Hardening (new deployment)

| # | Action | Detail |
|---|--------|--------|
| 3.1 | **Restrict security groups** | Allow inbound only on 443 from known IP ranges or via load balancer; no direct 0.0.0.0/0 access to the instance |
| 3.2 | **Place behind ALB + AWS WAF** | Use an Application Load Balancer with AWS WAF rules (or equivalent) to filter malicious payloads before they reach the application |
| 3.3 | **Use ACM certificate** | Replace self-signed cert with AWS Certificate Manager for proper TLS |
| 3.4 | **Enable VPC Flow Logs and GuardDuty** | Detect anomalous outbound traffic earlier |
| 3.5 | **Add automated dependency scanning** | Integrate `npm audit` / Dependabot / Snyk into a CI pipeline to catch future CVEs before deployment |
| 3.6 | **Principle of least privilege for IAM** | Instance role should only have permissions needed (SageMaker InvokeEndpoint in us-east-2, nothing else) |

---

## 4. Verification Checklist (pre-deployment sign-off)

- [ ] Compromised instance fully deleted (EC2, EBS, snapshots, AMIs)
- [x] AWS IAM access key rotated (old key deactivated + deleted, new key created)
- [ ] Deepgram and OpenAI API keys rotated and verified working
- [ ] CloudTrail audit complete, no evidence of lateral movement
- [x] `npx fix-react2shell-next` reports **no vulnerabilities** (verified Mar 9)
- [x] `npm audit` reports **0 vulnerabilities** (verified Mar 9)
- [x] CORS restricted to specific origins (no wildcard) — configurable via `ALLOWED_ORIGINS` env var
- [x] Security headers present (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy)
- [ ] Security group restricts inbound to 443 only from ALB/known IPs
- [ ] WAF rules deployed in front of the application
- [x] WebSocket endpoint requires authentication (HMAC token, 60s TTL)
- [ ] CI pipeline includes automated dependency vulnerability scanning

---

## 5. References

- [React2Shell (CVE-2025-55182): Critical React Vulnerability — Wiz Research](https://www.wiz.io/blog/critical-vulnerability-in-react-cve-2025-55182) — primary reference; includes exploitation timeline, affected products, in-the-wild observations, and cloud environment statistics
- [CVE-2025-55182: React2Shell Deep Dive — Wiz Research](https://www.wiz.io/blog/nextjs-cve-2025-55182-react2shell-deep-dive) — full technical exploit analysis and post-exploitation IOCs
- [Next.js Security Update: December 11, 2025](https://nextjs.org/blog/security-update-2025-12-11) — Vercel's advisory with patched versions
- [CVE-2025-55182 Exploit Analysis — Akamai](https://www.akamai.com/blog/security-research/2025/dec/cve-2025-55182-react-nextjs-server-functions-deserialization-rce)
- [AWS Acceptable Use Policy](https://aws.amazon.com/aup/)
