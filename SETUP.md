# Setting up the platform on Windows 11

This guide starts from a Windows 11 machine with nothing installed. At the end you will have
the same environment as the rest of the team: a local Kubernetes cluster with the development,
staging and production namespaces, a PostgreSQL database, and a demo that reports zero findings.

All commands are for **Command Prompt** (search for "cmd" in the Start menu). Where a step needs
an **administrator** Command Prompt, it says so: right-click "Command Prompt" and choose
"Run as administrator".

Allow about an hour the first time, most of it downloads.

## 1. Install the prerequisites

| Tool | Version needed | Why |
|------|----------------|-----|
| WSL 2 | any | Docker Desktop runs Linux containers inside it |
| Docker Desktop | current | runs the Kubernetes cluster and the database |
| Git | 2.30 or newer | clones the repository; the platform also reads manifests from Git |
| Node.js | 22.19 or newer | runs the platform |
| kind | 0.33.0 or newer | creates the Kubernetes cluster inside Docker |
| kubectl | 1.36 or newer | talks to the cluster |

### WSL 2

In an **administrator** Command Prompt:

```
wsl --install
```

Restart Windows when it finishes. After the restart a window may open asking you to create a
Linux user name and password; do that, then close it. If `wsl --install` reports that
virtualization is disabled, it has to be switched on in your laptop's BIOS/UEFI settings
(usually called "Intel VT-x", "AMD-V" or "SVM").

### Docker Desktop

```
winget install --id Docker.DockerDesktop -e
```

Start Docker Desktop from the Start menu, accept the terms, and skip the sign-in (an account is
not needed). Leave "Use the WSL 2 based engine" switched on in Settings > General. Wait until the
bottom-left corner shows **Engine running**.

### Git, Node.js 22, kind and kubectl

```
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.22 -e
winget install --id Kubernetes.kind -e
winget install --id Kubernetes.kubectl -e
```

**Close Command Prompt and open a new one** so it picks up the new programs, then check:

```
git --version
node --version
kind version
kubectl version --client
```

If one of them says "is not recognized", close and reopen Command Prompt again, or sign out of
Windows and back in.

## 2. Clone the repository

Pick a folder to keep the project in, for example your Desktop:

```
cd %USERPROFILE%\Desktop
git clone https://github.com/princeoladapo/fyp-config-platform.git
cd fyp-config-platform
```

## 3. Run the setup script

Make sure Docker Desktop shows **Engine running**, then, inside the `fyp-config-platform`
folder:

```
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

About `-ExecutionPolicy Bypass`: Windows blocks PowerShell scripts by default. This flag allows
this one run of this one script without changing any Windows setting. If you prefer to allow
scripts permanently for your own account, run this once in PowerShell and then start the script
with `.\scripts\setup.ps1`:

```
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

The script takes 5 to 15 minutes the first time. It works through ten steps:

1. checks every prerequisite above and lists anything missing, with the command to install it
2. creates the kind cluster `fyp-cluster` from `k8s/kind-config.yaml`
3. pulls `nginxinc/nginx-unprivileged`, tags it with the image names the manifests use, and
   loads it into the cluster (it detects whether your machine is amd64 or arm64)
4. creates the `development`, `staging` and `production` namespaces and applies the manifests
   from `sample-config/environments`
5. applies `k8s/rbac.yaml`, the read-only service account
6. creates a 30-day token for that account and a kubeconfig context called `fyp-readonly`
7. creates `.env` with a random database password (if it does not exist yet) and starts
   PostgreSQL in a Docker container called `fyp-postgres`
8. installs the Node packages with `npm ci`
9. applies the database migrations with Prisma
10. runs the demo and checks that it reports zero findings

It ends with **SETUP COMPLETE: the demo reports zero findings.**

If it stops, it prints **SETUP STOPPED** and the reason. Fix that and run the same command
again: the script checks what already exists, so finished steps are skipped or repeated
harmlessly.

## 4. Everyday use

Start Docker Desktop first (the cluster and database run inside it), then in the project folder:

```
npx tsx src/demo.ts
```

Zero findings is the baseline. Any finding means a configuration drifted from the rules in
`rules/rules.yaml`.

The platform reads the manifests that are **committed** in Git, not unsaved edits. Commit a
manifest change before running the demo, or it will not be seen.

## 5. Renewing the read-only token

The platform reads the cluster through the `config-validator` service account, which can only
`get` and `list` Deployments, Services and ConfigMaps. Its token lasts 30 days. When it expires
the demo fails with `Unauthorized`.

To renew it, either run the setup script again (it issues a new token every time), or run this
in Command Prompt:

```
for /f %t in ('kubectl create token config-validator -n config-validator --duration=720h --context kind-fyp-cluster') do @kubectl config set-credentials config-validator --token=%t
```

The token is stored in your kubeconfig file (`%USERPROFILE%\.kube\config`), never in the
repository. Do not copy it into any project file.

## 6. Troubleshooting

**"Docker Desktop is installed but not running"**: start Docker Desktop and wait for
"Engine running". After a restart of Windows this is needed every time.

**"Port 5432 is already in use"**: another PostgreSQL is running on your machine. Stop it in
Windows Services, or change `5432` in the `DATABASE_URL` line of `.env` to another port such as
`5433` and run the script again.

**"Database migration failed ... authentication"**: the password in `.env` does not match the
one the `fyp-postgres` container was created with (for example, `.env` was deleted and
recreated). If the database holds nothing you need, remove the container and its data, then
run the script again:

```
docker rm -f fyp-postgres
docker volume rm fyp-postgres-data
```

**The demo reports findings straight after setup**: check that you have not edited the
manifests or rules, with `git status`. The baseline in the repository reports zero.

**Starting again from scratch**: delete the cluster and run the script again.

```
kind delete cluster --name fyp-cluster
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```
