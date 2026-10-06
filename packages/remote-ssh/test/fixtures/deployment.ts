import { mkdtemp, mkdir, writeFile, chmod, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

/** Real shell commands in an isolated fake remote home, never a network connection. */
export async function deploymentFixture(delay = "0") {
  const dir = await mkdtemp(join(tmpdir(), "remote-deploy-"));
  const home = join(dir, "home with 'quote");
  const bin = join(dir, "bin"); const artifacts = join(dir, "artifacts");
  await Promise.all([mkdir(home), mkdir(bin), mkdir(artifacts)]);
  const log = join(dir, "commands");
  const scriptLog = join(dir, "scripts");
  const worker = "synthetic-worker"; const companion = "synthetic-wasm";
  const hash = (s: string) => createHash("sha256").update(s).digest("hex");
  const workerHash = hash(worker); const companionHash = hash(companion);
  const namespace = join(home, ".cache/omp-ssh-remote/test");
  const workerDir = join(namespace, workerHash);
  const companionDir = join(namespace, "photon/x64", companionHash);
  await Promise.all([mkdir(workerDir, { recursive: true }), mkdir(companionDir, { recursive: true })]);
  for (const [base, name, text] of [[artifacts, "worker-linux-x64", worker], [artifacts, "photon-x64", companion], [workerDir, "worker-linux-x64", worker], [companionDir, "photon.wasm", companion]]) {
    await writeFile(join(base!, name!), text!); await chmod(join(base!, name!), 0o700);
    await writeFile(join(base!, name!)+".sha256", hash(text!));
  }
  const q = (s: string) => `'${s.replaceAll("'", `'"'"'`)}'`;
  await writeFile(join(bin, "ssh"), `#!/bin/sh\nprintf 'ssh\\n' >> ${q(log)}\nsleep ${delay}\nfor arg do command=$arg; done\nprintf '%s\\0' "$command" >> ${q(scriptLog)}\nexport HOME=${q(home)}\ncase "$command" in *uname*) printf 'Linux\\nx86_64\\n%s' "$HOME"; exit 0 ;; esac\nexec sh -c "$command"\n`);
  await writeFile(join(bin, "scp"), `#!/bin/sh\nprintf 'scp\\n' >> ${q(log)}\nlegacy=0\nfor arg do test "$arg" = '-O' && legacy=1; src=$dst; dst=$arg; done\nremote=\${dst#*:}\nif test "$legacy" = 1; then eval "dest=$remote"; else dest=$remote; fi\ncp -- "$src" "$dest"\n`);
  await Promise.all([chmod(join(bin, "ssh"), 0o700), chmod(join(bin, "scp"), 0o700)]);
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  return { home, bin, workerDir, companionDir, artifacts, log,
    bundle: { cacheNamespace: "test", companionArtifacts: [{ id: "photon", filePrefix: "photon", executableName: "photon.wasm" }] },
    options: { target: "synthetic-host", localArtifactDir: artifacts },
    async commands() { return (await readFile(log, "utf8")).trim().split("\n"); },
    /** Remote command lines exactly as the login shell receives them. */
    async scripts() { return (await readFile(scriptLog, "utf8")).split("\0").filter(Boolean); },
    async close() { process.env.PATH = path; await rm(dir, { recursive: true, force: true }); },
  };
}
