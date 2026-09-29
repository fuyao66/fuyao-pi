# Pi SSH Remote

Independent snapshot of the Pi integration formerly developed in `omp-ssh-remote`. This repository preserves the existing Pi core, FFF, AFT, RTK and optional Tintin integrations; it does not promise arbitrary-plugin compatibility. Future development targets a purpose-built Pi-based agent.

It has its own dependency lockfile, transport sources, builds and tests, with no dependency on the OMP repository. Existing remote cache namespaces are preserved for compatibility.

## Build

```sh
bun install --frozen-lockfile
bun run check
bun run build:pi-worker:all
```

Native AFT artifacts must be supplied as described in the package documentation; alternatively select components with `PI_WORKER_PLUGINS=none` or `PI_WORKER_PLUGINS=fff,rtk`. Generated workers are not versioned.

## Installation and boundaries

- [English](packages/pi/README.md)
- [简体中文](packages/pi/README.zh-CN.md)

Pi is not installed into the user's global environment by building this repository. Managed extension ordering remains required; consult the package documentation before enabling it.

[MIT](LICENSE)
