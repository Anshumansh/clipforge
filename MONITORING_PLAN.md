# Clipforge Production Monitoring Plan

**Version:** 1.0  
**Date:** 2026-08-13  
**Status:** Ready for implementation  
**SLA Targets:** p95 <800ms, error rate <1%, queue depth <50

---

## 1. Architecture Overview

### Metrics Collection
- **Source:** `/internal/metrics` endpoint (protected by bearer token)
- **Format:** Prometheus text format (v0.0.4)
- **Scrape Interval:** 30 seconds
- **Authentication:** Bearer token via `Authorization` header
- **Security:** Timing-safe comparison, no customer PII exposed

### Storage
- **Local Prometheus:** Recommended for production
- **Retention:** 30 days
- **Database:** Time-series DB on separate volume
- **Backup:** Daily snapshots to B2 storage

### Visualization
- **Grafana:** Local instance (not SaaS)
- **Dashboards:** 4 provisioned via JSON
- **Alerts:** Email + Slack (webhooks configured)

---

## 2. Prometheus Configuration

### Setup

```yaml
# /etc/prometheus/prometheus.yml
global:
  scrape_interval: 30s
  scrape_timeout: 10s
  evaluation_interval: 30s
  external_labels:
    cluster: 'production'
    environment: 'prod'

# Alertmanager webhook for routing alerts
alerting:
  alertmanagers:
    - static_configs:
        - targets:
            - localhost:9093

rule_files:
  - /etc/prometheus/alerts.yml

scrape_configs:
  - job_name: 'clipforge'
    static_configs:
      - targets: ['https://api.example.com']
    scheme: https
    bearer_token: '${METRICS_TOKEN}'
    metrics_path: '/internal/metrics'
    scrape_interval: 30s
    scrape_timeout: 10s
    honor_timestamps: true
    follow_redirects: true
```

### Docker Compose Example

```yaml
services:
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - ./alerts.yml:/etc/prometheus/alerts.yml
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--storage.tsdb.retention.time=30d'
    environment:
      - METRICS_TOKEN=${METRICS_SECRET}

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    volumes:
      - grafana_data:/var/lib/grafana
      - ./dashboards:/etc/grafana/provisioning/dashboards
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD}
      - GF_INSTALL_PLUGINS=grafana-piechart-panel

volumes:
  prometheus_data:
  grafana_data:
```

---

## 3. Metrics Exported

### Queue Metrics
- `queue_depth` (gauge) — Jobs in "queued" status
- `queue_oldest_job_age_seconds` (gauge) — Seconds since oldest queued job
- `jobs_by_status{status="..."}` (gauge) — Count by status
- `jobs_started_total` (counter) — Accumulated started jobs
- `jobs_completed_total` (counter) — Accumulated completed jobs
- `jobs_failed_total` (counter) — Accumulated failed jobs
- `jobs_retried_total` (counter) — Accumulated retry attempts
- `jobs_dead_lettered_total` (counter) — Accumulated dead-lettered

### Credit Metrics
- `credit_reservations_by_status{status="..."}` (gauge) — Count by status
- `credit_inconsistencies_total` (counter) — Detected balance/reservation mismatches

### HTTP Metrics (Future)
- `http_requests_total{route,method,status}` (counter)
- `http_request_duration_seconds{route,quantile}` (histogram)
- `http_errors_total{route,status}` (counter)

### Demo Metrics (Future)
- `demo_submissions_total` (counter)
- `demo_accepted_total` (counter)
- `demo_rejected_total` (counter)
- `demo_estimated_cost_per_day` (gauge)

---

## 4. Alert Rules

### Critical Alerts (Page On-Call Immediately)

```yaml
groups:
  - name: clipforge_critical
    rules:
      - alert: ApplicationUnavailable
        expr: up{job="clipforge"} == 0 for 2m
        annotations:
          summary: "Clipforge application is unreachable"
          action: "Check application logs and restart if necessary"

      - alert: QueueDepthExcessive
        expr: queue_depth > 500 for 5m
        annotations:
          summary: "Queue depth {{ $value }} exceeds 500"
          action: "Check workers are healthy (worker_heartbeat_age). If yes, queue is backed up—check render time. Scale workers if needed."

      - alert: QueueNotProcessing
        expr: increase(jobs_completed_total[5m]) == 0 and queue_depth > 0
        annotations:
          summary: "Queue has jobs but none are being processed"
          action: "Check worker heartbeat logs. Restart workers if stale."

      - alert: CreditInconsistencyDetected
        expr: credit_inconsistencies_total > 0
        annotations:
          summary: "Credit/reservation mismatch detected: {{ $value }} inconsistencies"
          action: "Page on-call. Query DB for mismatches and manually reconcile."

      - alert: DemoSpendingCeilingReached
        expr: demo_estimated_cost_per_day > 50
        annotations:
          summary: "Demo daily cost {{ $value }} exceeds $50"
          action: "Reduce DEMO_GLOBAL_LIMIT_PER_DAY or approve budget increase"
```

### High-Priority Alerts (Address Within 15 Minutes)

```yaml
      - alert: HighErrorRate
        expr: (rate(http_errors_total[5m]) / rate(http_requests_total[5m])) > 0.05
        annotations:
          summary: "Error rate {{ $value | humanizePercentage }} exceeds 5%"
          action: "Check application logs for errors. Identify root cause."

      - alert: HighLatency
        expr: histogram_quantile(0.95, http_request_duration_seconds) > 1
        annotations:
          summary: "p95 latency {{ $value }}s exceeds 1 second"
          action: "Check database performance. Review slow queries. Scale if needed."

      - alert: JobRetryRateHigh
        expr: rate(jobs_retried_total[5m]) > 0.1
        annotations:
          summary: "Job retry rate {{ $value }}/sec exceeds 0.1/sec"
          action: "Check worker logs for stale leases or transient errors."

      - alert: DeadLetterJobExists
        expr: jobs_dead_lettered_total > 0
        annotations:
          summary: "{{ $value }} dead-letter jobs exist"
          action: "Investigate why jobs are exhausting max attempts. May need manual intervention."
```

### Informational Alerts (Track But Don't Page)

```yaml
      - alert: QueueDepthModerate
        expr: queue_depth > 200 for 10m
        annotations:
          summary: "Queue depth {{ $value }} exceeds 200"
          action: "Monitor clearing rate. Scale workers if trend continues."

      - alert: DemoVolumeHigh
        expr: demo_submissions_accepted_total > 150 and increase(demo_submissions_accepted_total[1h]) > 50
        annotations:
          summary: "Demo submissions {{ $value | humanize }} in last hour"
          action: "Monitor cost. Consider rate limiting if trend continues."
```

---

## 5. Incident Response Runbooks

### Playbook: Queue Depth Excessive

**Trigger:** `queue_depth > 500` for 5 minutes

**Assessment (Do first):**
```bash
# 1. Is the worker alive?
curl -s https://api.example.com/internal/metrics?token=$METRICS_TOKEN | grep "jobs_completed_total"
# If increasing: worker is healthy, just backed up
# If flat: worker is dead

# 2. What's the queue clearing rate?
# Calculate jobs_completed_total delta over 5m window
curl ... | grep "jobs_completed_total"
# If <0.5 jobs/sec: renders are slow (network, voiceover, rendering)
# If 0: worker is stuck
```

**Response (If worker dead):**
```bash
# Restart workers
docker restart clipforge-worker-1

# Wait 30s for heartbeats to resume
sleep 30

# Verify recovery
curl ... | grep "queue_depth"
# Should start declining
```

**Response (If worker slow):**
```bash
# Check database performance
# Check OpenAI/Groq API latency
# Check B2 upload bandwidth
# Check ffmpeg CPU usage

# Scale workers if sustainable under load
docker-compose up -d --scale worker=3
```

### Playbook: Credit Inconsistency Detected

**Trigger:** `credit_inconsistencies_total > 0`

**Immediate Action:**
```bash
# Page on-call immediately
# Query for inconsistent rows
SELECT job_id, reservation.amount, COUNT(*)
FROM CreditReservation r
LEFT JOIN Job j ON r.jobId = j.id
WHERE j.id IS NULL OR (j.status IN ('completed', 'failed_terminal', 'dead_letter', 'cancelled') AND r.status != 'captured' AND r.status != 'released')
ORDER BY r.createdAt DESC;

# For each inconsistency:
# 1. Understand what happened (check job logs, runner output)
# 2. Manually capture or release reservation
#    UPDATE CreditReservation SET status='captured' WHERE id='...';
#    UPDATE CreditLedgerEntry SET type='capture', refDetails='manual-reconciliation' ...
```

### Playbook: Dead-Letter Job Exists

**Trigger:** `jobs_dead_lettered_total > 0` (informational)

**Investigation:**
```bash
# Find dead-letter jobs
SELECT id, projectId, failureReason, attemptCount, maxAttempts, createdAt
FROM Job
WHERE status='dead_letter'
ORDER BY createdAt DESC
LIMIT 10;

# For each:
# - Review failureReason (why did it fail?)
# - Check runner logs for this job
# - Determine if retry would succeed (if yes, manual retry; if no, refund)
```

---

## 6. Grafana Dashboards

### Dashboard 1: Queue Health

**Panels:**
- Queue depth (sparkline, last 1h)
- Oldest queued job age (gauge)
- Jobs processing (gauge)
- Completion rate (last 5m)
- Failure rate (last 5m)
- Retry rate (last 5m)

**Thresholds:**
- Queue depth: warning at 200, critical at 500
- Oldest age: warning at 300s
- Failure rate: warning at 1%, critical at 5%

### Dashboard 2: Worker Status

**Panels:**
- Worker heartbeat age (gauge per worker)
- Worker restart count (counter per worker)
- Lease loss count (counter)
- Stale lease detections (rate)
- Job duration p95/p99 (histogram)

### Dashboard 3: Credit Safety

**Panels:**
- Total credit reservations (gauge)
- Reserved vs. free breakdown (pie)
- Credit inconsistencies (counter)
- Reservation status breakdown (stacked bar)
- Daily refund volume (bar chart)

### Dashboard 4: Demo Tracking

**Panels:**
- Demo submissions (rate)
- Demo accepted vs. rejected (stacked bar)
- Estimated daily cost (gauge)
- Daily cost trend (line)
- Per-IP distribution (top 10)

---

## 7. SLO Targets & Alerting

| Metric | Target | Warning | Critical |
|--------|--------|---------|----------|
| P95 API latency | <500ms | >300ms | >1s |
| Error rate | <1% | >0.5% | >5% |
| Queue depth | <50 | >200 | >500 |
| Job completion time | <5min | >10min | >30min |
| Credit accuracy | 100% | 0 inconsistencies | >0 inconsistencies |
| Availability | 99.5% | 1 incident/week | 2+ incidents/week |

---

## 8. On-Call Procedures

### Daily Checks (Business Hours)

```bash
# 9 AM: Review overnight metrics
- Queue depth: should be <50
- Error rate: should be <1%
- Demo cost: should be <$30
- Dead-letter count: should be 0

# Every 2 hours: Quick health check
curl https://api.example.com/api/health
# Should return 200 with all systems OK
```

### On-Call Engineer Responsibilities

1. **Monitoring (24/7)**
   - Respond to alerts within 15 minutes
   - Page secondary on-call for critical issues
   - Post incident in #clipforge-incidents Slack channel

2. **Troubleshooting**
   - Use Prometheus to diagnose issues
   - Check Grafana dashboards for trends
   - Review application logs via CloudWatch
   - Check database performance

3. **Escalation**
   - Page backend lead if database is critical path
   - Page infrastructure team if network/compute issue
   - Page product if feature needs to be disabled

4. **Documentation**
   - Log all incidents in postmortem format
   - Update runbooks based on learnings
   - Track MTTR and MTTD metrics

---

## 9. Implementation Checklist

### Before Production
- [ ] Prometheus and Grafana deployed and operational
- [ ] Metrics endpoint live and tested
- [ ] Dashboards provisioned and accessible
- [ ] Alert rules loaded into Prometheus
- [ ] Slack/Email webhook configured
- [ ] On-call rotation defined
- [ ] Runbooks reviewed by team
- [ ] Load test verifies metrics collection doesn't impact performance

### Week 1 (Stabilization)
- [ ] Monitor all dashboards for full business cycle
- [ ] Tune alert thresholds based on baseline
- [ ] Test incident response procedures
- [ ] Verify backup/restore of metrics data
- [ ] Document any deviations from plan

### Week 4 (Optimization)
- [ ] Review alert performance (false positives/negatives)
- [ ] Optimize Prometheus retention if needed
- [ ] Add custom metrics based on observed needs
- [ ] Schedule quarterly disaster recovery drills

---

## 10. Security Considerations

### Authentication
- Bearer token stored in `METRICS_SECRET` environment variable
- Never log tokens in application output
- Rotate token quarterly
- Use unique token per environment (prod, staging, dev)

### Access Control
- Restrict Prometheus/Grafana access to internal network only
- Use VPN for remote access
- Disable public internet access to `/internal/metrics`
- Log all Prometheus/Grafana access

### Data Privacy
- Metrics never contain customer emails, IDs, or content
- High-cardinality labels (job IDs) aggregated into status counts
- No raw job payloads or user data in any metric
- Regular audit of metric names to prevent data leakage

---

## 11. Cost Estimation

**Infrastructure:**
- Prometheus: 10GB volume, 2GB RAM = $20/month
- Grafana: $20/month (local instance)
- Logs (CloudWatch): variable, ~$15/month
- **Total:** ~$55/month

**Labor:**
- Setup: ~2 days (one-time)
- Maintenance: ~2 hours/week
- On-call: included in team rotation

---

## 12. Escalation Contacts

- **On-Call Engineer:** #clipforge-oncall Slack
- **Backend Lead:** @backend-lead
- **Infrastructure:** #infrastructure-team
- **Product Manager:** @product-pm
- **CEO (P0):** @ceo-alerts Slack channel

---

**Status:** Ready for production deployment  
**Last Updated:** 2026-08-13  
**Next Review:** 2026-09-13
