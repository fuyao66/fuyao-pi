# Connection and tool latency

The parent connection probes platform/home, validates/deploys the content-addressed
worker bundle, then starts one worker and validates its tool handshake. Tool calls
reuse that process and SSH stream; they do not reconnect or deploy per request.
OpenSSH ControlMaster also reuses transport connections during deployment.

## Cached connection optimization

With a cached worker and Photon companion, preparation now uses two SSH commands:
platform/home probe, then bundle validation + companion link repair + cache pruning.
Previously the parent path used six commands, including a duplicate home probe.
Cache misses still use SHA-256-verified uploads and atomic activation. This does not
skip remote verification or change host-key checks, protocol validation or cancellation.
Fast-path pruning is best-effort, limited to two seconds plus a one-second kill grace;
when the host lacks `timeout`, that optional cleanup is skipped.

Local shell-shim measurements (three samples, injected 50 ms delay per SSH command):

| Preparation path | SSH commands | Elapsed samples (ms) |
| --- | --- | --- |
| Previous parent path | 6 | 344, 328, 329 |
| Optimized parent path | 2 | 121, 115, 114 |

These are simulated round-trip costs, not real network or end-to-end connection
benchmarks. They exclude worker startup and the first SSH authentication cost.
Cold deployment still uploads a large compiled Bun worker; network bandwidth and
remote hashing remain relevant.

A separate local-stdio x64 worker sample (20 requests, no SSH/network) measured
initialization at 395 ms, read p50 at 1.28 ms and no-op bash p50 at 3.57 ms. These
are observations from one machine, not performance guarantees. No tool-response
protocol changes were made on the basis of these measurements.

## Real-host measurement

From the repository root, after building the workers:

```sh
REMOTE_TARGET=user@host REMOTE_CWD=/absolute/remote/project bun run benchmark:pi
```

The benchmark reports deployment/cache time, worker initialization, first read, and
subsequent read/bash p50/p95. It can upload a worker, prune older worker caches and
create/remove a temporary benchmark file in the remote cwd. Use only an authorized
host/directory. It does not clear caches or close shared ControlMaster sockets to
manufacture a cold run. Compare repeated runs under the same network conditions.
