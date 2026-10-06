import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadConfiguredSshHosts,
  mergeConfiguredSshHosts,
  parseConnectArgs,
  type ConfiguredSshHost,
} from "../src/connect-options.ts";

const gpuBox: ConfiguredSshHost = {
  name: "gpu-box",
  host: "remote.example.com",
  username: "developer",
  port: 2222,
  keyPath: "~/.ssh/gpu-box.pem",
};

describe("remote connection aliases", () => {
  test("connects by OMP SSH host name and defaults cwd later", () => {
    expect(parseConnectArgs("gpu-box", [gpuBox])).toEqual({
      target: "developer@remote.example.com",
      displayTarget: "gpu-box",
      port: 2222,
      identityFile: "~/.ssh/gpu-box.pem",
    });
  });

  test("accepts a project directory after the host name", () => {
    expect(parseConnectArgs("gpu-box /srv/project", [gpuBox])).toMatchObject({
      target: "developer@remote.example.com",
      displayTarget: "gpu-box",
      cwd: "/srv/project",
    });
  });

  test("explicit flags override saved host settings", () => {
    expect(
      parseConnectArgs(
        "gpu-box /srv/project --port 2200 --identity ~/.ssh/override --known-hosts ~/.ssh/project_hosts",
        [gpuBox],
      ),
    ).toEqual({
      target: "developer@remote.example.com",
      displayTarget: "gpu-box",
      cwd: "/srv/project",
      port: 2200,
      identityFile: "~/.ssh/override",
      knownHostsFile: "~/.ssh/project_hosts",
    });
  });

  test("preserves the explicit legacy connection form", () => {
    expect(
      parseConnectArgs(
        "developer@remote.example.com /srv/project --port 2222 --identity ~/.ssh/key",
      ),
    ).toEqual({
      target: "developer@remote.example.com",
      displayTarget: "developer@remote.example.com",
      cwd: "/srv/project",
      port: 2222,
      identityFile: "~/.ssh/key",
    });
  });

  test("project aliases override same-name user aliases", () => {
    const project = { ...gpuBox, host: "project.example.com" };
    const user = { ...gpuBox, host: "user.example.com" };
    expect(mergeConfiguredSshHosts([project], [user])).toEqual([project]);
  });

  test("passes ~/.ssh/config aliases to the system ssh unchanged", async () => {
    const home = await mkdtemp(join(tmpdir(), "ssh-config-home-"));
    const saved = process.env.HOME;
    try {
      await mkdir(join(home, ".ssh"));
      // A Match block after Host prod must not leak into prod, and ProxyJump must apply.
      await writeFile(join(home, ".ssh/config"), "Host prod\n  HostName 10.0.0.5\n  User deploy\n  ProxyJump bastion\nMatch host other\n  HostName evil.example.com\n  User root\n");
      process.env.HOME = home;
      const hosts = await loadConfiguredSshHosts(home);
      expect(hosts).toEqual([]);
      expect(parseConnectArgs("prod /srv", hosts)).toEqual({ target: "prod", displayTarget: "prod", cwd: "/srv" });
    } finally {
      process.env.HOME = saved;
      await rm(home, { recursive: true, force: true });
    }
  });

  test("rejects invalid positional and option shapes", () => {
    expect(() => parseConnectArgs("")).toThrow("Usage:");
    expect(() => parseConnectArgs("host /a /b")).toThrow("Usage:");
    expect(() => parseConnectArgs("host --port 0")).toThrow("Invalid SSH port");
    expect(() => parseConnectArgs("host --identity")).toThrow("Missing value");
  });
});
