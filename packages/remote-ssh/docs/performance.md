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

## Slim compiled worker

The worker build now uses a version-gated import adapter in
`scripts/worker-imports.ts`. It bundles the seven Pi tool implementations and
argument validation directly instead of loading the entire public Pi barrel.
Source-mode development and the local extension still use public imports. No
upstream implementations are copied or edited; all target dependencies remain
bundled, and Photon WASM is still shipped alongside the executable.

These are **internal upstream paths**, not a stable public API. The adapter checks
Pi coding-agent and pi-ai versions (currently 0.87.1), module existence and function
exports before building. A Pi upgrade requires reviewing the adapter, rebuilding
both architectures and rerunning the compiled-worker smoke. It must not bypass the
version gate merely because TypeScript still compiles.

Local x64 comparison, alternating baseline/candidate order over ten starts each,
measured from process spawn to validated ready (shutdown excluded):

| Metric | Previous worker | Slim worker |
| --- | --- | --- |
| Ready median | 394.5 ms | 125.5 ms |
| Ready range | 376.8–447.8 ms | 115.0–134.2 ms |
| First read median | 6.7 ms | 11.4 ms |
| First no-op bash median (after read) | 9.1 ms | 12.4 ms |
| Executable bytes | 102,791,296 | 95,901,824 |

Startup improves by about 269 ms in this local sample, with a small first-tool
regression; this is not a claim that every call became faster. Executable size
falls about 6.7%, limited by the bundled Bun runtime. These are not SSH network
measurements. After one warmup, 20 calls per tool measured read medians of
1.35 → 1.19 ms and no-op bash medians of 3.13 → 3.34 ms; there is no clear
steady-state acceleration or significant regression in this small sample.
ARM64 was compiled, not executed on an ARM64 machine.

The smoke exercises all seven tools, image reads (including a 3000×1 PNG that
forces Photon resizing), invalid arguments, cancellation
followed by another request, rejection of incompatible versions and inherited
restricted Pi children via an SSH shim. A lifecycle bug uncovered by the rejection
test was also fixed: a fatal initialization error now terminates the subprocess
even if the client has already been logically closed.

Rebuild workers with `bun run build:pi-worker:all` after updating this build logic.
After rebuilding, the next remote connection deploys the new content hashes.
Existing live worker processes are
not replaced in place.

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
