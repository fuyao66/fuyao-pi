import { homedir } from "node:os";
import { join } from "node:path";

export type SshConnectionOptions = {
  target: string;
  port?: number;
  identityFile?: string;
  knownHostsFile?: string;
};

export type SshWorkerOptions = SshConnectionOptions & { workerPath: string };

function validateTarget(target: string): void {
  if (!/^[A-Za-z0-9_.@-]+$/.test(target) || target.startsWith("-")) {
    throw new Error(`Unsafe SSH target: ${target}`);
  }
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

export function quoteRemoteArgument(value: string): string {
  if (value.includes("\0") || value.includes("\n") || value.includes("\r")) {
    throw new Error("Remote shell arguments cannot contain NUL or newlines");
  }
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/**
 * Run a POSIX script under `sh` regardless of the remote login shell (fish, csh...).
 * ssh hands the command line to the login shell, so only the outer `sh -c '...'` must
 * parse there: the `'"'"'` quote escape is valid in sh, bash, zsh and fish. Fish
 * interprets backslashes inside single quotes, so scripts must not contain any.
 */
export function remoteShell(script: string): string {
  if (script.includes("\\")) {
    throw new Error("Remote shell scripts must not contain backslashes");
  }
  return `sh -c ${quoteRemoteArgument(script)}`;
}

function appendCommonOptions(
  command: string[],
  options: SshConnectionOptions,
): void {
  validateTarget(options.target);
  command.push(
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "ForwardAgent=no",
    "-o",
    "ClearAllForwardings=yes",
  );
  if (options.identityFile)
    command.push("-i", expandHome(options.identityFile));
  if (options.knownHostsFile)
    command.push(
      "-o",
      `UserKnownHostsFile=${expandHome(options.knownHostsFile)}`,
    );
}

export function buildSshBaseCommand(options: SshConnectionOptions): string[] {
  const command = ["ssh", "-T"];
  appendCommonOptions(command, options);
  command.push(
    "-o",
    "ConnectTimeout=15",
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=3",
    "-o",
    "ControlMaster=auto",
    "-o",
    "ControlPersist=60",
    "-o",
    "ControlPath=~/.ssh/omp-remote-%C",
  );
  if (options.port) command.push("-p", String(options.port));
  return command;
}

export function buildScpBaseCommand(options: SshConnectionOptions): string[] {
  // Destinations below use remote shell quoting. Pin legacy SCP semantics:
  // OpenSSH 9's default SFTP treats those quotes as literal path characters.
  const command = ["scp", "-O"];
  appendCommonOptions(command, options);
  command.push(
    "-o",
    "ControlMaster=auto",
    "-o",
    "ControlPersist=60",
    "-o",
    "ControlPath=~/.ssh/omp-remote-%C",
  );
  if (options.port) command.push("-P", String(options.port));
  return command;
}

export function buildSshWorkerCommand(options: SshWorkerOptions): string[] {
  return [
    ...buildSshBaseCommand(options),
    options.target,
    `exec ${quoteRemoteArgument(options.workerPath)}`,
  ];
}
